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
  Patch,
  Post,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import {
  ContactInput,
  SupplierInput,
  SupplierRateInput,
  UpdateSupplier,
  UpdateSupplierRate,
} from '@ee/contracts';
import { Prisma, type PrismaClient } from '@ee/db';
import { audit } from '../audit.js';
import type { AuthUser } from '../auth/auth.types.js';
import { canSeeInternalCosts, isSystemAdmin, seesAnyInternalCosts } from '../auth/authz.js';
import { CurrentUser } from '../auth/session.guard.js';
import { PRISMA } from '../prisma.service.js';
import { ZodPipe } from '../zod.pipe.js';

const uuid = new ParseUUIDPipe({ version: '4' });
const duplicate = (e: unknown) => {
  if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002')
    throw new ConflictException({ code: 'DUPLICATE', message: 'Ya existe un proveedor con ese nombre' });
  throw e;
};
const toDate = (d: string | null | undefined) => (d === undefined ? undefined : d && new Date(d));
const rateDto = (r: Prisma.SupplierRateGetPayload<object>) => ({
  id: r.id,
  description: r.description,
  category: r.category,
  unitCost: r.unitCost.toFixed(2),
  currency: r.currency,
  validUntil: r.validUntil?.toISOString().slice(0, 10) ?? null,
  notes: r.notes,
  active: r.active,
});
const changes = (before: Record<string, unknown>, body: Record<string, string | boolean | null>) =>
  Object.fromEntries(Object.entries(body).map(([k, to]) => [k, { from: String(before[k] ?? ''), to }]));

/** The agency's supplier / DMC catalog: internal (costs), read by roles that see costs, maintained by its system admins. */
@Controller()
export class SuppliersController {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  private admin(user: AuthUser) {
    if (!isSystemAdmin(user)) throw new ForbiddenException('Solo un administrador del sistema');
  }

  @Get('suppliers')
  async list(@CurrentUser() user: AuthUser) {
    if (!seesAnyInternalCosts(user)) throw new ForbiddenException('Tu rol no ve costos internos');
    const all = isSystemAdmin(user);
    const rows = await this.prisma.supplier.findMany({
      where: { agencyId: user.agencyId, ...(all ? {} : { active: true }) },
      orderBy: { name: 'asc' },
      include: {
        rates: { where: all ? {} : { active: true }, orderBy: { description: 'asc' } },
        contacts: { orderBy: { createdAt: 'asc' }, omit: { supplierId: true, createdAt: true } },
      },
    });
    // Quote lines take the supplier's name in costSource when a rate is added (or typed in the sheet).
    const since = new Date(Date.now() - 365 * 864e5);
    const used = await this.prisma.quoteLine.findMany({
      where: {
        costSource: { in: rows.map((r) => r.name) },
        version: { createdAt: { gte: since }, scenario: { request: this.costOffices(user) } },
      },
      select: { costSource: true, versionId: true },
      distinct: ['costSource', 'versionId'],
    });
    const uses = new Map<string, number>();
    for (const u of used) uses.set(u.costSource!, (uses.get(u.costSource!) ?? 0) + 1);
    return rows.map(({ rates, agencyId: _a, createdAt: _c, updatedAt: _u, wissifySyncedAt, ...s }) => ({
      ...s,
      wissifySyncedAt: wissifySyncedAt?.toISOString() ?? null,
      quotes12m: uses.get(s.name) ?? 0,
      rates: rates.map(rateDto),
    }));
  }

  /** Offices whose costs the user sees: quotes elsewhere are not listed under a supplier. */
  private costOffices(user: AuthUser) {
    return { officeId: { in: user.agencyOfficeIds.filter((o) => canSeeInternalCosts(user, o)) } };
  }

  /** "Uso en cotizaciones": quote lines that took this supplier, newest first. */
  @Get('suppliers/:id/usage')
  async usage(@CurrentUser() user: AuthUser, @Param('id', uuid) id: string) {
    if (!seesAnyInternalCosts(user)) throw new ForbiddenException('Tu rol no ve costos internos');
    const s = await this.prisma.supplier.findFirst({ where: { id, agencyId: user.agencyId } });
    if (!s) throw new NotFoundException('Proveedor no encontrado');
    const lines = await this.prisma.quoteLine.findMany({
      where: { costSource: s.name, version: { scenario: { request: this.costOffices(user) } } },
      orderBy: { version: { createdAt: 'desc' } },
      take: 200,
      select: {
        id: true,
        description: true,
        unitCost: true,
        currency: true,
        version: {
          select: {
            id: true,
            number: true,
            status: true,
            createdAt: true,
            scenario: {
              select: {
                name: true,
                request: { select: { id: true, folio: true, groupName: true, clientName: true } },
              },
            },
          },
        },
      },
    });
    return lines.map((l) => ({
      id: l.id,
      description: l.description,
      unitCost: l.unitCost.toFixed(2),
      currency: l.currency,
      versionId: l.version.id,
      version: l.version.number,
      status: l.version.status,
      scenario: l.version.scenario.name,
      date: l.version.createdAt.toISOString().slice(0, 10),
      request: l.version.scenario.request,
    }));
  }

  @Post('suppliers/:id/contacts')
  addContact(
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
    @Param('id', uuid) supplierId: string,
    @Body(new ZodPipe(ContactInput)) body: ContactInput,
  ) {
    this.admin(user);
    return this.prisma.$transaction(async (tx) => {
      if (!(await tx.supplier.findFirst({ where: { id: supplierId, agencyId: user.agencyId } })))
        throw new NotFoundException('Proveedor no encontrado');
      const c = await tx.supplierContact.create({ data: { ...body, supplierId } });
      // Ids only: the person's name, email and phone stay in their table.
      await audit(tx, {
        actorUserId: user.id,
        action: 'supplier.contact_added',
        entityType: 'SupplierContact',
        entityId: c.id,
        correlationId: req.correlationId,
        diff: { supplierId },
      });
      return { id: c.id };
    });
  }

  @Delete('supplier-contacts/:id')
  async removeContact(@CurrentUser() user: AuthUser, @Req() req: Request, @Param('id', uuid) id: string) {
    this.admin(user);
    const c = await this.prisma.supplierContact.findFirst({
      where: { id, supplier: { agencyId: user.agencyId } },
    });
    if (!c) throw new NotFoundException('Contacto no encontrado');
    await this.prisma.$transaction(async (tx) => {
      await tx.supplierContact.delete({ where: { id } });
      await audit(tx, {
        actorUserId: user.id,
        action: 'supplier.contact_removed',
        entityType: 'SupplierContact',
        entityId: id,
        correlationId: req.correlationId,
        diff: { supplierId: c.supplierId },
      });
    });
    return { ok: true };
  }

  @Post('suppliers')
  create(
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
    @Body(new ZodPipe(SupplierInput)) body: SupplierInput,
  ) {
    this.admin(user);
    return this.prisma
      .$transaction(async (tx) => {
        const s = await tx.supplier.create({ data: { ...body, agencyId: user.agencyId } });
        await audit(tx, {
          actorUserId: user.id,
          action: 'supplier.created',
          entityType: 'Supplier',
          entityId: s.id,
          correlationId: req.correlationId,
          diff: { name: body.name },
        });
        return { id: s.id };
      })
      .catch(duplicate);
  }

  @Patch('suppliers/:id')
  update(
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
    @Param('id', uuid) id: string,
    @Body(new ZodPipe(UpdateSupplier)) body: UpdateSupplier,
  ) {
    this.admin(user);
    return this.prisma
      .$transaction(async (tx) => {
        const before = await tx.supplier.findFirst({ where: { id, agencyId: user.agencyId } });
        if (!before) throw new NotFoundException('Proveedor no encontrado');
        await tx.supplier.update({ where: { id }, data: body });
        await audit(tx, {
          actorUserId: user.id,
          action: 'supplier.updated',
          entityType: 'Supplier',
          entityId: id,
          correlationId: req.correlationId,
          // Contact fields stay out of the log; only which ones changed.
          diff: { fields: Object.keys(body), ...('active' in body ? { active: body.active } : {}) },
        });
        return { id };
      })
      .catch(duplicate);
  }

  @Post('suppliers/:id/rates')
  async addRate(
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
    @Param('id', uuid) supplierId: string,
    @Body(new ZodPipe(SupplierRateInput)) body: SupplierRateInput,
  ) {
    this.admin(user);
    return this.prisma.$transaction(async (tx) => {
      if (!(await tx.supplier.findFirst({ where: { id: supplierId, agencyId: user.agencyId } })))
        throw new NotFoundException('Proveedor no encontrado');
      const r = await tx.supplierRate.create({
        data: { ...body, supplierId, validUntil: toDate(body.validUntil) },
      });
      await audit(tx, {
        actorUserId: user.id,
        action: 'supplier_rate.created',
        entityType: 'SupplierRate',
        entityId: r.id,
        correlationId: req.correlationId,
        diff: { supplierId, ...body },
      });
      return rateDto(r);
    });
  }

  @Patch('supplier-rates/:id')
  async updateRate(
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
    @Param('id', uuid) id: string,
    @Body(new ZodPipe(UpdateSupplierRate)) body: UpdateSupplierRate,
  ) {
    this.admin(user);
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.supplierRate.findFirst({
        where: { id, supplier: { agencyId: user.agencyId } },
      });
      if (!before) throw new NotFoundException('Tarifa no encontrada');
      const r = await tx.supplierRate.update({
        where: { id },
        data: { ...body, validUntil: toDate(body.validUntil) },
      });
      await audit(tx, {
        actorUserId: user.id,
        action: 'supplier_rate.updated',
        entityType: 'SupplierRate',
        entityId: id,
        correlationId: req.correlationId,
        diff: changes({ ...before, validUntil: rateDto(before).validUntil }, body),
      });
      return rateDto(r);
    });
  }
}
