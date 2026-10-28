import { createHash, randomBytes } from 'node:crypto';
import {
  Body,
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
import { CreateProposalShare } from '@ee/contracts';
import type { PrismaClient, TravelRequest } from '@ee/db';
import type { z } from 'zod';
import { audit } from '../audit.js';
import type { AuthUser } from '../auth/auth.types.js';
import { hasOfficeRole } from '../auth/authz.js';
import { CurrentUser, Public } from '../auth/session.guard.js';
import { PRISMA } from '../prisma.service.js';
import { canView } from '../requests/request-policy.js';
import { ZodPipe } from '../zod.pipe.js';
import { clientProposal, full } from './quotes.controller.js';

const uuid = new ParseUUIDPipe({ version: '4' });
const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const hash = (token: string) => createHash('sha256').update(token).digest('hex');
const SHAREABLE = ['APPROVED', 'SENT'];
const OPEN = ['QUOTING', 'SENT', 'WON'];

/**
 * Link the school opens without an account (V2 "portal de la propuesta"). The token is shown once,
 * only its hash is stored; it works while the version is authorized, the request open, and the link
 * neither expired nor revoked. It serves the same client-safe proposal as the print view.
 */
@Controller()
export class ProposalShareController {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  private async version(id: string, user: AuthUser) {
    const v = await this.prisma.quoteVersion.findUnique({ where: { id }, include: full });
    const r = v && (await this.prisma.travelRequest.findUnique({ where: { id: v.scenario.requestId } }));
    if (!v || !r || !canView(user, r) || r.status === 'DRAFT')
      throw new NotFoundException('Cotización no encontrada');
    return { v, r };
  }

  /** Same people who send proposals: the assignee or the office admin. */
  private assertSender(user: AuthUser, r: TravelRequest) {
    if (!(r.assigneeId === user.id || hasOfficeRole(user, r.officeId, ['OFFICE_ADMIN'])))
      throw new ForbiddenException('Solo el cotizador asignado o el coordinador');
  }

  @Get('quotes/:id/shares')
  async list(@CurrentUser() user: AuthUser, @Param('id', uuid) id: string) {
    await this.version(id, user);
    const rows = await this.prisma.proposalShare.findMany({
      where: { versionId: id },
      omit: { tokenHash: true },
      include: { createdBy: { select: { name: true } } },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((s) => ({
      ...s,
      expiresAt: s.expiresAt.toISOString(),
      revokedAt: s.revokedAt?.toISOString() ?? null,
      lastViewAt: s.lastViewAt?.toISOString() ?? null,
      createdAt: s.createdAt.toISOString(),
    }));
  }

  @Post('quotes/:id/shares')
  async create(
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
    @Param('id', uuid) id: string,
    @Body(new ZodPipe(CreateProposalShare)) body: z.infer<typeof CreateProposalShare>,
  ) {
    const { v, r } = await this.version(id, user);
    this.assertSender(user, r);
    if (!SHAREABLE.includes(v.status) || !OPEN.includes(r.status))
      throw new ForbiddenException('Solo se comparte una cotización autorizada de una solicitud abierta');
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + body.days * 86_400_000);
    const share = await this.prisma.$transaction(async (tx) => {
      const s = await tx.proposalShare.create({
        data: { versionId: id, tokenHash: hash(token), expiresAt, createdById: user.id },
      });
      // Never the token: whoever reads the log must not be able to open the link.
      await audit(tx, {
        actorUserId: user.id,
        action: 'proposal.share_created',
        entityType: 'QuoteVersion',
        entityId: id,
        correlationId: req.correlationId,
        diff: { shareId: s.id, expiresAt: expiresAt.toISOString() },
      });
      return s;
    });
    return { id: share.id, token, expiresAt: expiresAt.toISOString() };
  }

  @Delete('quotes/:id/shares/:shareId')
  async revoke(
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
    @Param('id', uuid) id: string,
    @Param('shareId', uuid) shareId: string,
  ) {
    const { r } = await this.version(id, user);
    this.assertSender(user, r);
    const s = await this.prisma.proposalShare.findFirst({ where: { id: shareId, versionId: id } });
    if (!s) throw new NotFoundException('Liga no encontrada');
    if (!s.revokedAt)
      await this.prisma.$transaction(async (tx) => {
        await tx.proposalShare.update({ where: { id: s.id }, data: { revokedAt: new Date() } });
        await audit(tx, {
          actorUserId: user.id,
          action: 'proposal.share_revoked',
          entityType: 'QuoteVersion',
          entityId: id,
          correlationId: req.correlationId,
          diff: { shareId: s.id },
        });
      });
    return { ok: true };
  }

  /** A live share or the same 404 for every failure, so a guessed token learns nothing. */
  private async share(token: string) {
    const gone = new NotFoundException('Esta liga no existe o ya no está vigente');
    if (!TOKEN.test(token)) throw gone;
    const s = await this.prisma.proposalShare.findUnique({
      where: { tokenHash: hash(token) },
      include: { version: { include: full } },
    });
    if (!s || s.revokedAt || s.expiresAt <= new Date() || !SHAREABLE.includes(s.version.status)) throw gone;
    const r = await this.prisma.travelRequest.findUniqueOrThrow({
      where: { id: s.version.scenario.requestId },
    });
    if (!OPEN.includes(r.status)) throw gone;
    return { s, r };
  }

  /** Destination photo for the print view. */
  @Get('quotes/:id/proposal/cover')
  async cover(@CurrentUser() user: AuthUser, @Param('id', uuid) id: string, @Res() res: Response) {
    const { v } = await this.version(id, user);
    await this.sendCover(v.coverAttachmentId, res);
  }

  @Public()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Get('public/proposals/:token/cover')
  async publicCover(@Param('token') token: string, @Res() res: Response) {
    const { s } = await this.share(token);
    await this.sendCover(s.version.coverAttachmentId, res);
  }

  private async sendCover(attachmentId: string | null, res: Response) {
    const a =
      attachmentId && (await this.prisma.requestAttachment.findUnique({ where: { id: attachmentId } }));
    // Only sniffed JPG/PNG are ever chosen as cover; anything else is never rendered inline.
    if (!a || !a.mimeType.startsWith('image/')) throw new NotFoundException('Sin portada');
    res
      .set('X-Content-Type-Options', 'nosniff')
      .set('Cache-Control', 'private, max-age=300')
      .type(a.mimeType)
      .send(Buffer.from(a.content));
  }

  /** The school's view. */
  @Public()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Get('public/proposals/:token')
  async open(@Param('token') token: string) {
    const { s, r } = await this.share(token);
    await this.prisma.proposalShare.update({
      where: { id: s.id },
      data: { viewCount: { increment: 1 }, lastViewAt: new Date() },
    });
    const { request, id: _id, ...proposal } = clientProposal(s.version, r);
    const { id: _rid, ...publicRequest } = request;
    return { ...proposal, request: publicRequest, expiresAt: s.expiresAt.toISOString() };
  }
}
