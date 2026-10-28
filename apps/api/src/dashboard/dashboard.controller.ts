import { Controller, Get, Inject } from '@nestjs/common';
import type { RequestStatus, RoleName } from '@ee/contracts';
import type { Prisma, PrismaClient } from '@ee/db';
import type { AuthUser } from '../auth/auth.types.js';
import { officeScope, officesWithRole } from '../auth/authz.js';
import { CurrentUser } from '../auth/session.guard.js';
import { PRISMA } from '../prisma.service.js';
import { QuoteEngineError } from '@ee/quote-engine';
import { engine } from '../quotes/quotes.controller.js';

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

const officesWith = (user: AuthUser, roles: readonly RoleName[]): Prisma.TravelRequestWhereInput => {
  const ids = officesWithRole(user, roles);
  return ids === 'ALL' ? {} : { officeId: { in: ids } };
};

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
  role: 'REQUESTER' | 'ASSIGNEE' | 'SUPPORT';
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

const stageOf = (status: RequestStatus, versions: { status: string }[]): Stage => {
  if (status === 'SENT' || status === 'WON') return 4;
  if (status !== 'QUOTING') return 1;
  if (versions.some((v) => v.status === 'APPROVED')) return 3;
  return versions.some((v) => v.status === 'IN_REVIEW' || v.status === 'RETURNED') ? 2 : 1;
};

// shortcut: unpaged lists capped at TASK_LIMIT per kind, fine for pilot volumes; page them if offices grow.
const TASK_LIMIT = 50;
const REQUEST_LIMIT = 100;

/** "Mi trabajo": what is waiting on the current user, and request counts per office in their scope. */
@Controller('dashboard')
export class DashboardController {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  @Get()
  async get(@CurrentUser() user: AuthUser) {
    const [tasks, offices, requests] = await Promise.all([
      this.tasks(user),
      this.officeCounts(user),
      this.requests(user),
    ]);
    const byDue = (a: DashboardTask, b: DashboardTask) =>
      (a.dueDate ?? a.departureDate).localeCompare(b.dueDate ?? b.departureDate);
    return { tasks: tasks.sort(byDue), offices, requests };
  }

  /** Open requests in the user's scope (won trips until they depart), same visibility as the counts. */
  private async requests(user: AuthUser): Promise<DashboardRequest[]> {
    const scope = officeScope(user);
    const rows = await this.prisma.travelRequest.findMany({
      where: {
        ...(scope === 'ALL' ? {} : { officeId: { in: scope } }),
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
      const shown =
        versions.find((v) => v.id === r.wonVersionId) ??
        versions.reduce<(typeof versions)[number] | undefined>(
          (best, v) =>
            !best ||
            RANK[v.status]! > RANK[best.status]! ||
            (RANK[v.status] === RANK[best.status] && v.updatedAt > best.updatedAt)
              ? v
              : best,
          undefined,
        );
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
        role: r.requesterId === user.id ? 'REQUESTER' : r.assigneeId === user.id ? 'ASSIGNEE' : 'SUPPORT',
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
    const inScope = scope === 'ALL' ? {} : { id: { in: scope } };
    const [offices, groups] = await Promise.all([
      this.prisma.office.findMany({
        where: inScope,
        select: { id: true, code: true, name: true },
        orderBy: { code: 'asc' },
      }),
      this.prisma.travelRequest.groupBy({
        by: ['officeId', 'status'],
        where: {
          ...(scope === 'ALL' ? {} : { officeId: { in: scope } }),
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
