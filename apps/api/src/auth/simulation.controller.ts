import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  Inject,
  NotFoundException,
  Post,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { StartSimulation } from '@ee/contracts';
import type { PrismaClient } from '@ee/db';
import { audit } from '../audit.js';
import { PRISMA } from '../prisma.service.js';
import { ZodPipe } from '../zod.pipe.js';
import { AuthService } from './auth.service.js';
import type { AuthUser } from './auth.types.js';
import { isSystemAdmin } from './authz.js';
import { AllowWhileSimulating, CurrentUser, SESSION_COOKIE } from './session.guard.js';

/**
 * "Ver como" (V2 "Simular usuario / rol"): a system admin sees the app with another user's roles and
 * offices, read only. The real admin stays signed in and is the actor of both audit entries.
 */
@Controller('simulation')
export class SimulationController {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    private readonly auth: AuthService,
  ) {}

  /** Active users of the admin's agency to pick from. */
  @Get('users')
  async users(@CurrentUser() user: AuthUser) {
    if (!isSystemAdmin(user)) throw new ForbiddenException();
    return this.prisma.user.findMany({
      where: { agencyId: user.agencyId, status: 'ACTIVE', id: { not: user.id } },
      select: {
        id: true,
        name: true,
        email: true,
        officeRoles: { select: { role: true, office: { select: { code: true } } } },
      },
      orderBy: { name: 'asc' },
    });
  }

  @Post()
  @HttpCode(204)
  async start(
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
    @Body(new ZodPipe(StartSimulation)) body: StartSimulation,
  ) {
    if (!isSystemAdmin(user)) throw new ForbiddenException();
    const target = await this.prisma.user.findFirst({
      where: { id: body.userId, agencyId: user.agencyId, status: 'ACTIVE', NOT: { id: user.id } },
      select: { id: true },
    });
    if (!target) throw new NotFoundException('Usuario no encontrado');
    await this.auth.setViewAs(String(req.cookies[SESSION_COOKIE]), target.id);
    await audit(this.prisma, {
      actorUserId: user.id,
      action: 'auth.simulation_started',
      entityType: 'User',
      entityId: target.id,
      correlationId: req.correlationId,
    });
  }

  @Delete()
  @AllowWhileSimulating()
  @HttpCode(204)
  async stop(@CurrentUser() user: AuthUser, @Req() req: Request) {
    if (!user.simulatedBy) return;
    await this.auth.setViewAs(String(req.cookies[SESSION_COOKIE]), null);
    await audit(this.prisma, {
      actorUserId: user.simulatedBy.id,
      action: 'auth.simulation_ended',
      entityType: 'User',
      entityId: user.id,
      correlationId: req.correlationId,
    });
  }
}
