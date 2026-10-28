import {
  Controller,
  HttpCode,
  Inject,
  NotFoundException,
  Post,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import type { PrismaClient } from '@ee/db';
import { timingSafeEqual } from 'node:crypto';
import { ENV, type Env } from '../env.js';
import { PRISMA } from '../prisma.service.js';
import { Public } from '../auth/session.guard.js';
import { BANXICO, type Banxico } from '../rates/banxico.js';
import { refreshFromBanxico } from '../rates/official-rates.controller.js';
import { MAILER, type Mailer } from '../notify/notifier.js';
import { sendDigest } from '../alerts/alerts.js';

const same = (a: string, b: string) =>
  a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/**
 * Daily jobs, called by Cloud Scheduler with the X-Cron-Secret header. Each job runs on its own
 * so one failing (e.g. Banxico down) doesn't stop the rest; the response says what happened.
 */
@Public()
@Controller('cron')
export class CronController {
  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(BANXICO) private readonly banxico: Banxico | null,
    @Inject(MAILER) private readonly mailer: Mailer | null,
  ) {}

  @Post('daily')
  @HttpCode(200)
  async daily(@Req() req: Request) {
    if (!this.env.CRON_SECRET) throw new NotFoundException();
    if (!same(req.header('x-cron-secret') ?? '', this.env.CRON_SECRET)) throw new UnauthorizedException();
    const result: Record<string, unknown> = {};
    if (this.banxico) {
      try {
        result.banxico = await refreshFromBanxico(this.prisma, this.banxico, null, req.correlationId);
      } catch (e) {
        // The last official rate stays current; nothing is inferred.
        result.banxico = { error: e instanceof Error ? e.message : 'error' };
      }
    }
    if (this.mailer) {
      try {
        result.alerts = await sendDigest(this.prisma, this.mailer, this.env.WEB_ORIGIN);
      } catch (e) {
        result.alerts = { error: e instanceof Error ? e.message : 'error' };
      }
    }
    return result;
  }
}
