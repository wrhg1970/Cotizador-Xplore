import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { CreateOffice, InviteUser, type Me, OfficeRoleInput, UpdateOffice, UserOffices } from '@ee/contracts';
import type { PrismaClient } from '@ee/db';
import { audit } from '../audit.js';
import type { AuthUser } from '../auth/auth.types.js';
import { canGrantRole, hasOfficeRole, isSystemAdmin, officeScope } from '../auth/authz.js';
import { CurrentUser } from '../auth/session.guard.js';
import { ENV, type Env } from '../env.js';
import { PRISMA } from '../prisma.service.js';
import { ZodPipe } from '../zod.pipe.js';

const uuid = new ParseUUIDPipe({ version: '4' });

@Controller()
export class UsersController {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(ENV) private readonly env: Env,
  ) {}

  @Get('me')
  me(@CurrentUser() user: AuthUser): Me {
    return user;
  }

  @Get('offices')
  offices(@CurrentUser() user: AuthUser) {
    const scope = officeScope(user);
    return this.prisma.office.findMany({
      where: { active: true, ...(scope === 'ALL' ? {} : { id: { in: scope } }) },
      select: { id: true, code: true, name: true },
      orderBy: { name: 'asc' },
    });
  }

  @Post('offices')
  async createOffice(
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
    @Body(new ZodPipe(CreateOffice)) body: CreateOffice,
  ) {
    if (!isSystemAdmin(user)) throw new ForbiddenException();
    return this.prisma.$transaction(async (tx) => {
      if (await tx.office.findUnique({ where: { code: body.code } }))
        throw new ConflictException('Código duplicado');
      const office = await tx.office.create({ data: body, select: { id: true, code: true, name: true } });
      await audit(tx, {
        actorUserId: user.id,
        action: 'office.created',
        entityType: 'Office',
        entityId: office.id,
        correlationId: req.correlationId,
        diff: body,
      });
      return office;
    });
  }

  /** Administration: every office, inactive ones too, with what hangs from it. */
  @Get('offices/all')
  async allOffices(@CurrentUser() user: AuthUser) {
    if (!isSystemAdmin(user)) throw new ForbiddenException();
    const rows = await this.prisma.office.findMany({
      select: {
        id: true,
        code: true,
        name: true,
        active: true,
        _count: { select: { requests: true, userRoles: true, templates: true } },
      },
      orderBy: { code: 'asc' },
    });
    return rows.map(({ _count, ...o }) => ({ ...o, ..._count }));
  }

  @Patch('offices/:id')
  async updateOffice(
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
    @Param('id', uuid) id: string,
    @Body(new ZodPipe(UpdateOffice)) body: UpdateOffice,
  ) {
    if (!isSystemAdmin(user)) throw new ForbiddenException();
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.office.findUnique({ where: { id } });
      if (!before) throw new NotFoundException('Oficina no encontrada');
      if (
        body.code &&
        body.code !== before.code &&
        (await tx.office.findUnique({ where: { code: body.code } }))
      )
        throw new ConflictException('Código duplicado');
      const office = await tx.office.update({
        where: { id },
        data: body,
        select: { id: true, code: true, name: true, active: true },
      });
      await audit(tx, {
        actorUserId: user.id,
        action: 'office.updated',
        entityType: 'Office',
        entityId: id,
        correlationId: req.correlationId,
        diff: { before: { code: before.code, name: before.name, active: before.active }, after: body },
      });
      return office;
    });
  }

  /** Real delete only for an empty office; one with history is deactivated instead (PATCH active=false). */
  @Delete('offices/:id')
  @HttpCode(204)
  async deleteOffice(@CurrentUser() user: AuthUser, @Req() req: Request, @Param('id', uuid) id: string) {
    if (!isSystemAdmin(user)) throw new ForbiddenException();
    await this.prisma.$transaction(async (tx) => {
      const office = await tx.office.findUnique({
        where: { id },
        include: { _count: { select: { requests: true, userRoles: true, templates: true } } },
      });
      if (!office) throw new NotFoundException('Oficina no encontrada');
      const { requests, userRoles, templates } = office._count;
      if (requests + userRoles + templates > 0)
        throw new ConflictException(
          'La oficina tiene solicitudes, usuarios o plantillas: desactívala para conservar su historial',
        );
      await tx.office.delete({ where: { id } });
      await audit(tx, {
        actorUserId: user.id,
        action: 'office.deleted',
        entityType: 'Office',
        entityId: id,
        correlationId: req.correlationId,
        diff: { code: office.code, name: office.name },
      });
    });
  }

  /** US-002 / US-006: list users of one office; admins of that office only. */
  @Get('users')
  async users(@CurrentUser() user: AuthUser, @Query('officeId', uuid) officeId: string) {
    if (!hasOfficeRole(user, officeId, ['OFFICE_ADMIN'])) throw new NotFoundException();
    const rows = await this.prisma.user.findMany({
      where: { officeRoles: { some: { officeId } } },
      select: {
        id: true,
        email: true,
        name: true,
        status: true,
        officeRoles: { select: { id: true, role: true, officeId: true } },
      },
      orderBy: { name: 'asc' },
    });
    // Other offices of a user are only shown to system admins, the only ones who can change them.
    const sysAdmin = isSystemAdmin(user);
    return rows.map(({ officeRoles, ...u }) => ({
      ...u,
      officeRoles: officeRoles.filter((r) => r.officeId === officeId).map(({ id, role }) => ({ id, role })),
      ...(sysAdmin && { officeIds: [...new Set(officeRoles.map((r) => r.officeId))] }),
    }));
  }

  /** V2 "oficinas con acceso": the user's privileges (except system admin) apply in exactly these offices. */
  @Put('users/:id/offices')
  async setOffices(
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
    @Param('id', uuid) id: string,
    @Body(new ZodPipe(UserOffices)) body: UserOffices,
  ) {
    if (!isSystemAdmin(user)) throw new ForbiddenException('Solo un administrador del sistema');
    const officeIds = [...new Set(body.officeIds)];
    return this.prisma.$transaction(async (tx) => {
      const current = await tx.userOfficeRole.findMany({
        where: { userId: id, role: { not: 'SYSTEM_ADMIN' } },
      });
      if (!(await tx.user.findUnique({ where: { id } }))) throw new NotFoundException();
      const roles = [...new Set(current.map((g) => g.role))];
      if (!roles.length)
        throw new BadRequestException({
          code: 'NO_ROLES',
          message: 'Asígnale primero un privilegio en alguna oficina',
        });
      const active = await tx.office.count({ where: { id: { in: officeIds }, active: true } });
      if (active !== officeIds.length) throw new NotFoundException('Oficina no encontrada');
      await tx.userOfficeRole.deleteMany({
        where: { userId: id, role: { not: 'SYSTEM_ADMIN' }, officeId: { notIn: officeIds } },
      });
      await tx.userOfficeRole.createMany({
        data: officeIds.flatMap((officeId) => roles.map((role) => ({ userId: id, officeId, role }))),
        skipDuplicates: true,
      });
      const before = [...new Set(current.map((g) => g.officeId))];
      await audit(tx, {
        actorUserId: user.id,
        action: 'user.offices_updated',
        entityType: 'User',
        entityId: id,
        correlationId: req.correlationId,
        diff: { roles, before, after: officeIds },
      });
      return { officeIds, roles };
    });
  }

  /** US-002: invite (or re-grant) a user into an office with one role. */
  @Post('users')
  async invite(
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
    @Body(new ZodPipe(InviteUser)) body: InviteUser,
  ) {
    if (!canGrantRole(user, body.officeId, body.role)) throw new ForbiddenException();
    const domain = body.email.split('@')[1] ?? '';
    if (!this.env.ALLOWED_GOOGLE_DOMAINS.includes(domain)) {
      throw new BadRequestException({
        code: 'DOMAIN_NOT_ALLOWED',
        message: 'Dominio de correo no permitido',
      });
    }
    return this.prisma.$transaction(async (tx) => {
      await this.assertOffice(tx, body.officeId);
      const invited = await tx.user.upsert({
        where: { email: body.email },
        update: {},
        create: { email: body.email, name: body.name },
        select: { id: true, email: true, name: true, status: true },
      });
      await this.grant(tx, user, req, invited.id, body.officeId, body.role);
      return invited;
    });
  }

  /** US-003 */
  @Post('users/:id/roles')
  async addRole(
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
    @Param('id', uuid) id: string,
    @Body(new ZodPipe(OfficeRoleInput)) body: OfficeRoleInput,
  ) {
    if (!canGrantRole(user, body.officeId, body.role)) throw new ForbiddenException();
    await this.prisma.$transaction(async (tx) => {
      await this.assertOffice(tx, body.officeId);
      if (!(await tx.user.findUnique({ where: { id } }))) throw new NotFoundException();
      await this.grant(tx, user, req, id, body.officeId, body.role);
    });
    return { ok: true };
  }

  @Delete('users/:id/roles/:roleId')
  @HttpCode(204)
  async removeRole(
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
    @Param('id', uuid) id: string,
    @Param('roleId', uuid) roleId: string,
  ) {
    await this.prisma.$transaction(async (tx) => {
      const grant = await tx.userOfficeRole.findFirst({ where: { id: roleId, userId: id } });
      // 404, not 403, so ids from other offices reveal nothing (US-004).
      if (!grant || !canGrantRole(user, grant.officeId, grant.role)) throw new NotFoundException();
      if (id === user.id && grant.role === 'SYSTEM_ADMIN') {
        throw new ForbiddenException('No puedes quitarte tu propio rol de administrador del sistema');
      }
      await tx.userOfficeRole.delete({ where: { id: roleId } });
      await audit(tx, {
        actorUserId: user.id,
        action: 'user.role_revoked',
        entityType: 'User',
        entityId: id,
        correlationId: req.correlationId,
        diff: { officeId: grant.officeId, role: grant.role },
      });
    });
  }

  /** US-002: disabled users lose access on their next request; sessions are dropped now. */
  @Post('users/:id/disable')
  @HttpCode(204)
  async disable(@CurrentUser() user: AuthUser, @Req() req: Request, @Param('id', uuid) id: string) {
    if (!isSystemAdmin(user)) throw new ForbiddenException();
    if (id === user.id) throw new ForbiddenException('No puedes desactivarte a ti mismo');
    await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.user.updateMany({ where: { id }, data: { status: 'DISABLED' } });
      if (!count) throw new NotFoundException();
      await tx.session.deleteMany({ where: { userId: id } });
      await audit(tx, {
        actorUserId: user.id,
        action: 'user.disabled',
        entityType: 'User',
        entityId: id,
        correlationId: req.correlationId,
      });
    });
  }

  private async assertOffice(tx: Pick<PrismaClient, 'office'>, officeId: string): Promise<void> {
    const office = await tx.office.findUnique({ where: { id: officeId } });
    if (!office?.active) throw new NotFoundException('Oficina no encontrada');
  }

  private async grant(
    tx: Parameters<Parameters<PrismaClient['$transaction']>[0]>[0],
    actor: AuthUser,
    req: Request,
    userId: string,
    officeId: string,
    role: OfficeRoleInput['role'],
  ): Promise<void> {
    const existing = await tx.userOfficeRole.findUnique({
      where: { userId_officeId_role: { userId, officeId, role } },
    });
    if (existing) return;
    await tx.userOfficeRole.create({ data: { userId, officeId, role } });
    await audit(tx, {
      actorUserId: actor.id,
      action: 'user.role_granted',
      entityType: 'User',
      entityId: userId,
      correlationId: req.correlationId,
      diff: { officeId, role },
    });
  }
}
