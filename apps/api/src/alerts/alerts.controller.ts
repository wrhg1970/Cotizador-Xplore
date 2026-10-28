import { Body, Controller, Get, Inject, Put, Req } from '@nestjs/common';
import type { Request } from 'express';
import { AlertSettings, ApprovalRules } from '@ee/contracts';
import type { PrismaClient } from '@ee/db';
import type { AuthUser } from '../auth/auth.types.js';
import { CurrentUser } from '../auth/session.guard.js';
import { PRISMA } from '../prisma.service.js';
import { APPROVAL_RULES_KEY, approvalRules, putSetting } from '../settings/settings.js';
import { ZodPipe } from '../zod.pipe.js';
import { ALERTS_KEY, alertSettings } from './alerts.js';

/** Administración: alert thresholds and authorization rules. Everyone reads; system admins write. */
@Controller('settings')
export class SettingsController {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  @Get('alerts')
  alerts() {
    return alertSettings(this.prisma);
  }

  @Put('alerts')
  putAlerts(
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
    @Body(new ZodPipe(AlertSettings)) body: AlertSettings,
  ) {
    return putSetting(this.prisma, user, req.correlationId, ALERTS_KEY, body);
  }

  @Get('approval-rules')
  rules() {
    return approvalRules(this.prisma);
  }

  @Put('approval-rules')
  putRules(
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
    @Body(new ZodPipe(ApprovalRules)) body: ApprovalRules,
  ) {
    return putSetting(this.prisma, user, req.correlationId, APPROVAL_RULES_KEY, body);
  }
}
