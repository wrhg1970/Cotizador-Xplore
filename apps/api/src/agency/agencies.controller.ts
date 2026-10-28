import {
  BadRequestException,
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
import { CreateAgency, UpdateAgency } from '@ee/contracts';
import { EE_AGENCY_ID, Prisma, type PrismaClient } from '@ee/db';
import { audit } from '../audit.js';
import type { AuthUser } from '../auth/auth.types.js';
import { isPlatformAdmin } from '../auth/authz.js';
import { CurrentUser } from '../auth/session.guard.js';
import { PRISMA } from '../prisma.service.js';
import { ZodPipe } from '../zod.pipe.js';

const uuid = new ParseUUIDPipe({ version: '4' });
const LIST = {
  id: true,
  code: true,
  name: true,
  active: true,
  allowedDomains: true,
  customDomain: true,
  _count: { select: { offices: true, users: true } },
} as const;

/**
 * Agencies using the cotizador (Administración → Agencias). Only EE's system admins register them;
 * each agency then runs itself through its own system admin.
 */
@Controller('agencies')
export class AgenciesController {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  private platform(user: AuthUser) {
    if (!isPlatformAdmin(user)) throw new ForbiddenException('Solo un administrador de Xplore Together');
  }

  @Get()
  async list(@CurrentUser() user: AuthUser) {
    this.platform(user);
    const rows = await this.prisma.agency.findMany({ select: LIST, orderBy: { name: 'asc' } });
    return rows.map(({ _count, ...a }) => ({ ...a, ..._count }));
  }

  /** The agency, its first office and its first system admin (invited: they sign in with Google). */
  @Post()
  async create(
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
    @Body(new ZodPipe(CreateAgency)) body: CreateAgency,
  ) {
    this.platform(user);
    const domain = body.adminEmail.split('@')[1] ?? '';
    if (!body.allowedDomains.includes(domain))
      throw new BadRequestException({
        code: 'DOMAIN_NOT_ALLOWED',
        message: 'El correo del administrador debe ser de uno de los dominios de la agencia',
      });
    return this.prisma
      .$transaction(async (tx) => {
        if (await tx.user.findUnique({ where: { email: body.adminEmail } }))
          throw new ConflictException({ code: 'OTHER_AGENCY', message: 'Ese correo ya tiene cuenta' });
        const agency = await tx.agency.create({
          data: { code: body.code, name: body.name, allowedDomains: body.allowedDomains },
        });
        const office = await tx.office.create({
          data: { agencyId: agency.id, code: body.officeCode, name: body.officeName },
        });
        const admin = await tx.user.create({
          data: {
            agencyId: agency.id,
            email: body.adminEmail,
            name: body.adminName,
            officeRoles: { create: { officeId: office.id, role: 'SYSTEM_ADMIN' } },
          },
        });
        // Starting catalog: EE's sheet concepts, so the first scenario isn't empty. The agency edits its copy.
        const concepts = await tx.conceptTemplate.findMany({
          where: { agencyId: EE_AGENCY_ID, active: true },
          omit: { id: true, agencyId: true, createdAt: true, updatedAt: true },
        });
        await tx.conceptTemplate.createMany({ data: concepts.map((c) => ({ ...c, agencyId: agency.id })) });
        await audit(tx, {
          actorUserId: user.id,
          agencyId: user.agencyId,
          action: 'agency.created',
          entityType: 'Agency',
          entityId: agency.id,
          correlationId: req.correlationId,
          diff: {
            code: body.code,
            name: body.name,
            allowedDomains: body.allowedDomains,
            officeId: office.id,
          },
        });
        // Also in the new agency's own log, so its admins see how it started.
        await audit(tx, {
          actorUserId: user.id,
          agencyId: agency.id,
          action: 'user.role_granted',
          entityType: 'User',
          entityId: admin.id,
          correlationId: req.correlationId,
          diff: { officeId: office.id, role: 'SYSTEM_ADMIN' },
        });
        return { id: agency.id, officeId: office.id, adminId: admin.id };
      })
      .catch((e: unknown) => {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002')
          throw new ConflictException('Ya existe una agencia con ese código');
        throw e;
      });
  }

  @Patch(':id')
  async update(
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
    @Param('id', uuid) id: string,
    @Body(new ZodPipe(UpdateAgency)) body: UpdateAgency,
  ) {
    this.platform(user);
    if (id === EE_AGENCY_ID && body.active === false)
      throw new ForbiddenException('Estudiantes Embajadores no se puede desactivar');
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.agency.findUnique({ where: { id }, select: LIST });
      if (!before) throw new NotFoundException('Agencia no encontrada');
      const after = await tx.agency.update({ where: { id }, data: body, select: LIST });
      // Deactivating takes effect on each user's next request; their sessions also end now.
      if (body.active === false) await tx.session.deleteMany({ where: { user: { agencyId: id } } });
      await audit(tx, {
        actorUserId: user.id,
        agencyId: user.agencyId,
        action: 'agency.updated',
        entityType: 'Agency',
        entityId: id,
        correlationId: req.correlationId,
        diff: {
          before: { name: before.name, allowedDomains: before.allowedDomains, active: before.active },
          after: body,
        },
      });
      const { _count, ...a } = after;
      return { ...a, ..._count };
    });
  }
}
