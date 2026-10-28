import { Body, Controller, ForbiddenException, Get, Inject, Put, Req } from '@nestjs/common';
import type { Request } from 'express';
import { AlertSettings } from '@ee/contracts';
import type { PrismaClient } from '@ee/db';
import { audit } from '../audit.js';
import type { AuthUser } from '../auth/auth.types.js';
import { isSystemAdmin } from '../auth/authz.js';
import { CurrentUser } from '../auth/session.guard.js';
import { PRISMA } from '../prisma.service.js';
import { ZodPipe } from '../zod.pipe.js';
import { ALERTS_KEY, alertSettings } from './alerts.js';

/** Administración → Alertas: thresholds in days for the daily digest and "Mi trabajo". */
@Controller('settings/alerts')
export class AlertSettingsController {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  @Get()
  get() {
    return alertSettings(this.prisma);
  }

  @Put()
  async put(
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
    @Body(new ZodPipe(AlertSettings)) body: AlertSettings,
  ) {
    if (!isSystemAdmin(user)) throw new ForbiddenException('Solo un administrador del sistema');
    return this.prisma.$transaction(async (tx) => {
      await tx.appSetting.upsert({
        where: { key: ALERTS_KEY },
        create: { key: ALERTS_KEY, value: body, updatedById: user.id },
        update: { value: body, updatedById: user.id },
      });
      await audit(tx, {
        actorUserId: user.id,
        action: 'settings.alerts.updated',
        entityType: 'AppSetting',
        entityId: ALERTS_KEY,
        correlationId: req.correlationId,
        diff: body,
      });
      return body;
    });
  }
}
