import {
  Body,
  ConflictException,
  Controller,
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
import { SupplierInput, SupplierRateInput, UpdateSupplier, UpdateSupplierRate } from '@ee/contracts';
import { Prisma, type PrismaClient } from '@ee/db';
import { audit } from '../audit.js';
import type { AuthUser } from '../auth/auth.types.js';
import { isSystemAdmin, seesAnyInternalCosts } from '../auth/authz.js';
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

/** Supplier / DMC catalog: internal (costs), read by roles that see costs, maintained by system admins. */
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
      where: all ? {} : { active: true },
      orderBy: { name: 'asc' },
      include: { rates: { where: all ? {} : { active: true }, orderBy: { description: 'asc' } } },
    });
    return rows.map(({ rates, createdAt: _c, updatedAt: _u, ...s }) => ({ ...s, rates: rates.map(rateDto) }));
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
        const s = await tx.supplier.create({ data: body });
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
        const before = await tx.supplier.findUnique({ where: { id } });
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
      if (!(await tx.supplier.findUnique({ where: { id: supplierId } })))
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
      const before = await tx.supplierRate.findUnique({ where: { id } });
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
