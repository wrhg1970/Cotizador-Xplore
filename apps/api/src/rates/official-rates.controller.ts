import { Body, Controller, ForbiddenException, Get, Inject, Post, Req } from '@nestjs/common';
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

const day = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Official EE exchange rates (V2 "Parámetros financieros"): everyone reads the current rate per
 * pair to prefill a quote, only system admins publish one. Quotes still freeze their own copy.
 */
@Controller('official-rates')
export class OfficialRatesController {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  @Get()
  async current() {
    const rows = await this.prisma.officialRate.findMany({
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
      capturedBy: r.capturedBy.name,
      createdAt: r.createdAt.toISOString(),
    }));
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
        data: { ...body, rateDate: new Date(`${body.rateDate}T00:00:00Z`), capturedById: user.id },
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
