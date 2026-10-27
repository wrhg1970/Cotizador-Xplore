import {
  BadGatewayException,
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Inject,
  Logger,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { ImportSheet } from '@ee/contracts';
import type { PrismaClient } from '@ee/db';
import { audit } from '../audit.js';
import type { AuthUser } from '../auth/auth.types.js';
import { CurrentUser } from '../auth/session.guard.js';
import { PRISMA } from '../prisma.service.js';
import { canViewQuotes, canWorkQuotes } from '../requests/request-policy.js';
import { ZodPipe } from '../zod.pipe.js';
import {
  fetchGoogleSheet,
  MAX_SHEET_BYTES,
  normalizeProposal,
  SHEET_READER,
  SheetImportError,
  type SheetReader,
  sheetToText,
} from './sheet-import.js';

const uuid = new ParseUUIDPipe({ version: '4' });

/**
 * Reads a cost sheet with AI and returns proposed lines for the editor. Nothing is saved here: the
 * quoter reviews the proposal and saves it with the normal, audited edit.
 */
@Controller('quotes')
export class SheetImportController {
  private readonly logger = new Logger(SheetImportController.name);

  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(SHEET_READER) private readonly reader: SheetReader | null,
  ) {}

  // Each call is a paid model request.
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post(':id/import')
  async preview(
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
    @Param('id', uuid) id: string,
    @Body(new ZodPipe(ImportSheet)) body: ImportSheet,
  ) {
    const v = await this.prisma.quoteVersion.findUnique({
      where: { id },
      select: { id: true, status: true, scenario: { select: { request: true } } },
    });
    const r = v?.scenario.request;
    if (!v || !r || !canViewQuotes(user, r)) throw new NotFoundException('Cotización no encontrada');
    if (!canWorkQuotes(user, r))
      throw new ForbiddenException(
        'Solo el cotizador asignado o el coordinador, con la solicitud en cotización',
      );
    if (v.status !== 'DRAFT' && v.status !== 'RETURNED')
      throw new ForbiddenException('Solo se importa en versiones en borrador o devueltas');
    if (!this.reader) throw new ServiceUnavailableException('El importador con IA no está configurado');

    try {
      const file = body.fileBase64
        ? Buffer.from(body.fileBase64, 'base64')
        : await fetchGoogleSheet(body.sheetUrl!);
      if (file.length > MAX_SHEET_BYTES) throw new SheetImportError('El archivo pesa más de 3 MB');
      const text = await sheetToText(file, body.fileName ?? 'hoja.xlsx');
      const raw = await this.reader.read(text).catch((err: unknown) => {
        if (err instanceof SheetImportError) throw err;
        // Provider errors may echo the prompt; log only the type.
        this.logger.warn(`Vertex AI falló: ${err instanceof Error ? err.name : 'error'}`);
        throw new BadGatewayException('No se pudo consultar la IA; intenta de nuevo en un momento');
      });
      const proposal = normalizeProposal(raw);
      await audit(this.prisma, {
        actorUserId: user.id,
        action: 'quote.import_previewed',
        entityType: 'QuoteVersion',
        entityId: v.id,
        correlationId: req.correlationId,
        // Counts only: the sheet itself may hold personal data and is never stored.
        diff: {
          source: body.sheetUrl
            ? 'google_sheet'
            : body.fileName?.toLowerCase().endsWith('.csv')
              ? 'csv'
              : 'xlsx',
          lines: proposal.lines.length,
          warnings: proposal.warnings.length,
        },
      });
      return proposal;
    } catch (e) {
      if (e instanceof SheetImportError)
        throw new BadRequestException({ code: 'SHEET_IMPORT', message: e.message });
      throw e;
    }
  }
}
