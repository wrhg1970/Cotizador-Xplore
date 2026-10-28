import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Inject,
  Param,
  ParseIntPipe,
  Put,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { AlertSettings, ApprovalRules, OfficeGoals } from '@ee/contracts';
import type { PrismaClient } from '@ee/db';
import type { AuthUser } from '../auth/auth.types.js';
import { CurrentUser } from '../auth/session.guard.js';
import { PRISMA } from '../prisma.service.js';
import { isSystemAdmin } from '../auth/authz.js';
import {
  APPROVAL_RULES_KEY,
  approvalRules,
  goalsKey,
  officeGoals,
  putSetting,
} from '../settings/settings.js';
import { ZodPipe } from '../zod.pipe.js';
import { ALERTS_KEY, alertSettings } from './alerts.js';

const YEAR = new ParseIntPipe({
  exceptionFactory: () => new BadRequestException('Año inválido'),
});
const inRange = (year: number) => {
  if (year < 2020 || year > 2100) throw new BadRequestException('Año inválido');
  return year;
};

/** Administración: alert thresholds, authorization rules and office goals. System admins write. */
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

  /** Goals are business figures: only system admins read them here; the executive dashboard shows each office's own. */
  @Get('goals/:year')
  goals(@CurrentUser() user: AuthUser, @Param('year', YEAR) year: number) {
    if (!isSystemAdmin(user)) throw new ForbiddenException('Solo un administrador del sistema');
    return officeGoals(this.prisma, inRange(year));
  }

  @Put('goals/:year')
  putGoals(
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
    @Param('year', YEAR) year: number,
    @Body(new ZodPipe(OfficeGoals)) body: OfficeGoals,
  ) {
    return putSetting(this.prisma, user, req.correlationId, goalsKey(inRange(year)), body);
  }
}
