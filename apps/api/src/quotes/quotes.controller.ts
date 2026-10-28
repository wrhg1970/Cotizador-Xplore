import {
  BadGatewayException,
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
  Res,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import {
  CreateScenario,
  ItineraryDay,
  PaymentPlanInput,
  QuoteLineInput,
  DuplicateScenario,
  ReturnQuote,
  ReviewQuote,
  SendQuote,
  UpdateQuote,
} from '@ee/contracts';
import {
  Prisma,
  type PrismaClient,
  type ProposalDelivery,
  type QuoteFxRate,
  type QuoteLine,
  type QuoteReview,
  type QuoteVersion,
  type TravelRequest,
} from '@ee/db';
import {
  calculateQuote,
  calculationHash,
  D,
  freePlaces,
  paymentSchedule,
  marginRateForPrice,
  QuoteEngineError,
  roundMoney,
  safeDivide,
  type Dec,
} from '@ee/quote-engine';
import type { z } from 'zod';
import { audit } from '../audit.js';
import type { AuthUser } from '../auth/auth.types.js';
import { CurrentUser } from '../auth/session.guard.js';
import { Notifier } from '../notify/notifier.js';
import { PRISMA } from '../prisma.service.js';
import { approvalLimitMxn, canExportInternalXlsx, hasOfficeRole } from '../auth/authz.js';
import { canView, canViewQuotes, canWorkQuotes, type RequestRef } from '../requests/request-policy.js';
import { ZodPipe } from '../zod.pipe.js';
import { quoteWorkbook } from './quote-xlsx.js';
import { paymentLinkBody, type WeTravel, WETRAVEL, WeTravelError } from '../integrations/wetravel.js';

type Tx = Prisma.TransactionClient;
export type FullVersion = QuoteVersion & {
  lines: QuoteLine[];
  fxRates: QuoteFxRate[];
  scenario: { name: string; requestId: string };
  reviews: (QuoteReview & { reviewer: { name: string } })[];
  deliveries: (ProposalDelivery & { sentBy: { name: string } })[];
};

const uuid = new ParseUUIDPipe({ version: '4' });
export const full = {
  lines: { orderBy: { position: 'asc' } },
  fxRates: { orderBy: { fromCurrency: 'asc' } },
  scenario: { select: { name: true, requestId: true } },
  reviews: { orderBy: { createdAt: 'asc' }, include: { reviewer: { select: { name: true } } } },
  deliveries: { orderBy: { createdAt: 'asc' }, include: { sentBy: { select: { name: true } } } },
} as const;
const EDITABLE = ['DRAFT', 'RETURNED'] as const;
const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
const toDate = (s: string) => new Date(`${s}T00:00:00Z`);
const conflict = () =>
  new ConflictException({
    code: 'VERSION_CONFLICT',
    message: 'La cotización cambió; recarga e inténtalo de nuevo',
  });

const asciiName = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\w.-]+/g, '_');

const money = (x: Dec) => roundMoney(x, 2).toFixed(2);
// Json columns: a null clears the column; Prisma spells that DbNull.
const json = (x: unknown) => (x === null ? Prisma.DbNull : (x as Prisma.InputJsonValue));
const plan = (v: QuoteVersion) => (v.paymentPlan ? PaymentPlanInput.parse(v.paymentPlan) : null);

/** Per-student schedule from the rounded price; a plan that no longer fits the price becomes a warning. */
function schedule(v: FullVersion, price: Dec | null) {
  const p = plan(v);
  if (!p || !price) return { payments: null, warning: null };
  try {
    const payments = paymentSchedule(price, {
      ...p,
      depositRate: p.depositRate ? new D(p.depositRate) : null,
      depositAmount: p.depositAmount ? new D(p.depositAmount) : null,
    });
    return {
      payments: payments.map((x) => ({ number: x.number, dueDate: x.dueDate, amount: x.amount.toFixed(2) })),
      warning: null,
    };
  } catch (e) {
    if (!(e instanceof QuoteEngineError)) throw e;
    return { payments: null, warning: { code: 'PAYMENT_PLAN', message: `Plan de pagos: ${e.message}` } };
  }
}

/** Pure engine run over a stored version; also used by "Mi trabajo" for the headline price. */
export const engine = (v: QuoteVersion & { lines: QuoteLine[]; fxRates: QuoteFxRate[] }) =>
  calculateQuote({
    ...v,
    targetMarginRate: new D(v.targetMarginRate.toString()),
    lines: v.lines.map((l) => ({
      ...l,
      quantity: new D(l.quantity.toString()),
      unitCost: new D(l.unitCost.toString()),
    })),
    fxRates: Object.fromEntries(v.fxRates.map((f) => [f.fromCurrency, new D(f.rate.toString())])),
    mxnRate: v.mxnRate && v.saleCurrency !== 'MXN' ? new D(v.mxnRate.toString()) : null,
  });

/** Client-safe proposal (PRD §PDF): price, group, validity and included concepts; never costs or margin. */
export function clientProposal(v: FullVersion, r: TravelRequest) {
  const dto = toDto(v);
  const { totals, validUntil, assumptions } = dto;
  return {
    id: v.id,
    number: v.number,
    scenarioName: v.scenario.name,
    authorized: v.status === 'APPROVED' || v.status === 'SENT',
    request: {
      id: r.id,
      folio: r.folio,
      groupName: r.groupName,
      city: r.city,
      countryCode: r.countryCode,
      departureDate: day(r.departureDate),
      returnDate: day(r.returnDate),
    },
    participants: v.participants,
    chaperones: v.chaperones,
    saleCurrency: v.saleCurrency,
    pricePerParticipant: totals?.pricePerParticipant ?? null,
    pricePerParticipantMxn: totals?.pricePerParticipantMxn ?? null,
    validUntil,
    assumptions,
    paymentSchedule: dto.paymentSchedule,
    freePlaces: dto.freePlaces && { count: dto.freePlaces, benefit: dto.freePlaceBenefit },
    itinerary: dto.itinerary ?? [],
    exclusions: dto.exclusions,
    hasCover: !!v.coverAttachmentId,
    // Only the winning proposal carries the payment link, the same one WeTravel's checkout shows.
    paymentUrl: r.wonVersionId === v.id ? r.wetravelUrl : null,
    includes: v.lines
      // Base concepts start at zero; an unpriced one is not something the trip includes.
      .filter(
        (l) => !l.internalOnly && l.category === 'PER_PARTICIPANT' && l.unitCost.gt(0) && l.quantity.gt(0),
      )
      .map((l) => l.description),
  };
}

/** Live figures for the editor; frozen with a hash when the version goes to approval. */
function calculate(v: FullVersion) {
  const r = engine(v);
  return {
    directPerParticipant: money(r.directPerParticipant),
    sharedPerParticipant: money(r.sharedPerParticipant),
    costPerParticipant: money(r.costPerParticipant),
    marginPerParticipant: money(r.marginPerParticipant),
    pricePerParticipant: money(r.pricePerParticipant),
    groupPrice: money(r.groupPrice),
    groupMargin: money(r.groupMargin),
    pricePerParticipantMxn: r.pricePerParticipantMxn && money(r.pricePerParticipantMxn),
    groupMarginMxn: r.groupMarginMxn && money(r.groupMarginMxn),
    /** Per line, in sale currency and already multiplied by headcount where it applies. */
    lineTotals: r.lineTotals.map(money),
  };
}

/**
 * The EE sheet's subtotals (V2 layout). Derived from the same inputs as `totals`, so it stays out of
 * the approval hash: adding display rows must not invalidate approvals already given.
 */
function sheet(v: FullVersion) {
  const { byCategory: b } = engine(v);
  const chaperones = b.PER_CHAPERONE.plus(b.PER_STAFF);
  const participants = new D(v.participants);
  return {
    chaperonesTotal: money(chaperones),
    emergencyFund: money(b.CONTINGENCY),
    totalChaperones: money(chaperones.plus(b.CONTINGENCY)),
    leaderPerParticipant: money(safeDivide(chaperones.plus(b.CONTINGENCY), participants)),
    groupFixedTotal: money(b.PER_GROUP),
    groupFixedPerParticipant: money(safeDivide(b.PER_GROUP, participants)),
  };
}

/** What an approval vouches for: every input and the resulting figures (US-071, US-075). */
function snapshotHash(v: FullVersion) {
  const {
    id: _i,
    scenarioId: _s,
    scenarioName: _n,
    requestId: _r,
    status: _st,
    rowVersion: _rv,
    createdAt: _c,
    updatedAt: _u,
    reviews: _rw,
    warnings: _w,
    sheet: _sh,
    paymentSchedule: _ps,
    freePlaces: _fp,
    lines,
    ...rest
  } = toDto(v);
  // Proposal fields added later enter the hash only when set, so earlier approvals keep their hash.
  const added = [
    'paymentPlan',
    'studentsPerFreePlace',
    'freePlaceBenefit',
    'itinerary',
    'coverAttachmentId',
  ] as const;
  for (const k of added) if (rest[k] === null) delete rest[k];
  const { exclusions, ...kept } = rest;
  return calculationHash({
    ...kept,
    ...(exclusions.length ? { exclusions } : {}),
    lines: lines.map(({ id: _l, ...l }) => l),
  });
}

export type QuoteDto = ReturnType<typeof toDto>;

export function toDto(v: FullVersion) {
  const rated = new Set(v.fxRates.map((f) => f.fromCurrency));
  const missingFx = [...new Set(v.lines.map((l) => l.currency))].filter(
    (c) => c !== v.saleCurrency && !rated.has(c),
  );
  const pay = schedule(v, missingFx.length ? null : engine(v).pricePerParticipant);
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
    mxnRate: v.mxnRate?.toFixed() ?? null,
    participants: v.participants,
    chaperones: v.chaperones,
    staff: v.staff,
    validUntil: day(v.validUntil),
    assumptions: v.assumptions,
    paymentPlan: plan(v),
    studentsPerFreePlace: v.studentsPerFreePlace,
    freePlaceBenefit: v.freePlaceBenefit,
    itinerary: v.itinerary ? ItineraryDay.array().parse(v.itinerary) : null,
    exclusions: v.exclusions,
    coverAttachmentId: v.coverAttachmentId,
    paymentSchedule: pay.payments,
    freePlaces: v.studentsPerFreePlace ? freePlaces(v.participants, v.studentsPerFreePlace) : null,
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
    sheet: missingFx.length ? null : sheet(v),
    warnings: [
      ...missingFx.map((c) => ({
        code: 'MISSING_FX',
        message: `Falta tipo de cambio ${c} → ${v.saleCurrency}`,
      })),
      ...(pay.warning ? [pay.warning] : []),
    ],
    deliveries: v.deliveries.map((d) => ({
      recipients: d.recipients,
      channel: d.channel,
      sentOn: day(d.sentOn),
      notes: d.notes,
      sentBy: d.sentBy.name,
    })),
    reviews: v.reviews.map((r) => ({
      decision: r.decision,
      reviewer: r.reviewer.name,
      comment: r.comment,
      at: r.createdAt.toISOString(),
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
      mxnRate: src.mxnRate,
      participants: src.participants,
      chaperones: src.chaperones,
      staff: src.staff,
      validUntil: src.validUntil,
      assumptions: src.assumptions,
      paymentPlan: src.paymentPlan ?? Prisma.DbNull,
      studentsPerFreePlace: src.studentsPerFreePlace,
      freePlaceBenefit: src.freePlaceBenefit,
      itinerary: src.itinerary ?? Prisma.DbNull,
      exclusions: src.exclusions,
      coverAttachmentId: src.coverAttachmentId,
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
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    private readonly notifier: Notifier,
    @Inject(WETRAVEL) private readonly wetravel: WeTravel | null,
  ) {}

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
      const template = body.templateId
        ? await tx.quoteTemplate.findFirst({
            where: { id: body.templateId, officeId: r.officeId, active: true },
          })
        : null;
      if (body.templateId && !template) throw new NotFoundException('Plantilla no encontrada');
      // Allowances count both travel days: return − departure + 1 (Finance, 2026-10-22).
      const tripDays = (r.returnDate.getTime() - r.departureDate.getTime()) / 86_400_000 + 1;
      const lines = template
        ? QuoteLineInput.array().parse(template.lines)
        : (
            await tx.conceptTemplate.findMany({
              where: { active: true, isBase: true },
              orderBy: [{ category: 'asc' }, { position: 'asc' }, { label: 'asc' }],
            })
          ).map((t) => ({
            category: t.category,
            description: t.label,
            quantity: String(t.perTripDay ? tripDays : 1),
            unitCost: '0',
            currency: body.saleCurrency,
            internalOnly: t.internalOnly,
          }));
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
              ...(template && {
                targetMarginRate: template.targetMarginRate,
                studentsPerFreePlace: template.studentsPerFreePlace,
                freePlaceBenefit: template.freePlaceBenefit,
                itinerary: template.itinerary ?? Prisma.DbNull,
                exclusions: template.exclusions,
                assumptions: template.assumptions,
              }),
              lines: {
                create: lines.map((l, position) => ({
                  ...l,
                  position,
                  quantity: new Prisma.Decimal(l.quantity),
                  unitCost: new Prisma.Decimal(l.unitCost),
                })),
              },
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
        diff: { scenarioId: scenario.id, name: scenario.name, templateId: template?.id ?? null },
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

  /** US-095: advisors compare proposals without seeing costs. */
  @Get('requests/:id/proposals')
  async proposals(@CurrentUser() user: AuthUser, @Param('id', uuid) id: string) {
    const r = await this.prisma.travelRequest.findUnique({ where: { id } });
    if (!r || !canView(user, r)) throw new NotFoundException('Solicitud no encontrada');
    const scenarios = await this.prisma.quoteScenario.findMany({
      where: { requestId: id },
      include: { versions: { orderBy: { number: 'desc' }, take: 1, include: full } },
      orderBy: { createdAt: 'asc' },
    });
    return scenarios.map((s) => {
      const v = s.versions[0]!;
      return {
        versionId: v.id,
        scenarioName: s.name,
        number: v.number,
        authorized: v.status === 'APPROVED' || v.status === 'SENT',
        sent: v.status === 'SENT',
        participants: v.participants,
        saleCurrency: v.saleCurrency,
        pricePerParticipant: toDto(v).totals?.pricePerParticipant ?? null,
      };
    });
  }

  /**
   * What may be shared with the client: price, group, validity and included concepts, never costs
   * or margin (PRD §PDF). Advisors can read it; `authorized` drives the pending legend.
   */
  @Get('quotes/:id/proposal')
  async proposal(@CurrentUser() user: AuthUser, @Param('id', uuid) id: string) {
    const v = await this.prisma.quoteVersion.findUnique({ where: { id }, include: full });
    const r = v && (await this.prisma.travelRequest.findUnique({ where: { id: v.scenario.requestId } }));
    if (!v || !r || !canView(user, r) || r.status === 'DRAFT')
      throw new NotFoundException('Cotización no encontrada');
    return clientProposal(v, r);
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

  /** PRD: internal XLSX with concepts, quantities, currency, cost, price, margin. Never for clients. */
  @Get('quotes/:id/export.xlsx')
  async exportXlsx(@CurrentUser() user: AuthUser, @Param('id', uuid) id: string, @Res() res: Response) {
    const v = await this.prisma.quoteVersion.findUnique({ where: { id }, include: full });
    if (!v) throw new NotFoundException('Cotización no encontrada');
    const ref = await this.request(this.prisma, v.scenario.requestId, user);
    if (!canExportInternalXlsx(user, ref.officeId))
      throw new ForbiddenException('Tu rol no tiene permiso para descargar el Excel interno');
    const r = await this.prisma.travelRequest.findUniqueOrThrow({ where: { id: ref.id } });
    const file = await quoteWorkbook(toDto(v), { folio: r.folio, groupName: r.groupName });
    res
      .type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      // ASCII-only name: accents and spaces break the download name in some browsers and on Windows.
      .attachment(`${r.folio}-${asciiName(v.scenario.name)}-v${v.number}.xlsx`)
      .send(file);
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

      if (fields.coverAttachmentId) {
        const cover = await tx.requestAttachment.findFirst({
          where: { id: fields.coverAttachmentId, requestId: v.scenario.requestId },
          select: { mimeType: true },
        });
        if (!cover?.mimeType.startsWith('image/'))
          throw new BadRequestException({
            code: 'VALIDATION_ERROR',
            message: 'La portada debe ser una imagen JPG o PNG adjunta a esta solicitud',
          });
      }
      const { targetMarginRate, targetPricePerParticipant, mxnRate, paymentPlan, itinerary, ...rest } =
        fields;
      const { count } = await tx.quoteVersion.updateMany({
        where: { id, rowVersion },
        data: {
          ...rest,
          ...(targetMarginRate ? { targetMarginRate: new Prisma.Decimal(targetMarginRate) } : {}),
          ...(mxnRate !== undefined
            ? { mxnRate: mxnRate === null ? null : new Prisma.Decimal(mxnRate) }
            : {}),
          ...(validUntil !== undefined ? { validUntil: validUntil ? toDate(validUntil) : null } : {}),
          ...(paymentPlan !== undefined ? { paymentPlan: json(paymentPlan) } : {}),
          ...(itinerary !== undefined ? { itinerary: json(itinerary) } : {}),
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
      if (targetPricePerParticipant) await this.priceFromTarget(tx, id, targetPricePerParticipant);
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

  /** Typed final price → the margin that rounds back to exactly that price, from the saved lines. */
  private async priceFromTarget(tx: Tx, id: string, target: string) {
    const v = await tx.quoteVersion.findUniqueOrThrow({ where: { id }, include: full });
    const dto = toDto(v);
    if (!dto.totals)
      throw new BadRequestException({
        code: 'FX_REQUIRED',
        message: 'Registra los tipos de cambio antes de fijar el precio final',
      });
    const cost = engine(v).costPerParticipant;
    const price = new D(target);
    let rate: Dec;
    try {
      rate = marginRateForPrice(cost, price);
    } catch (e) {
      if (!(e instanceof QuoteEngineError)) throw e;
      throw new BadRequestException({
        code: 'PRICE_BELOW_COST',
        message: `El precio final debe ser mayor que el costo por estudiante (${dto.totals.costPerParticipant} ${v.saleCurrency})`,
      });
    }
    const check = engine({ ...v, targetMarginRate: new Prisma.Decimal(rate.toFixed()) });
    if (!check.pricePerParticipant.eq(price))
      throw new BadRequestException({
        code: 'PRICE_UNREACHABLE',
        message: 'Ese precio no se alcanza con un % de seis decimales; captura el % de comisión',
      });
    await tx.quoteVersion.update({
      where: { id },
      data: { targetMarginRate: new Prisma.Decimal(rate.toFixed()) },
    });
  }

  /** US-045, US-051: only a complete, priced version with a validity date goes to review. */
  @Post('quotes/:id/submit')
  async submit(
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
    @Param('id', uuid) id: string,
    @Body(new ZodPipe(ReviewQuote)) body: z.infer<typeof ReviewQuote>,
  ) {
    const dto = await this.review(user, req, id, body.rowVersion, 'quote.submitted_for_approval', (v, r) => {
      this.assertWork(user, r);
      if (!(EDITABLE as readonly string[]).includes(v.status))
        throw new ForbiddenException('Solo se envían a autorización versiones en borrador o devueltas');
      const dto = toDto(v);
      const missing = [
        // Base concepts start at zero, so "has lines" is not enough.
        !dto.lines.some((l) => new D(l.lineTotal).gt(0)) && 'conceptos',
        !dto.validUntil && 'vigencia',
        !dto.totals && 'tipos de cambio',
        dto.warnings.some((w) => w.code === 'PAYMENT_PLAN') && 'plan de pagos',
      ].filter(Boolean);
      if (missing.length)
        throw new BadRequestException({
          code: 'INCOMPLETE_QUOTE',
          message: `Falta completar: ${missing.join(', ')}`,
        });
      return { status: 'IN_REVIEW' };
    });
    void this.notifier.notify({ kind: 'REVIEW_REQUESTED', versionId: id }, user.id);
    return dto;
  }

  /** US-071, US-073: an office approver who neither built nor quotes this version. */
  @Post('quotes/:id/approve')
  async approve(
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
    @Param('id', uuid) id: string,
    @Body(new ZodPipe(ReviewQuote)) body: z.infer<typeof ReviewQuote>,
  ) {
    const dto = await this.review(user, req, id, body.rowVersion, 'quote.approved', (v, r) => {
      this.assertReviewer(user, v, r);
      this.assertWithinLimit(user, v);
      return { status: 'APPROVED', decision: 'APPROVED', comment: body.comment };
    });
    void this.notifier.notify({ kind: 'APPROVED', versionId: id }, user.id);
    return dto;
  }

  /** US-072: back to the quoter with a mandatory reason. */
  @Post('quotes/:id/return')
  async returnForChanges(
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
    @Param('id', uuid) id: string,
    @Body(new ZodPipe(ReturnQuote)) body: z.infer<typeof ReturnQuote>,
  ) {
    const dto = await this.review(user, req, id, body.rowVersion, 'quote.rejected_for_changes', (v, r) => {
      this.assertReviewer(user, v, r);
      return { status: 'RETURNED', decision: 'RETURNED', comment: body.comment };
    });
    void this.notifier.notify({ kind: 'RETURNED', versionId: id }, user.id);
    return dto;
  }

  /** US-074, US-075: records the manual send; refused unless the approved calculation is unchanged. */
  @Post('quotes/:id/send')
  send(
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
    @Param('id', uuid) id: string,
    @Body(new ZodPipe(SendQuote)) body: z.infer<typeof SendQuote>,
  ) {
    return this.review(user, req, id, body.rowVersion, 'quote.sent', (v, r, tx) => {
      if (!(r.assigneeId === user.id || hasOfficeRole(user, r.officeId, ['OFFICE_ADMIN'])))
        throw new ForbiddenException('Solo el cotizador asignado o el coordinador');
      const approval = v.reviews.findLast((x) => x.decision === 'APPROVED');
      if (v.status !== 'APPROVED' || !approval)
        throw new ForbiddenException('No se puede enviar un viaje sin autorización');
      if (approval.calculationHash !== snapshotHash(v))
        throw new ConflictException({
          code: 'APPROVAL_STALE',
          message: 'La cotización cambió después de autorizarse; vuelve a enviarla a autorización',
        });
      return {
        status: 'SENT',
        after: async () => {
          await tx.proposalDelivery.create({
            data: {
              versionId: v.id,
              sentById: user.id,
              recipients: body.recipients,
              channel: body.channel,
              sentOn: toDate(body.sentOn),
              notes: body.notes,
            },
          });
          await tx.travelRequest.updateMany({
            where: { id: r.id, status: 'QUOTING' },
            data: { status: 'SENT', version: { increment: 1 } },
          });
        },
      };
    });
  }

  /**
   * Publishes the winning proposal as a WeTravel payment link (price and payment plan per participant).
   * One link per request: a second call returns 409 with the existing URL.
   */
  /** What the group has paid through the WeTravel link, read live (nothing about payers is stored). */
  @Get('requests/:id/wetravel/payments')
  async wetravelPayments(@CurrentUser() user: AuthUser, @Param('id', uuid) id: string) {
    await this.request(this.prisma, id, user);
    const r = await this.prisma.travelRequest.findUniqueOrThrow({ where: { id } });
    if (!r.wetravelLinkId) throw new NotFoundException('La solicitud no tiene liga de WeTravel');
    if (!this.wetravel) throw new ServiceUnavailableException('WeTravel no está configurado en el servidor');
    try {
      return await this.wetravel.linkPayments(r.wetravelLinkId);
    } catch (e) {
      if (!(e instanceof WeTravelError)) throw e;
      throw new BadGatewayException(e.message);
    }
  }

  @Post('quotes/:id/wetravel')
  async wetravelLink(@CurrentUser() user: AuthUser, @Req() req: Request, @Param('id', uuid) id: string) {
    const v = await this.prisma.quoteVersion.findUnique({ where: { id }, include: full });
    if (!v) throw new NotFoundException('Cotización no encontrada');
    const ref = await this.request(this.prisma, v.scenario.requestId, user);
    const r = await this.prisma.travelRequest.findUniqueOrThrow({ where: { id: ref.id } });
    if (!(r.assigneeId === user.id || hasOfficeRole(user, r.officeId, ['OFFICE_ADMIN'])))
      throw new ForbiddenException('Solo el cotizador asignado o el coordinador');
    if (r.status !== 'WON' || r.wonVersionId !== v.id)
      throw new ForbiddenException('Solo la propuesta ganadora se publica en WeTravel');
    if (r.wetravelUrl)
      throw new ConflictException({
        code: 'WETRAVEL_EXISTS',
        message: `Ya existe la liga: ${r.wetravelUrl}`,
      });
    if (!this.wetravel) throw new ServiceUnavailableException('WeTravel no está configurado en el servidor');
    const dto = toDto(v);
    if (!dto.totals || dto.warnings.length)
      throw new BadRequestException('La cotización tiene avisos pendientes (tipo de cambio o plan de pagos)');
    let link;
    try {
      link = await this.wetravel.createPaymentLink(
        paymentLinkBody({
          folio: r.folio,
          groupName: r.groupName,
          departureDate: day(r.departureDate)!,
          returnDate: day(r.returnDate)!,
          currency: v.saleCurrency,
          price: dto.totals.pricePerParticipant,
          schedule: dto.paymentSchedule,
        }),
      );
    } catch (e) {
      if (!(e instanceof WeTravelError)) throw e;
      if (e.status === 400) throw new BadRequestException(e.message);
      throw new BadGatewayException(e.message);
    }
    return this.prisma.$transaction(async (tx) => {
      // shortcut: two simultaneous clicks can each create a link in WeTravel; only the first is kept here.
      const { count } = await tx.travelRequest.updateMany({
        where: { id: r.id, wetravelLinkId: null },
        data: { wetravelLinkId: link.uuid, wetravelUrl: link.checkoutUrl },
      });
      if (!count) throw new ConflictException({ code: 'WETRAVEL_EXISTS', message: 'Ya existe la liga' });
      await audit(tx, {
        actorUserId: user.id,
        action: 'request.wetravel_link',
        entityType: 'TravelRequest',
        entityId: r.id,
        correlationId: req.correlationId,
        diff: { versionId: v.id, wetravelLinkId: link.uuid },
      });
      return { wetravelUrl: link.checkoutUrl };
    });
  }

  /** Role policy "tope de autorización": compared on the group price in pesos. */
  private assertWithinLimit(user: AuthUser, v: FullVersion) {
    const limit = approvalLimitMxn(user);
    if (limit === null) return;
    const { groupPrice } = engine(v);
    const rate = v.saleCurrency === 'MXN' ? new D(1) : v.mxnRate && new D(v.mxnRate.toString());
    if (!rate)
      throw new ForbiddenException(
        'Tu autorización tiene tope en pesos: captura el tipo de cambio a MXN de la cotización',
      );
    if (groupPrice.mul(rate).gt(limit))
      throw new ForbiddenException(
        `El total del grupo supera tu tope de autorización (${limit} MXN); debe autorizarlo alguien con un tope mayor`,
      );
  }

  private assertReviewer(user: AuthUser, v: FullVersion, r: RequestRef) {
    if (!hasOfficeRole(user, r.officeId, ['APPROVER']))
      throw new ForbiddenException('Necesitas el privilegio "Autorizar viaje"');
    if (v.createdById === user.id || r.assigneeId === user.id)
      throw new ForbiddenException('No puedes autorizar una cotización que tú preparaste');
    if (v.status !== 'IN_REVIEW') throw new ForbiddenException('La versión no está en revisión');
  }

  private review(
    user: AuthUser,
    req: Request,
    id: string,
    rowVersion: number,
    action: string,
    decide: (
      v: FullVersion,
      r: RequestRef & { id: string },
      tx: Tx,
    ) => {
      status: 'IN_REVIEW' | 'APPROVED' | 'RETURNED' | 'SENT';
      decision?: 'APPROVED' | 'RETURNED';
      comment?: string;
      after?: () => Promise<unknown>;
    },
  ) {
    return this.prisma.$transaction(async (tx) => {
      const v = await tx.quoteVersion.findUnique({ where: { id }, include: full });
      if (!v) throw new NotFoundException('Cotización no encontrada');
      const r = await this.request(tx, v.scenario.requestId, user);
      const next = decide(v, r, tx);
      if (v.rowVersion !== rowVersion) throw conflict();
      const { count } = await tx.quoteVersion.updateMany({
        where: { id, rowVersion },
        data: { status: next.status, rowVersion: { increment: 1 } },
      });
      if (!count) throw conflict();
      if (next.decision)
        await tx.quoteReview.create({
          data: {
            versionId: id,
            reviewerId: user.id,
            decision: next.decision,
            comment: next.comment,
            calculationHash: snapshotHash(v),
          },
        });
      await next.after?.();
      await audit(tx, {
        actorUserId: user.id,
        action,
        entityType: 'QuoteVersion',
        entityId: id,
        correlationId: req.correlationId,
        diff: {
          status: { from: v.status, to: next.status },
          ...(next.comment ? { comment: next.comment } : {}),
        },
      });
      return toDto(await tx.quoteVersion.findUniqueOrThrow({ where: { id }, include: full }));
    });
  }
}
