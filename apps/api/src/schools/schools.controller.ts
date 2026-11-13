import {
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
  Put,
  Query,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { ClientInput, CreateSchoolContact } from '@ee/contracts';
import type { Client, Prisma, PrismaClient } from '@ee/db';
import { z } from 'zod';
import { audit } from '../audit.js';
import type { AuthUser } from '../auth/auth.types.js';
import { canDo, hasOfficeRole, isSystemAdmin, officeScope, officesWithRole } from '../auth/authz.js';
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
/** The ficha's own data; null fields while the school only exists in requests. */
const clientDto = (c: Client | null | undefined) => ({
  kind: c?.kind ?? null,
  legalName: c?.legalName ?? null,
  taxId: c?.taxId ?? null,
  levels: c?.levels ?? null,
  website: c?.website ?? null,
  address: c?.address ?? null,
  postalCode: c?.postalCode ?? null,
  city: c?.city ?? null,
  state: c?.state ?? null,
  country: c?.country ?? null,
  notes: c?.notes ?? null,
  active: c?.active ?? true,
  wissifyId: c?.wissifyId ?? null,
  wissifySyncedAt: c?.wissifySyncedAt?.toISOString() ?? null,
});

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
      archivedAt: null,
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
        office: { select: { code: true, name: true } },
      },
    });
    const scope = officeScope(user);
    const [clients, contacts, offices] = await Promise.all([
      this.prisma.client.findMany({ where: { officeId: { in: scope } } }),
      this.prisma.schoolContact.findMany({
        where: { officeId: { in: scope } },
        select: { officeId: true, schoolKey: true, name: true, role: true },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.office.findMany({
        where: { id: { in: scope } },
        select: { id: true, code: true, name: true },
      }),
    ]);
    const officeOf = new Map(offices.map((o) => [o.id, o]));
    const schools = new Map<
      string,
      {
        officeId: string;
        officeCode: string;
        officeName: string;
        key: string;
        name: string;
        requests: number;
        won: number;
        lost: number;
        lastDeparture: Date | null;
      }
    >();
    for (const r of rows) {
      const key = schoolKey(r.clientName!);
      if (!key) continue;
      const id = `${r.officeId}|${key}`;
      const s = schools.get(id) ?? {
        officeId: r.officeId,
        officeCode: r.office.code,
        officeName: r.office.name,
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
      if (!s.lastDeparture || r.departureDate > s.lastDeparture) s.lastDeparture = r.departureDate;
      schools.set(id, s);
    }
    // "Nuevo cliente" rows with no request yet.
    for (const c of clients) {
      const id = `${c.officeId}|${c.key}`;
      const o = officeOf.get(c.officeId);
      if (!schools.has(id) && o)
        schools.set(id, {
          officeId: c.officeId,
          officeCode: o.code,
          officeName: o.name,
          key: c.key,
          name: c.name,
          requests: 0,
          won: 0,
          lost: 0,
          lastDeparture: null,
        });
    }
    const clientOf = new Map(clients.map((c) => [`${c.officeId}|${c.key}`, c]));
    const primary = new Map<string, { name: string; role: string | null }>();
    for (const c of contacts) {
      const id = `${c.officeId}|${c.schoolKey}`;
      if (!primary.has(id)) primary.set(id, { name: c.name, role: c.role });
    }
    return [...schools]
      .map(([id, s]) => {
        const c = clientOf.get(id);
        return {
          ...s,
          name: c?.name ?? s.name,
          ...clientDto(c),
          contact: primary.get(id) ?? null,
          conversion: conversion(s.won, s.lost),
          lastDeparture: day(s.lastDeparture),
        };
      })
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
    const client = await this.prisma.client.findUnique({
      where: { officeId_key: { officeId: q.officeId, key: q.key } },
    });
    if (!trips.length && !contacts.length && !client) throw new NotFoundException('Cliente no encontrado');
    const won = trips.filter((t) => t.status === 'WON').length;
    const lost = trips.filter((t) => t.status === 'LOST').length;
    return {
      name: client?.name ?? trips[0]?.clientName?.trim() ?? q.key,
      ...clientDto(client),
      canEdit: canDo(user, q.officeId, 'canEdit'),
      canDelete: isSystemAdmin(user),
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

  /** Ficha "Datos": saves a client; without `key` it is a "Nuevo cliente" (409 if it already has a ficha). */
  @Put('client')
  async saveClient(
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
    @Body(new ZodPipe(ClientInput)) body: ClientInput,
  ) {
    this.assertMember(user, body.officeId);
    const { officeId, key: given, ...data } = body;
    const key = given ?? schoolKey(data.name);
    if (!key) throw new ForbiddenException('Nombre de cliente no válido');
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.client.findUnique({ where: { officeId_key: { officeId, key } } });
      if (!given && before) throw new ConflictException('Ya existe un cliente con ese nombre en la oficina');
      if (!canDo(user, officeId, before ? 'canEdit' : 'canCreate'))
        throw new ForbiddenException('Tu rol no puede editar clientes');
      const c = await tx.client.upsert({
        where: { officeId_key: { officeId, key } },
        create: { ...data, officeId, key },
        update: data,
      });
      // Field names only: RFC, address and notes stay in their table.
      await audit(tx, {
        actorUserId: user.id,
        action: before ? 'client.updated' : 'client.created',
        entityType: 'Client',
        entityId: c.id,
        officeId,
        correlationId: req.correlationId,
        diff: { key, fields: Object.keys(data), ...('active' in data ? { active: data.active } : {}) },
      });
      return { officeId, key };
    });
  }

  /** Borrar: system admins only, and only a client with no request at all (archived and drafts count). */
  @Delete('client')
  async removeClient(
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
    @Query(new ZodPipe(SchoolQuery)) q: z.infer<typeof SchoolQuery>,
  ) {
    this.assertMember(user, q.officeId);
    if (!isSystemAdmin(user)) throw new ForbiddenException('Solo un administrador del sistema');
    return this.prisma.$transaction(async (tx) => {
      const requests = await tx.travelRequest.findMany({
        where: { officeId: q.officeId, clientName: { not: null } },
        select: { clientName: true },
      });
      if (requests.some((r) => schoolKey(r.clientName!) === q.key))
        throw new ConflictException({
          code: 'IN_USE',
          message: 'No se puede borrar: tiene solicitudes. Desactívalo para ocultarlo.',
        });
      const where = { officeId: q.officeId, key: q.key };
      const client = await tx.client.findUnique({ where: { officeId_key: where } });
      const contacts = await tx.schoolContact.deleteMany({
        where: { officeId: q.officeId, schoolKey: q.key },
      });
      if (!client && !contacts.count) throw new NotFoundException('Cliente no encontrado');
      if (client) await tx.client.delete({ where: { id: client.id } });
      await audit(tx, {
        actorUserId: user.id,
        action: 'client.deleted',
        entityType: 'Client',
        entityId: client?.id ?? q.key,
        officeId: q.officeId,
        correlationId: req.correlationId,
        diff: { key: q.key, contacts: contacts.count },
      });
      return { ok: true };
    });
  }

  @Post('contacts')
  async addContact(
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
    @Body(new ZodPipe(CreateSchoolContact)) body: z.infer<typeof CreateSchoolContact>,
  ) {
    this.assertMember(user, body.officeId);
    const { key: given, ...contact } = body;
    const key = given ?? schoolKey(body.schoolName);
    if (!key) throw new ForbiddenException('Nombre de colegio no válido');
    return this.prisma.$transaction(async (tx) => {
      const c = await tx.schoolContact.create({
        data: { ...contact, schoolKey: key, schoolName: body.schoolName.trim(), createdById: user.id },
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
