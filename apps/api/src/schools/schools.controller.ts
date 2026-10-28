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
  Query,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { CreateSchoolContact } from '@ee/contracts';
import type { Prisma, PrismaClient } from '@ee/db';
import { z } from 'zod';
import { audit } from '../audit.js';
import type { AuthUser } from '../auth/auth.types.js';
import { hasOfficeRole, officeScope, officesWithRole } from '../auth/authz.js';
import { CurrentUser } from '../auth/session.guard.js';
import { PRISMA } from '../prisma.service.js';
import { ZodPipe } from '../zod.pipe.js';

const uuid = new ParseUUIDPipe({ version: '4' });

/** "Colegio Americano  de Monterrey" and "colegio americano de monterrey" are the same school. */
export const schoolKey = (name: string) =>
  name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

const SchoolQuery = z.strictObject({ officeId: z.uuid(), key: z.string().min(1).max(200) });
const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
const conversion = (won: number, lost: number) => (won + lost ? won / (won + lost) : null);

/**
 * Ficha por colegio: trips, conversion and contacts per school and office, built from the
 * requests' client name. Same visibility as the request list (office scope, drafts private).
 */
@Controller('schools')
export class SchoolsController {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  private visible(user: AuthUser): Prisma.TravelRequestWhereInput {
    const scope = officeScope(user);
    const admin = officesWithRole(user, ['OFFICE_ADMIN']);
    return {
      clientName: { not: null },
      officeId: { in: scope },
      OR: [{ status: { not: 'DRAFT' } }, { requesterId: user.id }, { officeId: { in: admin } }],
    };
  }

  private assertMember(user: AuthUser, officeId: string) {
    if (!officeScope(user).includes(officeId)) throw new NotFoundException('Colegio no encontrado');
  }

  // shortcut: grouped in memory; fine for hundreds of requests per office, move to SQL GROUP BY beyond that.
  @Get()
  async list(@CurrentUser() user: AuthUser) {
    const rows = await this.prisma.travelRequest.findMany({
      where: this.visible(user),
      select: {
        clientName: true,
        status: true,
        departureDate: true,
        officeId: true,
        office: { select: { code: true } },
      },
    });
    const schools = new Map<
      string,
      {
        officeId: string;
        officeCode: string;
        key: string;
        name: string;
        requests: number;
        won: number;
        lost: number;
        lastDeparture: Date;
      }
    >();
    for (const r of rows) {
      const key = schoolKey(r.clientName!);
      if (!key) continue;
      const id = `${r.officeId}|${key}`;
      const s = schools.get(id) ?? {
        officeId: r.officeId,
        officeCode: r.office.code,
        key,
        name: r.clientName!.trim(),
        requests: 0,
        won: 0,
        lost: 0,
        lastDeparture: r.departureDate,
      };
      s.requests++;
      if (r.status === 'WON') s.won++;
      if (r.status === 'LOST') s.lost++;
      if (r.departureDate > s.lastDeparture) s.lastDeparture = r.departureDate;
      schools.set(id, s);
    }
    return [...schools.values()]
      .map((s) => ({ ...s, conversion: conversion(s.won, s.lost), lastDeparture: day(s.lastDeparture) }))
      .sort((a, b) => b.requests - a.requests || a.name.localeCompare(b.name, 'es'));
  }

  @Get('detail')
  async detail(
    @CurrentUser() user: AuthUser,
    @Query(new ZodPipe(SchoolQuery)) q: z.infer<typeof SchoolQuery>,
  ) {
    this.assertMember(user, q.officeId);
    const all = await this.prisma.travelRequest.findMany({
      where: { ...this.visible(user), officeId: q.officeId },
      select: {
        id: true,
        folio: true,
        clientName: true,
        groupName: true,
        status: true,
        departureDate: true,
        participants: true,
        wonVersion: {
          select: { acceptance: { select: { signerName: true, signerRole: true, acceptedAt: true } } },
        },
      },
      orderBy: { departureDate: 'desc' },
    });
    const trips = all.filter((r) => schoolKey(r.clientName!) === q.key);
    const contacts = await this.prisma.schoolContact.findMany({
      where: { officeId: q.officeId, schoolKey: q.key },
      select: { id: true, name: true, role: true, email: true, phone: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    });
    if (!trips.length && !contacts.length) throw new NotFoundException('Colegio no encontrado');
    const won = trips.filter((t) => t.status === 'WON').length;
    const lost = trips.filter((t) => t.status === 'LOST').length;
    return {
      name: trips[0]?.clientName?.trim() ?? q.key,
      officeId: q.officeId,
      key: q.key,
      conversion: conversion(won, lost),
      trips: trips.map(({ wonVersion, clientName: _c, departureDate, ...t }) => ({
        ...t,
        departureDate: day(departureDate),
        acceptedBy: wonVersion?.acceptance
          ? { ...wonVersion.acceptance, acceptedAt: wonVersion.acceptance.acceptedAt.toISOString() }
          : null,
      })),
      contacts: contacts.map((c) => ({ ...c, createdAt: c.createdAt.toISOString() })),
    };
  }

  @Post('contacts')
  async addContact(
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
    @Body(new ZodPipe(CreateSchoolContact)) body: z.infer<typeof CreateSchoolContact>,
  ) {
    this.assertMember(user, body.officeId);
    const key = schoolKey(body.schoolName);
    if (!key) throw new ForbiddenException('Nombre de colegio no válido');
    return this.prisma.$transaction(async (tx) => {
      const c = await tx.schoolContact.create({
        data: { ...body, schoolKey: key, schoolName: body.schoolName.trim(), createdById: user.id },
      });
      // Ids only: the contact's name, email and phone stay in their table.
      await audit(tx, {
        actorUserId: user.id,
        action: 'school.contact_added',
        entityType: 'SchoolContact',
        entityId: c.id,
        officeId: body.officeId,
        correlationId: req.correlationId,
        diff: { officeId: body.officeId, schoolKey: key },
      });
      return { id: c.id };
    });
  }

  @Delete('contacts/:id')
  async removeContact(@CurrentUser() user: AuthUser, @Req() req: Request, @Param('id', uuid) id: string) {
    const c = await this.prisma.schoolContact.findUnique({ where: { id } });
    if (!c) throw new NotFoundException('Contacto no encontrado');
    this.assertMember(user, c.officeId);
    if (c.createdById !== user.id && !hasOfficeRole(user, c.officeId, ['OFFICE_ADMIN']))
      throw new ForbiddenException('Solo quien lo agregó o el coordinador');
    await this.prisma.$transaction(async (tx) => {
      await tx.schoolContact.delete({ where: { id } });
      await audit(tx, {
        actorUserId: user.id,
        action: 'school.contact_removed',
        entityType: 'SchoolContact',
        entityId: id,
        officeId: c.officeId,
        correlationId: req.correlationId,
        diff: { officeId: c.officeId, schoolKey: c.schoolKey },
      });
    });
    return { ok: true };
  }
}
