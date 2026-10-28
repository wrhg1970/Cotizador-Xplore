import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { CreateQuoteTemplate } from '@ee/contracts';
import { Prisma, type PrismaClient } from '@ee/db';
import type { z } from 'zod';
import { audit } from '../audit.js';
import type { AuthUser } from '../auth/auth.types.js';
import { canDo, canSeeInternalCosts, hasOfficeRole } from '../auth/authz.js';
import { CurrentUser } from '../auth/session.guard.js';
import { PRISMA } from '../prisma.service.js';
import { canViewQuotes } from '../requests/request-policy.js';
import { ZodPipe } from '../zod.pipe.js';

const uuid = new ParseUUIDPipe({ version: '4' });
// Templates hold internal costs: same audience as quotes; the quoting side builds them.
const WRITERS = ['QUOTER', 'OFFICE_ADMIN'] as const;

/** Office templates: save a version's lines and proposal content to start new scenarios from. */
@Controller()
export class QuoteTemplatesController {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  @Get('offices/:officeId/quote-templates')
  list(@CurrentUser() user: AuthUser, @Param('officeId', uuid) officeId: string) {
    if (!canSeeInternalCosts(user, officeId)) throw new NotFoundException();
    return this.prisma.quoteTemplate
      .findMany({
        where: { officeId, active: true },
        orderBy: { name: 'asc' },
        include: { createdBy: { select: { name: true } } },
      })
      .then((ts) =>
        ts.map((t) => ({
          id: t.id,
          name: t.name,
          saleCurrency: t.saleCurrency,
          lineCount: Array.isArray(t.lines) ? t.lines.length : 0,
          createdBy: t.createdBy.name,
          createdById: t.createdById,
          createdAt: t.createdAt.toISOString(),
        })),
      );
  }

  /** Lines and margin of one template, to load into a draft already open (the editor saves them). */
  @Get('quote-templates/:id')
  async get(@CurrentUser() user: AuthUser, @Param('id', uuid) id: string) {
    const t = await this.prisma.quoteTemplate.findUnique({ where: { id } });
    if (!t || !t.active || !canSeeInternalCosts(user, t.officeId))
      throw new NotFoundException('Plantilla no encontrada');
    return {
      id: t.id,
      name: t.name,
      saleCurrency: t.saleCurrency,
      targetMarginRate: t.targetMarginRate.toFixed(),
      lines: t.lines,
    };
  }

  @Post('quotes/:id/template')
  async save(
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
    @Param('id', uuid) id: string,
    @Body(new ZodPipe(CreateQuoteTemplate)) body: z.infer<typeof CreateQuoteTemplate>,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const v = await tx.quoteVersion.findUnique({
        where: { id },
        include: { lines: { orderBy: { position: 'asc' } }, scenario: { include: { request: true } } },
      });
      const r = v?.scenario.request;
      if (!v || !r || !canViewQuotes(user, r)) throw new NotFoundException('Cotización no encontrada');
      if (!hasOfficeRole(user, r.officeId, WRITERS))
        throw new ForbiddenException('Solo cotizadores y coordinadores guardan plantillas');
      const t = await tx.quoteTemplate.create({
        data: {
          officeId: r.officeId,
          name: body.name,
          saleCurrency: v.saleCurrency,
          targetMarginRate: v.targetMarginRate,
          lines: v.lines.map((l) => ({
            category: l.category,
            description: l.description,
            quantity: l.quantity.toFixed(),
            unitCost: l.unitCost.toFixed(),
            currency: l.currency,
            internalOnly: l.internalOnly,
            ...(l.costSource ? { costSource: l.costSource } : {}),
          })),
          studentsPerFreePlace: v.studentsPerFreePlace,
          freePlaceBenefit: v.freePlaceBenefit,
          itinerary: v.itinerary ?? Prisma.DbNull,
          exclusions: v.exclusions,
          assumptions: v.assumptions,
          createdById: user.id,
        },
      });
      await audit(tx, {
        actorUserId: user.id,
        action: 'quote_template.created',
        entityType: 'QuoteTemplate',
        entityId: t.id,
        correlationId: req.correlationId,
        diff: { name: t.name, fromVersion: v.id },
      });
      return { id: t.id, name: t.name };
    });
  }

  /** Retires a template; scenarios already created from it are untouched. */
  @Delete('quote-templates/:id')
  @HttpCode(204)
  async retire(@CurrentUser() user: AuthUser, @Req() req: Request, @Param('id', uuid) id: string) {
    await this.prisma.$transaction(async (tx) => {
      const t = await tx.quoteTemplate.findUnique({ where: { id } });
      if (!t || !t.active || !canSeeInternalCosts(user, t.officeId))
        throw new NotFoundException('Plantilla no encontrada');
      if (t.createdById !== user.id && !canDo(user, t.officeId, 'canDelete'))
        throw new ForbiddenException('Solo quien la creó o el coordinador');
      await tx.quoteTemplate.update({ where: { id }, data: { active: false } });
      await audit(tx, {
        actorUserId: user.id,
        action: 'quote_template.retired',
        entityType: 'QuoteTemplate',
        entityId: id,
        correlationId: req.correlationId,
      });
    });
  }
}
