import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Inject,
  NotFoundException,
  Post,
  Req,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { ImportHistory, ImportSheet } from '@ee/contracts';
import { Prisma, type PrismaClient } from '@ee/db';
import { D } from '@ee/quote-engine';
import { audit } from '../audit.js';
import type { AuthUser } from '../auth/auth.types.js';
import { isSystemAdmin } from '../auth/authz.js';
import { CurrentUser } from '../auth/session.guard.js';
import { PRISMA } from '../prisma.service.js';
import { full, snapshotHash } from '../quotes/quotes.controller.js';
import { MAX_SHEET_BYTES, SheetImportError } from '../quotes/sheet-import.js';
import { newFolio } from '../requests/folio.js';
import { ZodPipe } from '../zod.pipe.js';
import { readHistorySheet } from './history-sheet.js';

const toDate = (s: string) => new Date(`${s}T00:00:00Z`);
const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toUpperCase();

/**
 * Historic migration (system admin only): last year's EE workbooks become closed requests so
 * Colegios, the dashboard and the yearly goal have data. Each option keeps its sheet price.
 */
@Controller('history')
export class HistoryController {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  private admin(user: AuthUser) {
    if (!isSystemAdmin(user)) throw new ForbiddenException('Solo el administrador del sistema');
  }

  /** Reads one workbook; nothing is saved. */
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @Post('preview')
  async preview(@CurrentUser() user: AuthUser, @Body(new ZodPipe(ImportSheet)) body: ImportSheet) {
    this.admin(user);
    if (!body.fileBase64 || !/\.xlsx$/i.test(body.fileName ?? ''))
      throw new BadRequestException({
        code: 'SHEET_IMPORT',
        message: 'Sube el Excel (.xlsx) de la cotización',
      });
    const file = Buffer.from(body.fileBase64, 'base64');
    if (file.length > MAX_SHEET_BYTES)
      throw new BadRequestException({ code: 'SHEET_IMPORT', message: 'El archivo pesa más de 3 MB' });
    try {
      const sheet = await readHistorySheet(file);
      const offices = await this.prisma.office.findMany({ where: { active: true } });
      const wanted = sheet.officeName ? norm(sheet.officeName) : null;
      const office = wanted ? offices.find((o) => norm(o.name).includes(wanted)) : undefined;
      return { ...sheet, officeId: office?.id ?? null };
    } catch (e) {
      if (e instanceof SheetImportError)
        throw new BadRequestException({ code: 'SHEET_IMPORT', message: e.message });
      throw e;
    }
  }

  /** Creates the closed request: every option sent (approved outside the app), and the outcome. */
  @Post()
  async create(
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
    @Body(new ZodPipe(ImportHistory)) body: ImportHistory,
  ) {
    this.admin(user);
    const office = await this.prisma.office.findUnique({ where: { id: body.officeId } });
    if (!office) throw new NotFoundException('Oficina no encontrada');
    const sentOn = toDate(body.sentOn);
    const won = body.outcome === 'WON' ? body.options[body.wonOption!]! : null;

    return this.prisma.$transaction(async (tx) => {
      const dup = await tx.travelRequest.findFirst({
        where: {
          officeId: body.officeId,
          groupName: body.groupName,
          clientName: body.clientName ?? null,
          departureDate: toDate(body.departureDate),
        },
        select: { folio: true },
      });
      if (dup)
        throw new ConflictException({ code: 'HISTORY_DUPLICATE', message: `Ya existe como ${dup.folio}` });

      const r = await tx.travelRequest.create({
        data: {
          folio: newFolio(sentOn),
          officeId: body.officeId,
          requesterId: user.id,
          status: 'SENT',
          groupName: body.groupName,
          clientName: body.clientName ?? null,
          program: body.program ?? null,
          city: body.city,
          countryCode: body.countryCode,
          departureDate: toDate(body.departureDate),
          returnDate: toDate(body.returnDate),
          participants: (won ?? body.options[0]!).participants,
          chaperones: body.chaperones,
          staff: body.staff,
          requirements: `Histórico importado de "${body.sourceFile}"`,
          // Dated when it was sent, so yearly figures land in the right year.
          createdAt: sentOn,
        },
      });

      let wonVersionId: string | null = null;
      for (const [i, o] of body.options.entries()) {
        const rate = new D(o.targetMarginRate);
        const scenario = await tx.quoteScenario.create({
          data: { requestId: r.id, name: o.name, createdById: user.id, createdAt: sentOn },
        });
        const v = await tx.quoteVersion.create({
          data: {
            scenarioId: scenario.id,
            number: 1,
            status: 'SENT',
            saleCurrency: o.saleCurrency,
            targetMarginRate: new Prisma.Decimal(rate.toFixed()),
            mxnRate: o.mxnRate ? new Prisma.Decimal(o.mxnRate) : null,
            participants: o.participants,
            chaperones: body.chaperones,
            staff: body.staff,
            createdById: user.id,
            createdAt: sentOn,
            lines: {
              create: {
                position: 0,
                category: 'PER_PARTICIPANT',
                description: 'Costo por alumno (histórico, sin desglose)',
                quantity: new Prisma.Decimal(1),
                // Cost that reproduces the sheet's final price at its commission: price × (1 − rate).
                unitCost: new Prisma.Decimal(
                  new D(o.pricePerParticipant).times(new D(1).minus(rate)).toFixed(4),
                ),
                currency: o.saleCurrency,
              },
            },
          },
          include: full,
        });
        await tx.quoteReview.create({
          data: {
            versionId: v.id,
            reviewerId: null,
            decision: 'APPROVED',
            comment: `Histórico: autorizado fuera del cotizador (importó ${user.name})`,
            calculationHash: snapshotHash(v),
            createdAt: sentOn,
          },
        });
        await tx.proposalDelivery.create({
          data: {
            versionId: v.id,
            sentById: user.id,
            recipients: body.clientName ?? body.groupName,
            channel: 'OTHER',
            sentOn,
            notes: 'Histórico importado de Excel',
          },
        });
        if (i === body.wonOption && won) wonVersionId = v.id;
      }

      if (body.outcome !== 'SENT')
        await tx.travelRequest.update({
          where: { id: r.id },
          data: {
            status: body.outcome,
            wonVersionId,
            lostReason: body.outcome === 'LOST' ? body.lostReason : null,
            closedAt: sentOn,
          },
        });
      await audit(tx, {
        actorUserId: user.id,
        action: 'request.history_imported',
        entityType: 'TravelRequest',
        entityId: r.id,
        correlationId: req.correlationId,
        diff: {
          folio: r.folio,
          outcome: body.outcome,
          options: body.options.length,
          sourceFile: body.sourceFile,
        },
      });
      return { id: r.id, folio: r.folio };
    });
  }
}
