import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Inject,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { MAX_ATTACHMENT_BYTES, UploadAttachment } from '@ee/contracts';
import type { PrismaClient } from '@ee/db';
import type { z } from 'zod';
import { audit } from '../audit.js';
import type { AuthUser } from '../auth/auth.types.js';
import { canDo } from '../auth/authz.js';
import { CurrentUser } from '../auth/session.guard.js';
import { PRISMA } from '../prisma.service.js';
import { ZodPipe } from '../zod.pipe.js';
import { sniffMime } from './attachment-mime.js';
import { canView } from './request-policy.js';

const uuid = new ParseUUIDPipe({ version: '4' });
const MAX_FILES = 20;
const asciiName = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[^\w.-]+/g, '_')
    .slice(0, 120);

/** Files on a request (V2 "adjuntos"): visible to whoever sees the request, added by members who may edit. */
@Controller('requests/:id/attachments')
export class AttachmentsController {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  private async request(id: string, user: AuthUser) {
    const r = await this.prisma.travelRequest.findUnique({ where: { id } });
    if (!r || !canView(user, r)) throw new NotFoundException('Solicitud no encontrada');
    return r;
  }

  @Get()
  async list(@CurrentUser() user: AuthUser, @Param('id', uuid) id: string) {
    await this.request(id, user);
    const rows = await this.prisma.requestAttachment.findMany({
      where: { requestId: id },
      omit: { content: true },
      include: { uploadedBy: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((a) => ({ ...a, createdAt: a.createdAt.toISOString() }));
  }

  @Post()
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async upload(
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
    @Param('id', uuid) id: string,
    @Body(new ZodPipe(UploadAttachment)) body: z.infer<typeof UploadAttachment>,
  ) {
    const r = await this.request(id, user);
    if (r.status === 'CANCELLED' || !canDo(user, r.officeId, 'canEdit'))
      throw new ForbiddenException('Tu rol no puede adjuntar archivos a esta solicitud');
    const content = Buffer.from(body.fileBase64, 'base64');
    if (!content.length || content.length > MAX_ATTACHMENT_BYTES)
      throw new BadRequestException({
        code: 'ATTACHMENT',
        message: 'El archivo debe pesar entre 1 byte y 3 MB',
      });
    const mimeType = sniffMime(content, body.fileName);
    if (!mimeType)
      throw new BadRequestException({
        code: 'ATTACHMENT',
        message: 'Solo se aceptan PDF, imágenes PNG/JPG, Excel, Word, PowerPoint, CSV o texto',
      });
    return this.prisma.$transaction(async (tx) => {
      if ((await tx.requestAttachment.count({ where: { requestId: id } })) >= MAX_FILES)
        throw new ConflictException({
          code: 'ATTACHMENT',
          message: `Máximo ${MAX_FILES} archivos por solicitud`,
        });
      const a = await tx.requestAttachment.create({
        data: {
          requestId: id,
          fileName: body.fileName,
          mimeType,
          size: content.length,
          content,
          uploadedById: user.id,
        },
        omit: { content: true },
      });
      // File name and type only: the content may hold personal data.
      await audit(tx, {
        actorUserId: user.id,
        action: 'request.attachment_added',
        entityType: 'TravelRequest',
        entityId: id,
        correlationId: req.correlationId,
        diff: { attachmentId: a.id, fileName: a.fileName, mimeType, size: a.size },
      });
      return { ...a, createdAt: a.createdAt.toISOString() };
    });
  }

  @Get(':attachmentId')
  async download(
    @CurrentUser() user: AuthUser,
    @Param('id', uuid) id: string,
    @Param('attachmentId', uuid) attachmentId: string,
    @Res() res: Response,
  ) {
    await this.request(id, user);
    const a = await this.prisma.requestAttachment.findFirst({ where: { id: attachmentId, requestId: id } });
    if (!a) throw new NotFoundException('Archivo no encontrado');
    // Always a download, never rendered inline: an uploaded file must not run in our origin.
    res
      .set('X-Content-Type-Options', 'nosniff')
      .type(a.mimeType)
      .attachment(asciiName(a.fileName))
      .send(Buffer.from(a.content));
  }

  @Delete(':attachmentId')
  async remove(
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
    @Param('id', uuid) id: string,
    @Param('attachmentId', uuid) attachmentId: string,
  ) {
    const r = await this.request(id, user);
    const a = await this.prisma.requestAttachment.findFirst({
      where: { id: attachmentId, requestId: id },
      omit: { content: true },
    });
    if (!a) throw new NotFoundException('Archivo no encontrado');
    if (a.uploadedById !== user.id && !canDo(user, r.officeId, 'canDelete'))
      throw new ForbiddenException('Solo quien lo subió o un rol con permiso de borrar');
    await this.prisma.$transaction(async (tx) => {
      await tx.requestAttachment.delete({ where: { id: a.id } });
      await audit(tx, {
        actorUserId: user.id,
        action: 'request.attachment_removed',
        entityType: 'TravelRequest',
        entityId: id,
        correlationId: req.correlationId,
        diff: { attachmentId: a.id, fileName: a.fileName },
      });
    });
    return { ok: true };
  }
}
