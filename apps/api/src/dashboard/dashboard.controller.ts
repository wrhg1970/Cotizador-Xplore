import { Controller, ForbiddenException, Get, Inject, Query } from '@nestjs/common';
import { ExecutiveDashboardQuery, type RequestStatus, type RoleName } from '@ee/contracts';
import type { Prisma, PrismaClient } from '@ee/db';
import type { AuthUser } from '../auth/auth.types.js';
import { canSeeInternalCosts, officeScope, officesWithRole } from '../auth/authz.js';
import { CurrentUser } from '../auth/session.guard.js';
import { PRISMA } from '../prisma.service.js';
import { D, type Dec, QuoteEngineError } from '@ee/quote-engine';
import { engine } from '../quotes/quotes.controller.js';
import type { z } from 'zod';
import { ZodPipe } from '../zod.pipe.js';
import { alertSettings, computeAlerts } from '../alerts/alerts.js';
import { officeGoals } from '../settings/settings.js';

export type TaskKind =
  'SUBMIT_REQUEST' | 'ASSIGN' | 'QUOTE' | 'FIX_QUOTE' | 'APPROVE' | 'SEND' | 'RECORD_OUTCOME';

export interface DashboardTask {
  kind: TaskKind;
  requestId: string;
  folio: string;
  groupName: string;
  officeCode: string;
  dueDate: string | null;
  departureDate: string;
  quoteId: string | null;
  quoteLabel: string | null;
}

const officesWith = (user: AuthUser, roles: readonly RoleName[]): Prisma.TravelRequestWhereInput => ({
  officeId: { in: officesWithRole(user, roles) },
});

const requestSelect = {
  id: true,
  folio: true,
  groupName: true,
  dueDate: true,
  departureDate: true,
  office: { select: { code: true } },
} satisfies Prisma.TravelRequestSelect;

type RequestRow = Prisma.TravelRequestGetPayload<{ select: typeof requestSelect }>;

const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

const task = (
  kind: TaskKind,
  r: RequestRow,
  quote?: { id: string; number: number; scenario: { name: string } },
): DashboardTask => ({
  kind,
  requestId: r.id,
  folio: r.folio,
  groupName: r.groupName,
  officeCode: r.office.code,
  dueDate: day(r.dueDate),
  departureDate: day(r.departureDate)!,
  quoteId: quote?.id ?? null,
  quoteLabel: quote ? `${quote.scenario.name} · v${quote.number}` : null,
});

/** The four stages of "Mi trabajo": Solicitada, Cotizada, Aprobada, Enviada. */
export type Stage = 1 | 2 | 3 | 4;

export interface DashboardRequest {
  id: string;
  folio: string;
  status: RequestStatus;
  stage: Stage;
  officeCode: string;
  city: string;
  countryCode: string;
  departureDate: string;
  groupName: string;
  clientName: string | null;
  program: string | null;
  participants: number;
  chaperones: number;
  scenarios: number;
  /** Client price per student of the version that best represents the request, never costs. */
  price: { amount: string; currency: string } | null;
  role: 'REQUESTER' | 'ASSIGNEE' | 'COMMERCIAL' | 'SUPPORT';
}

const QUOTED = ['IN_REVIEW', 'RETURNED', 'APPROVED', 'SENT'] as const;
/** Which version's price to show: the winner, else the most advanced one. */
const RANK: Record<string, number> = { SENT: 4, APPROVED: 3, IN_REVIEW: 2, RETURNED: 1 };

/** A version that no longer computes (e.g. a missing exchange rate) shows no price instead of failing the page. */
const priceOf = (v: Parameters<typeof engine>[0]) => {
  try {
    return { amount: engine(v).pricePerParticipant.toFixed(2), currency: v.saleCurrency };
  } catch (e) {
    if (e instanceof QuoteEngineError) return null;
    throw e;
  }
};

/** Price per student in MXN as Finance shows it; null when it can't be known without inferring a rate. */
const mxnPerParticipant = (v: Parameters<typeof engine>[0]): Dec | null => {
  try {
    const t = engine(v);
    return v.saleCurrency === 'MXN' ? t.pricePerParticipant : t.pricePerParticipantMxn;
  } catch (e) {
    if (e instanceof QuoteEngineError) return null;
    throw e;
  }
};

/** V2 commercial funnel: Nueva → En cotización → Aprobada → Enviada → Aceptada; the furthest step a request reached. */
type Reached = 1 | 2 | 3 | 4 | 5;
const reachedOf = (status: RequestStatus, versions: { status: string }[]): Reached => {
  if (status === 'WON') return 5;
  if (status === 'SENT' || status === 'LOST' || versions.some((v) => v.status === 'SENT')) return 4;
  if (versions.some((v) => v.status === 'APPROVED')) return 3;
  return status === 'QUOTING' || versions.length ? 2 : 1;
};

/** The version that best represents a request: the winner, else the most advanced quoted one. */
const shownVersion = <V extends { id: string; status: string; updatedAt: Date }>(
  versions: V[],
  wonVersionId: string | null,
): V | undefined =>
  versions.find((v) => v.id === wonVersionId) ??
  versions
    .filter((v) => v.status in RANK)
    .reduce<V | undefined>(
      (best, v) =>
        !best ||
        RANK[v.status]! > RANK[best.status]! ||
        (RANK[v.status] === RANK[best.status] && v.updatedAt > best.updatedAt)
          ? v
          : best,
      undefined,
    );

/** Group price and commission in MXN; null when the version doesn't compute or has no MXN rate (never inferred). */
const groupMxn = (v: Parameters<typeof engine>[0]): { volume: Dec; commission: Dec } | null => {
  try {
    const t = engine(v);
    if (v.saleCurrency === 'MXN')
      return { volume: t.pricePerParticipant.mul(v.participants), commission: t.groupMargin };
    return t.pricePerParticipantMxn && t.groupMarginMxn
      ? { volume: t.pricePerParticipantMxn.mul(v.participants), commission: t.groupMarginMxn }
      : null;
  } catch (e) {
    if (e instanceof QuoteEngineError) return null;
    throw e;
  }
};

export const stageOf = (status: RequestStatus, versions: { status: string }[]): Stage => {
  if (status === 'SENT' || status === 'WON') return 4;
  if (status !== 'QUOTING') return 1;
  if (versions.some((v) => v.status === 'APPROVED')) return 3;
  return versions.some((v) => v.status === 'IN_REVIEW' || v.status === 'RETURNED') ? 2 : 1;
};

/** Who reads the executive dashboard: same readers as the audit log. */
const EXECUTIVES = ['OFFICE_ADMIN', 'AUDITOR'] as const;
const UPCOMING_DAYS = 60;

/** Money per currency: never added across currencies, since exchange rates are not inferred. */
type Sums = Record<string, Dec>;
const addTo = (sums: Sums, currency: string, x: Dec) => {
  sums[currency] = (sums[currency] ?? new D(0)).plus(x);
};
const fixed = (sums: Sums) => Object.fromEntries(Object.entries(sums).map(([c, x]) => [c, x.toFixed(2)]));

// shortcut: unpaged lists capped at TASK_LIMIT per kind, fine for pilot volumes; page them if offices grow.
const TASK_LIMIT = 50;
const REQUEST_LIMIT = 100;

/** "Mi trabajo": what is waiting on the current user, and request counts per office in their scope. */
@Controller('dashboard')
export class DashboardController {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  @Get()
  async get(@CurrentUser() user: AuthUser) {
    const [tasks, offices, requests, alerts] = await Promise.all([
      this.tasks(user),
      this.officeCounts(user),
      this.requests(user),
      alertSettings(this.prisma, user.agencyId).then((s) =>
        computeAlerts(this.prisma, user.agencyOfficeIds, s),
      ),
    ]);
    const byDue = (a: DashboardTask, b: DashboardTask) =>
      (a.dueDate ?? a.departureDate).localeCompare(b.dueDate ?? b.departureDate);
    return {
      tasks: tasks.sort(byDue),
      offices,
      requests,
      alerts: alerts.filter((a) => a.userIds.includes(user.id)).map(({ userIds: _, ...a }) => a),
    };
  }

  /**
   * Executive view (V2 dashboards): the cohort of requests created in the period, by stage, outcome,
   * office and month. Client prices only, per currency; costs and margin never leave the quote screens.
   */
  @Get('executive')
  async executive(
    @CurrentUser() user: AuthUser,
    @Query(new ZodPipe(ExecutiveDashboardQuery)) q: z.infer<typeof ExecutiveDashboardQuery>,
  ) {
    const scope = officesWithRole(user, EXECUTIVES);
    if (scope.length === 0)
      throw new ForbiddenException(
        'Solo coordinadores, auditores y administradores ven el tablero ejecutivo',
      );
    if (q.officeId && !scope.includes(q.officeId)) throw new ForbiddenException();

    const today = new Date().toISOString().slice(0, 10);
    const from = q.from ?? `${today.slice(0, 4)}-01-01`;
    const to = q.to ?? today;
    const offices: Prisma.TravelRequestWhereInput = { officeId: q.officeId ?? { in: scope } };
    const soon = new Date(Date.now() + UPCOMING_DAYS * 86_400_000);
    const year = Number(to.slice(0, 4));

    // shortcut: whole cohort loaded and aggregated in memory, fine for pilot volumes; move to SQL if it grows.
    const [rows, upcoming] = await Promise.all([
      this.prisma.travelRequest.findMany({
        where: {
          ...offices,
          status: { not: 'DRAFT' },
          createdAt: {
            gte: new Date(`${from}T00:00:00Z`),
            lt: new Date(new Date(`${to}T00:00:00Z`).getTime() + 86_400_000),
          },
        },
        select: {
          id: true,
          folio: true,
          groupName: true,
          clientName: true,
          program: true,
          city: true,
          countryCode: true,
          departureDate: true,
          dueDate: true,
          status: true,
          createdAt: true,
          participants: true,
          chaperones: true,
          staff: true,
          budgetAmount: true,
          budgetCurrency: true,
          budgetBasis: true,
          wonVersionId: true,
          office: { select: { id: true, code: true, name: true } },
          scenarios: {
            select: {
              versions: { include: { lines: true, fxRates: true, deliveries: { select: { sentOn: true } } } },
            },
          },
          wonVersion: { include: { lines: true, fxRates: true } },
        },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.travelRequest.findMany({
        where: { ...offices, status: 'WON', departureDate: { gte: new Date(today), lte: soon } },
        select: { ...requestSelect, participants: true, chaperones: true },
        orderBy: { departureDate: 'asc' },
        take: TASK_LIMIT,
      }),
    ]);
    const goals = await this.goals(user.agencyId, q.officeId ? [q.officeId] : scope, year);

    type Bucket = {
      requests: number;
      open: number;
      won: number;
      lost: number;
      cancelled: number;
      wonAmount: Sums;
      wonStudents: number;
    };
    const bucket = (): Bucket => ({
      requests: 0,
      open: 0,
      won: 0,
      lost: 0,
      cancelled: 0,
      wonAmount: {},
      wonStudents: 0,
    });
    const totals = bucket();
    const funnel: Record<Stage, number> = { 1: 0, 2: 0, 3: 0, 4: 0 };
    const byOffice = new Map<string, Bucket & { id: string; code: string; name: string }>();
    const byMonth = new Map<string, Bucket>();
    for (const r of rows) {
      const office = byOffice.get(r.office.id) ?? { ...r.office, ...bucket() };
      byOffice.set(r.office.id, office);
      const month = r.createdAt.toISOString().slice(0, 7);
      const monthly = byMonth.get(month) ?? bucket();
      byMonth.set(month, monthly);
      const price = r.status === 'WON' && r.wonVersion ? priceOf(r.wonVersion) : null;
      for (const b of [totals, office, monthly]) {
        b.requests++;
        if (r.status === 'WON') {
          b.won++;
          b.wonStudents += r.participants;
          if (price) addTo(b.wonAmount, price.currency, new D(price.amount).mul(r.wonVersion!.participants));
        } else if (r.status === 'LOST') b.lost++;
        else if (r.status === 'CANCELLED') b.cancelled++;
        else b.open++;
      }
      if (['SUBMITTED', 'QUOTING', 'SENT'].includes(r.status))
        funnel[
          stageOf(
            r.status,
            r.scenarios.flatMap((s) => s.versions),
          )
        ]++;
    }
    const out = (b: Bucket) => ({
      ...b,
      wonAmount: fixed(b.wonAmount),
      conversion: b.won + b.lost ? Math.round((b.won / (b.won + b.lost)) * 1000) / 10 : null,
    });
    return {
      period: { from, to },
      totals: out(totals),
      funnel: ([1, 2, 3, 4] as const).map((stage) => ({ stage, count: funnel[stage] })),
      byOffice: [...byOffice.values()].sort((a, b) => a.code.localeCompare(b.code)).map(out),
      monthly: [...byMonth.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([month, b]) => ({ month, ...out(b) })),
      upcoming: upcoming.map((r) => ({
        id: r.id,
        folio: r.folio,
        groupName: r.groupName,
        officeCode: r.office.code,
        departureDate: day(r.departureDate)!,
        participants: r.participants,
        chaperones: r.chaperones,
      })),
      goals,
      requests: rows.map((r) => {
        const versions = r.scenarios.flatMap((s) => s.versions);
        const shown = shownVersion(versions, r.wonVersionId);
        const group = shown ? groupMxn(shown) : null;
        const sent = versions.flatMap((v) => v.deliveries.map((d) => d.sentOn.getTime()));
        const budget =
          r.budgetAmount && r.budgetCurrency === 'MXN'
            ? new D(r.budgetAmount.toString()).mul(r.budgetBasis === 'TOTAL' ? 1 : r.participants)
            : null;
        return {
          id: r.id,
          folio: r.folio,
          groupName: r.groupName,
          clientName: r.clientName,
          program: r.program,
          officeCode: r.office.code,
          city: r.city,
          countryCode: r.countryCode,
          participants: r.participants,
          chaperones: r.chaperones,
          staff: r.staff,
          scenarios: r.scenarios.length,
          createdAt: day(r.createdAt)!,
          departureDate: day(r.departureDate)!,
          dueDate: day(r.dueDate),
          firstSentOn: sent.length ? day(new Date(Math.min(...sent))) : null,
          status: r.status,
          stage: stageOf(r.status, versions),
          reached: reachedOf(r.status, versions),
          // Budget only when the school gave it in MXN: other currencies would need an inferred rate.
          budgetMxn: budget?.toFixed(2) ?? null,
          volumeMxn: group?.volume.toFixed(2) ?? null,
          // Commission (margin over the sale price) only for roles that see internal costs in that office.
          ...(canSeeInternalCosts(user, r.office.id) && {
            commissionMxn: group?.commission.toFixed(2) ?? null,
          }),
        };
      }),
    };
  }

  /**
   * V2 "Meta anual": MXN won per office in the goal's year (by closing date) against its goal.
   * Only offices with a goal; a won trip in another currency without an MXN rate is counted apart.
   */
  private async goals(agencyId: string, scope: string[], year: number) {
    const set = await officeGoals(this.prisma, agencyId, year);
    const ids = Object.keys(set);
    if (!ids.length) return { year, offices: [] };
    const visible = ids.filter((id) => scope.includes(id));
    const [rows, names] = await Promise.all([
      this.prisma.travelRequest.findMany({
        where: {
          officeId: { in: visible },
          status: 'WON',
          closedAt: { gte: new Date(`${year}-01-01T00:00:00Z`), lt: new Date(`${year + 1}-01-01T00:00:00Z`) },
        },
        select: { officeId: true, wonVersion: { include: { lines: true, fxRates: true } } },
      }),
      this.prisma.office.findMany({
        where: { id: { in: visible } },
        select: { id: true, code: true, name: true },
      }),
    ]);
    return {
      year,
      offices: names
        .sort((a, b) => a.code.localeCompare(b.code))
        .map((o) => {
          let won = new D(0);
          let withoutRate = 0;
          for (const r of rows.filter((x) => x.officeId === o.id && x.wonVersion)) {
            const v = r.wonVersion!;
            const each = mxnPerParticipant(v);
            if (each) won = won.plus(each.mul(v.participants));
            else withoutRate++;
          }
          const goal = new D(set[o.id]!);
          return {
            ...o,
            goalMxn: goal.toFixed(2),
            wonMxn: won.toFixed(2),
            progress: goal.gt(0) ? Number(won.div(goal).mul(100).toFixed(1)) : null,
            withoutRate,
          };
        }),
    };
  }

  /** Open requests in the user's scope (won trips until they depart), same visibility as the counts. */
  private async requests(user: AuthUser): Promise<DashboardRequest[]> {
    const scope = officeScope(user);
    const rows = await this.prisma.travelRequest.findMany({
      where: {
        officeId: { in: scope },
        OR: [
          { status: { in: ['SUBMITTED', 'QUOTING', 'SENT'] } },
          { status: 'DRAFT', requesterId: user.id },
          { status: 'WON', departureDate: { gte: new Date(new Date().toISOString().slice(0, 10)) } },
        ],
      },
      orderBy: [{ departureDate: 'asc' }, { id: 'asc' }],
      take: REQUEST_LIMIT,
      include: {
        office: { select: { code: true } },
        members: { where: { userId: user.id, kind: 'COMMERCIAL' }, select: { kind: true } },
        scenarios: {
          select: {
            versions: {
              where: { status: { in: [...QUOTED] } },
              include: { lines: true, fxRates: true },
            },
          },
        },
      },
    });
    return rows.map((r) => {
      const versions = r.scenarios.flatMap((s) => s.versions);
      const shown = shownVersion(versions, r.wonVersionId);
      return {
        id: r.id,
        folio: r.folio,
        status: r.status,
        stage: stageOf(r.status, versions),
        officeCode: r.office.code,
        city: r.city,
        countryCode: r.countryCode,
        departureDate: day(r.departureDate)!,
        groupName: r.groupName,
        clientName: r.clientName,
        program: r.program,
        participants: r.participants,
        chaperones: r.chaperones,
        scenarios: r.scenarios.length,
        price: shown ? priceOf(shown) : null,
        role:
          r.requesterId === user.id
            ? 'REQUESTER'
            : r.assigneeId === user.id
              ? 'ASSIGNEE'
              : r.members.length
                ? 'COMMERCIAL'
                : 'SUPPORT',
      };
    });
  }

  private async tasks(user: AuthUser): Promise<DashboardTask[]> {
    const me = user.id;
    const findRequests = (where: Prisma.TravelRequestWhereInput) =>
      this.prisma.travelRequest.findMany({ where, select: requestSelect, take: TASK_LIMIT });
    const findQuotes = (where: Prisma.QuoteVersionWhereInput) =>
      this.prisma.quoteVersion.findMany({
        where,
        take: TASK_LIMIT,
        select: {
          id: true,
          number: true,
          scenario: { select: { name: true, request: { select: requestSelect } } },
        },
      });
    const [drafts, toAssign, toQuote, returned, toApprove, toSend, awaitingClient] = await Promise.all([
      findRequests({ status: 'DRAFT', requesterId: me }),
      findRequests({ status: 'SUBMITTED', assigneeId: null, ...officesWith(user, ['OFFICE_ADMIN']) }),
      // Once a version is in review, approved or returned, the request shows up under that step instead.
      findRequests({
        status: 'QUOTING',
        assigneeId: me,
        scenarios: {
          none: { versions: { some: { status: { in: ['IN_REVIEW', 'APPROVED', 'RETURNED'] } } } },
        },
      }),
      findQuotes({
        status: 'RETURNED',
        scenario: { request: { status: 'QUOTING' } },
        OR: [{ createdById: me }, { scenario: { request: { assigneeId: me } } }],
      }),
      // Same rule as QuotesController.assertReviewer: never the version's author or the request's quoter.
      findQuotes({
        status: 'IN_REVIEW',
        createdById: { not: me },
        scenario: {
          request: {
            ...officesWith(user, ['APPROVER']),
            OR: [{ assigneeId: null }, { assigneeId: { not: me } }],
          },
        },
      }),
      findQuotes({
        status: 'APPROVED',
        scenario: {
          request: { status: 'QUOTING', OR: [{ assigneeId: me }, officesWith(user, ['OFFICE_ADMIN'])] },
        },
      }),
      // Same rule as canRecordOutcome: sent proposals waiting for the client's answer.
      findRequests({ status: 'SENT', OR: [{ assigneeId: me }, officesWith(user, ['OFFICE_ADMIN'])] }),
    ]);
    const fromQuotes = (kind: TaskKind, qs: typeof returned) =>
      qs.map((q) => task(kind, q.scenario.request, q));
    return [
      ...drafts.map((r) => task('SUBMIT_REQUEST', r)),
      ...toAssign.map((r) => task('ASSIGN', r)),
      ...toQuote.map((r) => task('QUOTE', r)),
      ...fromQuotes('FIX_QUOTE', returned),
      ...fromQuotes('APPROVE', toApprove),
      ...fromQuotes('SEND', toSend),
      ...awaitingClient.map((r) => task('RECORD_OUTCOME', r)),
    ];
  }

  /** Same visibility as the inbox: other people's drafts are not counted. */
  private async officeCounts(user: AuthUser) {
    const scope = officeScope(user);
    const [offices, groups] = await Promise.all([
      this.prisma.office.findMany({
        where: { id: { in: scope } },
        select: { id: true, code: true, name: true },
        orderBy: { code: 'asc' },
      }),
      this.prisma.travelRequest.groupBy({
        by: ['officeId', 'status'],
        where: {
          officeId: { in: scope },
          OR: [{ status: { not: 'DRAFT' } }, { requesterId: user.id }],
        },
        _count: { _all: true },
      }),
    ]);
    return offices.map((o) => ({
      ...o,
      byStatus: Object.fromEntries(
        groups.filter((g) => g.officeId === o.id).map((g) => [g.status, g._count._all]),
      ) as Partial<Record<(typeof groups)[number]['status'], number>>,
    }));
  }
}
