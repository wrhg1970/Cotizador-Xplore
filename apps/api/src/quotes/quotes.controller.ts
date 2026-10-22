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
import { CreateScenario, DuplicateScenario, UpdateQuote } from '@ee/contracts';
import { Prisma, type PrismaClient, type QuoteFxRate, type QuoteLine, type QuoteVersion } from '@ee/db';
import { calculateQuote, D, roundMoney, type Dec } from '@ee/quote-engine';
import type { z } from 'zod';
import { audit } from '../audit.js';
import type { AuthUser } from '../auth/auth.types.js';
import { CurrentUser } from '../auth/session.guard.js';
import { PRISMA } from '../prisma.service.js';
import { canViewQuotes, canWorkQuotes, type RequestRef } from '../requests/request-policy.js';
import { ZodPipe } from '../zod.pipe.js';

type Tx = Prisma.TransactionClient;
type FullVersion = QuoteVersion & {
  lines: QuoteLine[];
  fxRates: QuoteFxRate[];
  scenario: { name: string; requestId: string };
};

const uuid = new ParseUUIDPipe({ version: '4' });
const full = {
  lines: { orderBy: { position: 'asc' } },
  fxRates: { orderBy: { fromCurrency: 'asc' } },
  scenario: { select: { name: true, requestId: true } },
} as const;
const EDITABLE = ['DRAFT', 'RETURNED'] as const;
const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
const toDate = (s: string) => new Date(`${s}T00:00:00Z`);
const conflict = () =>
  new ConflictException({
    code: 'VERSION_CONFLICT',
    message: 'La cotización cambió; recarga e inténtalo de nuevo',
  });

const money = (x: Dec) => roundMoney(x, 2).toFixed(2);

/** Live figures for the editor; frozen with a hash when the version goes to approval. */
function calculate(v: FullVersion) {
  const r = calculateQuote({
    ...v,
    targetMarginRate: new D(v.targetMarginRate.toString()),
    lines: v.lines.map((l) => ({
      ...l,
      quantity: new D(l.quantity.toString()),
      unitCost: new D(l.unitCost.toString()),
    })),
    fxRates: Object.fromEntries(v.fxRates.map((f) => [f.fromCurrency, new D(f.rate.toString())])),
  });
  return {
    directPerParticipant: money(r.directPerParticipant),
    sharedPerParticipant: money(r.sharedPerParticipant),
    costPerParticipant: money(r.costPerParticipant),
    marginPerParticipant: money(r.marginPerParticipant),
    pricePerParticipant: money(r.pricePerParticipant),
    groupPrice: money(r.groupPrice),
    groupMargin: money(r.groupMargin),
  };
}

function toDto(v: FullVersion) {
  const rated = new Set(v.fxRates.map((f) => f.fromCurrency));
  const missingFx = [...new Set(v.lines.map((l) => l.currency))].filter(
    (c) => c !== v.saleCurrency && !rated.has(c),
  );
  return {
    id: v.id,
    scenarioId: v.scenarioId,
    scenarioName: v.scenario.name,
    requestId: v.scenario.requestId,
    number: v.number,
    status: v.status,
    rowVersion: v.rowVersion,
    saleCurrency: v.saleCurrency,
    targetMarginRate: v.targetMarginRate.toFixed(),
    participants: v.participants,
    chaperones: v.chaperones,
    staff: v.staff,
    validUntil: day(v.validUntil),
    assumptions: v.assumptions,
    lines: v.lines.map((l) => ({
      id: l.id,
      category: l.category,
      description: l.description,
      quantity: l.quantity.toFixed(),
      unitCost: l.unitCost.toFixed(),
      currency: l.currency,
      lineTotal: l.quantity.mul(l.unitCost).toFixed(),
      internalOnly: l.internalOnly,
      costSource: l.costSource,
    })),
    fxRates: v.fxRates.map((f) => ({
      fromCurrency: f.fromCurrency,
      toCurrency: f.toCurrency,
      rate: f.rate.toFixed(),
      rateDate: day(f.rateDate),
      source: f.source,
    })),
    totals: missingFx.length ? null : calculate(v),
    warnings: missingFx.map((c) => ({
      code: 'MISSING_FX',
      message: `Falta tipo de cambio ${c} → ${v.saleCurrency}`,
    })),
    createdAt: v.createdAt.toISOString(),
    updatedAt: v.updatedAt.toISOString(),
  };
}

/** Copies a version's inputs into a new DRAFT; approval state is never carried over (US-048). */
async function copyVersion(tx: Tx, src: FullVersion, scenarioId: string, number: number, userId: string) {
  return tx.quoteVersion.create({
    data: {
      scenarioId,
      number,
      saleCurrency: src.saleCurrency,
      targetMarginRate: src.targetMarginRate,
      participants: src.participants,
      chaperones: src.chaperones,
      staff: src.staff,
      validUntil: src.validUntil,
      assumptions: src.assumptions,
      createdById: userId,
      lines: {
        create: src.lines.map(({ id: _i, versionId: _v, ...l }) => l),
      },
      fxRates: {
        create: src.fxRates.map(({ id: _i, versionId: _v, createdAt: _c, ...f }) => f),
      },
    },
    include: full,
  });
}

@Controller()
export class QuotesController {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  /** Loads the request behind a quote; anything the user may not see is a 404 (US-004). */
  private async request(
    tx: Tx | PrismaClient,
    id: string,
    user: AuthUser,
  ): Promise<RequestRef & { id: string }> {
    const r = await tx.travelRequest.findUnique({ where: { id } });
    if (!r || !canViewQuotes(user, r)) throw new NotFoundException('Solicitud no encontrada');
    return r;
  }

  private assertWork(user: AuthUser, r: RequestRef) {
    if (!canWorkQuotes(user, r))
      throw new ForbiddenException(
        'Solo el cotizador asignado o el coordinador, con la solicitud en cotización',
      );
  }

  private async latest(tx: Tx, scenarioId: string) {
    return tx.quoteVersion.findFirstOrThrow({
      where: { scenarioId },
      orderBy: { number: 'desc' },
      include: full,
    });
  }

  /** US-047: one row per scenario with its latest version, for the comparison view. */
  @Get('requests/:id/scenarios')
  async list(@CurrentUser() user: AuthUser, @Param('id', uuid) id: string) {
    await this.request(this.prisma, id, user);
    const scenarios = await this.prisma.quoteScenario.findMany({
      where: { requestId: id },
      include: { versions: { orderBy: { number: 'desc' }, include: full } },
      orderBy: { createdAt: 'asc' },
    });
    return scenarios.map((s) => ({
      id: s.id,
      name: s.name,
      createdAt: s.createdAt.toISOString(),
      versions: s.versions.map((v) => ({ id: v.id, number: v.number, status: v.status })),
      latest: toDto(s.versions[0]!),
    }));
  }

  /** US-029: a scenario starts with v1 as a DRAFT, group sizes taken from the request. */
  @Post('requests/:id/scenarios')
  async create(
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
    @Param('id', uuid) id: string,
    @Body(new ZodPipe(CreateScenario)) body: z.infer<typeof CreateScenario>,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const r = await tx.travelRequest.findUnique({ where: { id } });
      if (!r || !canViewQuotes(user, r)) throw new NotFoundException('Solicitud no encontrada');
      this.assertWork(user, r);
      const scenario = await tx.quoteScenario.create({
        data: {
          requestId: id,
          name: body.name,
          createdById: user.id,
          versions: {
            create: {
              number: 1,
              saleCurrency: body.saleCurrency,
              participants: body.participants ?? r.participants,
              chaperones: body.chaperones ?? r.chaperones,
              staff: body.staff ?? r.staff,
              createdById: user.id,
            },
          },
        },
        include: { versions: { include: full } },
      });
      await audit(tx, {
        actorUserId: user.id,
        action: 'quote.scenario.created',
        entityType: 'TravelRequest',
        entityId: id,
        correlationId: req.correlationId,
        diff: { scenarioId: scenario.id, name: scenario.name },
      });
      return { id: scenario.id, name: scenario.name, latest: toDto(scenario.versions[0]!) };
    });
  }

  /** US-030: new scenario from the latest version of another; the original is untouched. */
  @Post('scenarios/:id/duplicate')
  async duplicate(
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
    @Param('id', uuid) id: string,
    @Body(new ZodPipe(DuplicateScenario)) body: z.infer<typeof DuplicateScenario>,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const src = await tx.quoteScenario.findUnique({ where: { id } });
      if (!src) throw new NotFoundException('Escenario no encontrado');
      const r = await this.request(tx, src.requestId, user);
      this.assertWork(user, r);
      const scenario = await tx.quoteScenario.create({
        data: { requestId: r.id, name: body.name, createdById: user.id },
      });
      const v = await copyVersion(tx, await this.latest(tx, id), scenario.id, 1, user.id);
      await audit(tx, {
        actorUserId: user.id,
        action: 'quote.scenario.duplicated',
        entityType: 'TravelRequest',
        entityId: r.id,
        correlationId: req.correlationId,
        diff: { from: id, scenarioId: scenario.id },
      });
      return { id: scenario.id, name: scenario.name, latest: toDto(v) };
    });
  }

  /** New version from the latest one, e.g. after it was sent (DATABASE.md: sent versions are immutable). */
  @Post('scenarios/:id/versions')
  async newVersion(@CurrentUser() user: AuthUser, @Req() req: Request, @Param('id', uuid) id: string) {
    return this.prisma.$transaction(async (tx) => {
      const scenario = await tx.quoteScenario.findUnique({ where: { id } });
      if (!scenario) throw new NotFoundException('Escenario no encontrado');
      this.assertWork(user, await this.request(tx, scenario.requestId, user));
      const last = await this.latest(tx, id);
      if ((EDITABLE as readonly string[]).includes(last.status))
        throw new ConflictException({
          code: 'DRAFT_EXISTS',
          message: `La versión ${last.number} sigue editable; modifícala en lugar de crear otra`,
        });
      const v = await copyVersion(tx, last, id, last.number + 1, user.id);
      await audit(tx, {
        actorUserId: user.id,
        action: 'quote.version.created',
        entityType: 'QuoteVersion',
        entityId: v.id,
        correlationId: req.correlationId,
        diff: { scenarioId: id, number: v.number, from: last.id },
      });
      return toDto(v);
    });
  }

  @Get('quotes/:id')
  async get(@CurrentUser() user: AuthUser, @Param('id', uuid) id: string) {
    const v = await this.prisma.quoteVersion.findUnique({
      where: { id },
      include: full,
    });
    if (!v) throw new NotFoundException('Cotización no encontrada');
    await this.request(this.prisma, v.scenario.requestId, user);
    return toDto(v);
  }

  /** Draft edit with optimistic lock; `lines`/`fxRates` replace the whole set (US-031, US-055). */
  @Patch('quotes/:id')
  async update(
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
    @Param('id', uuid) id: string,
    @Body(new ZodPipe(UpdateQuote)) body: z.infer<typeof UpdateQuote>,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const v = await tx.quoteVersion.findUnique({
        where: { id },
        include: { scenario: true, fxRates: true },
      });
      if (!v) throw new NotFoundException('Cotización no encontrada');
      this.assertWork(user, await this.request(tx, v.scenario.requestId, user));
      if (!(EDITABLE as readonly string[]).includes(v.status))
        throw new ForbiddenException('Solo se editan versiones en borrador o devueltas');
      if (v.rowVersion !== body.rowVersion) throw conflict();

      const { lines, fxRates, rowVersion, validUntil, ...fields } = body;
      const saleCurrency = fields.saleCurrency ?? v.saleCurrency;
      // Stored rates point at the old sale currency; silently re-labelling them would misprice.
      if (saleCurrency !== v.saleCurrency && !fxRates && v.fxRates.length)
        throw new BadRequestException({
          code: 'FX_REQUIRED',
          message: 'Al cambiar la moneda de venta, vuelve a capturar los tipos de cambio',
        });
      if (fxRates?.some((f) => f.fromCurrency === saleCurrency))
        throw new BadRequestException({
          code: 'VALIDATION_ERROR',
          message: 'No se captura tipo de cambio de la moneda de venta consigo misma',
        });

      const { targetMarginRate, ...rest } = fields;
      const { count } = await tx.quoteVersion.updateMany({
        where: { id, rowVersion },
        data: {
          ...rest,
          ...(targetMarginRate ? { targetMarginRate: new Prisma.Decimal(targetMarginRate) } : {}),
          ...(validUntil !== undefined ? { validUntil: validUntil ? toDate(validUntil) : null } : {}),
          rowVersion: { increment: 1 },
        },
      });
      if (!count) throw conflict();
      if (lines) {
        await tx.quoteLine.deleteMany({ where: { versionId: id } });
        await tx.quoteLine.createMany({
          data: lines.map((l, position) => ({
            ...l,
            versionId: id,
            position,
            quantity: new Prisma.Decimal(l.quantity),
            unitCost: new Prisma.Decimal(l.unitCost),
          })),
        });
      }
      if (fxRates) {
        await tx.quoteFxRate.deleteMany({ where: { versionId: id } });
        await tx.quoteFxRate.createMany({
          data: fxRates.map((f) => ({
            ...f,
            versionId: id,
            toCurrency: saleCurrency,
            rate: new Prisma.Decimal(f.rate),
            rateDate: toDate(f.rateDate),
            capturedById: user.id,
          })),
        });
      }
      await audit(tx, {
        actorUserId: user.id,
        action: 'quote.version.updated',
        entityType: 'QuoteVersion',
        entityId: id,
        correlationId: req.correlationId,
        // Costs stay out of the log; the version itself is the record.
        diff: {
          fields: Object.keys(fields).concat(validUntil !== undefined ? ['validUntil'] : []),
          ...(lines ? { lines: lines.length } : {}),
          ...(fxRates
            ? { fxRates: fxRates.map((f) => ({ from: f.fromCurrency, rate: f.rate, source: f.source })) }
            : {}),
        },
      });
      return toDto(await tx.quoteVersion.findUniqueOrThrow({ where: { id }, include: full }));
    });
  }
}
