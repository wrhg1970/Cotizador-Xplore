import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Inject,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Put,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { SetRequestTeam } from '@ee/contracts';
import type { PrismaClient } from '@ee/db';
import type { z } from 'zod';
import { audit } from '../audit.js';
import type { AuthUser } from '../auth/auth.types.js';
import { hasOfficeRole } from '../auth/authz.js';
import { CurrentUser } from '../auth/session.guard.js';
import { PRISMA } from '../prisma.service.js';
import { ZodPipe } from '../zod.pipe.js';
import { canView } from './request-policy.js';

const uuid = new ParseUUIDPipe({ version: '4' });

/** Request team (V2): a commercial executive and support people, picked by the requester or the office admin. */
@Controller('requests/:id/team')
export class RequestTeamController {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  private async request(id: string, user: AuthUser) {
    const r = await this.prisma.travelRequest.findUnique({ where: { id } });
    if (!r || !canView(user, r)) throw new NotFoundException('Solicitud no encontrada');
    return r;
  }

  private members(requestId: string) {
    return this.prisma.requestMember.findMany({
      where: { requestId },
      select: { kind: true, user: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'asc' },
    });
  }

  @Get()
  async get(@CurrentUser() user: AuthUser, @Param('id', uuid) id: string) {
    await this.request(id, user);
    return this.members(id);
  }

  /** Who can be picked: active people of the request's office (names only). */
  @Get('candidates')
  async candidates(@CurrentUser() user: AuthUser, @Param('id', uuid) id: string) {
    const r = await this.request(id, user);
    return this.prisma.user.findMany({
      where: { status: { not: 'DISABLED' }, officeRoles: { some: { officeId: r.officeId } } },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    });
  }

  @Put()
  async set(
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
    @Param('id', uuid) id: string,
    @Body(new ZodPipe(SetRequestTeam)) body: z.infer<typeof SetRequestTeam>,
  ) {
    const r = await this.request(id, user);
    if (['WON', 'LOST', 'CANCELLED'].includes(r.status))
      throw new ForbiddenException('La solicitud ya está cerrada');
    if (r.requesterId !== user.id && !hasOfficeRole(user, r.officeId, ['OFFICE_ADMIN']))
      throw new ForbiddenException('Solo el solicitante o el coordinador arman el equipo');
    const ids = [...(body.commercialExecutiveId ? [body.commercialExecutiveId] : []), ...body.supportIds];
    // Same office only (IDOR/BOLA): nobody from another office lands on this request.
    const inOffice = await this.prisma.userOfficeRole.findMany({
      where: { officeId: r.officeId, userId: { in: ids }, user: { status: { not: 'DISABLED' } } },
      select: { userId: true },
      distinct: ['userId'],
    });
    if (inOffice.length !== ids.length)
      throw new BadRequestException({
        code: 'TEAM',
        message: 'Todas las personas deben pertenecer a la oficina',
      });
    const before = await this.members(id);
    await this.prisma.$transaction(async (tx) => {
      await tx.requestMember.deleteMany({ where: { requestId: id } });
      await tx.requestMember.createMany({
        data: ids.map((userId) => ({
          requestId: id,
          userId,
          kind: userId === body.commercialExecutiveId ? ('COMMERCIAL' as const) : ('SUPPORT' as const),
        })),
      });
      await audit(tx, {
        actorUserId: user.id,
        action: 'request.team_updated',
        entityType: 'TravelRequest',
        entityId: id,
        correlationId: req.correlationId,
        diff: {
          before: before.map((m) => ({ kind: m.kind, userId: m.user.id })),
          after: { commercialExecutiveId: body.commercialExecutiveId, supportIds: body.supportIds },
        },
      });
    });
    return this.members(id);
  }
}
