import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Inject,
  Post,
  Req,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { Request } from 'express';
import { OfficialRateInput } from '@ee/contracts';
import type { PrismaClient } from '@ee/db';
import type { z } from 'zod';
import { audit } from '../audit.js';
import type { AuthUser } from '../auth/auth.types.js';
import { isSystemAdmin } from '../auth/authz.js';
import { CurrentUser } from '../auth/session.guard.js';
import { PRISMA } from '../prisma.service.js';
import { ZodPipe } from '../zod.pipe.js';
import { BANXICO, type Banxico, type BanxicoRate } from './banxico.js';

const day = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Publishes Banxico's latest rates as the agency's official ones, skipping pairs whose current rate already has
 * the same source and date, so the daily job and the admin button can both run any number of times.
 * actorUserId null = the scheduled process.
 */
export async function refreshFromBanxico(
  prisma: PrismaClient,
  agencyId: string,
  rates: BanxicoRate[],
  actorUserId: string | null,
  correlationId: string,
) {
  const published: string[] = [];
  for (const r of rates) {
    const current = await prisma.officialRate.findFirst({
      where: { agencyId, fromCurrency: r.fromCurrency, toCurrency: r.toCurrency },
      orderBy: { createdAt: 'desc' },
    });
    if (current && current.source === r.source && day(current.rateDate) === r.rateDate) continue;
    await prisma.$transaction(async (tx) => {
      const row = await tx.officialRate.create({
        data: { ...r, agencyId, rateDate: new Date(`${r.rateDate}T00:00:00Z`), capturedById: actorUserId },
      });
      await audit(tx, {
        agencyId,
        actorUserId,
        action: 'official_rate.published',
        entityType: 'OfficialRate',
        entityId: row.id,
        correlationId,
        diff: { ...r },
      });
    });
    published.push(`${r.fromCurrency}/${r.toCurrency}`);
  }
  return { published };
}

/**
 * The agency's official exchange rates (V2 "Parámetros financieros"): everyone reads the current rate per
 * pair to prefill a quote, only system admins publish one. Quotes still freeze their own copy.
 */
@Controller('official-rates')
export class OfficialRatesController {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(BANXICO) private readonly banxico: Banxico | null,
  ) {}

  @Get()
  async current(@CurrentUser() user: AuthUser) {
    const rows = await this.prisma.officialRate.findMany({
      where: { agencyId: user.agencyId },
      distinct: ['fromCurrency', 'toCurrency'],
      orderBy: [{ fromCurrency: 'asc' }, { toCurrency: 'asc' }, { createdAt: 'desc' }],
      include: { capturedBy: { select: { name: true } } },
    });
    return rows.map((r) => ({
      id: r.id,
      fromCurrency: r.fromCurrency,
      toCurrency: r.toCurrency,
      rate: r.rate.toString(),
      rateDate: day(r.rateDate),
      source: r.source,
      capturedBy: r.capturedBy?.name ?? 'Proceso automático',
      createdAt: r.createdAt.toISOString(),
    }));
  }

  /** "Traer de Banxico" in Administración; the daily job calls the same refresh. */
  @Post('banxico')
  async fromBanxico(@CurrentUser() user: AuthUser, @Req() req: Request) {
    if (!isSystemAdmin(user)) throw new ForbiddenException('Solo un administrador del sistema');
    if (!this.banxico) throw new ServiceUnavailableException('Banxico no está configurado');
    return refreshFromBanxico(
      this.prisma,
      user.agencyId,
      await this.banxico.latest(),
      user.id,
      req.correlationId,
    );
  }

  @Post()
  async publish(
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
    @Body(new ZodPipe(OfficialRateInput)) body: z.infer<typeof OfficialRateInput>,
  ) {
    if (!isSystemAdmin(user)) throw new ForbiddenException('Solo un administrador del sistema');
    return this.prisma.$transaction(async (tx) => {
      const r = await tx.officialRate.create({
        data: {
          ...body,
          agencyId: user.agencyId,
          rateDate: new Date(`${body.rateDate}T00:00:00Z`),
          capturedById: user.id,
        },
      });
      await audit(tx, {
        actorUserId: user.id,
        action: 'official_rate.published',
        entityType: 'OfficialRate',
        entityId: r.id,
        correlationId: req.correlationId,
        diff: body,
      });
      return { id: r.id };
    });
  }
}
