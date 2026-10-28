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
  Query,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import {
  AssignRequest,
  CancelRequest,
  CreateComment,
  CreateRequest,
  ListRequestsQuery,
  RecordOutcome,
  UpdateRequest,
  VersionOnly,
  type Budget,
  type TripSpecs,
} from '@ee/contracts';
import { Prisma, type PrismaClient, type TravelRequest } from '@ee/db';
import type { z } from 'zod';
import { audit } from '../audit.js';
import type { AuthUser } from '../auth/auth.types.js';
import { hasOfficeRole, officeScope, officesWithRole } from '../auth/authz.js';
import { CurrentUser } from '../auth/session.guard.js';
import { Notifier } from '../notify/notifier.js';
import { PRISMA } from '../prisma.service.js';
import { ZodPipe } from '../zod.pipe.js';
import { FOLIO_PATTERN, newFolio } from './folio.js';
import {
  canAssign,
  canCancel,
  canCreateIn,
  canEdit,
  canRecordOutcome,
  canSubmit,
  canView,
  canViewQuotes,
} from './request-policy.js';

type Tx = Prisma.TransactionClient;
type Row = TravelRequest & {
  office: { id: string; code: string; name: string };
  requester: { id: string; name: string };
  assignee: { id: string; name: string } | null;
};

const uuid = new ParseUUIDPipe({ version: '4' });
const include = {
  office: { select: { id: true, code: true, name: true } },
  requester: { select: { id: true, name: true } },
  assignee: { select: { id: true, name: true } },
} as const;

const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
const toDate = (s: string) => new Date(`${s}T00:00:00Z`);

function toDto(r: Row) {
  return {
    id: r.id,
    folio: r.folio,
    status: r.status,
    version: r.version,
    office: r.office,
    requester: r.requester,
    assignee: r.assignee,
    groupName: r.groupName,
    clientName: r.clientName,
    program: r.program,
    contactName: r.contactName,
    contactEmail: r.contactEmail,
    city: r.city,
    countryCode: r.countryCode,
    departureDate: day(r.departureDate),
    returnDate: day(r.returnDate),
    participants: r.participants,
    chaperones: r.chaperones,
    staff: r.staff,
    budget:
      r.budgetAmount && r.budgetCurrency && r.budgetBasis
        ? { amount: r.budgetAmount.toFixed(2), currency: r.budgetCurrency, basis: r.budgetBasis }
        : null,
    requirements: r.requirements,
    commercialNotes: r.commercialNotes,
    specifications: (r.specifications as TripSpecs | null) ?? null,
    priority: r.priority,
    dueDate: day(r.dueDate),
    cancelReason: r.cancelReason,
    wonVersionId: r.wonVersionId,
    lostReason: r.lostReason,
    closedAt: r.closedAt?.toISOString() ?? null,
    wetravelUrl: r.wetravelUrl,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

/** Maps contract fields to columns; only keys present in the input are written. */
function toColumns(input: Partial<z.infer<typeof UpdateRequest>>): Prisma.TravelRequestUncheckedUpdateInput {
  const { budget, departureDate, returnDate, dueDate, specifications, version: _v, ...rest } = input;
  const data: Prisma.TravelRequestUncheckedUpdateInput = { ...rest };
  if (specifications !== undefined) data.specifications = specifications ?? Prisma.DbNull;
  if (departureDate) data.departureDate = toDate(departureDate);
  if (returnDate) data.returnDate = toDate(returnDate);
  if (dueDate) data.dueDate = toDate(dueDate);
  if (budget !== undefined) {
    const b: Budget | null = budget;
    data.budgetAmount = b ? new Prisma.Decimal(b.amount) : null;
    data.budgetCurrency = b?.currency ?? null;
    data.budgetBasis = b?.basis ?? null;
  }
  return data;
}

/** Free text and school contact data: audit says "changed" without copying personal data. */
const REDACTED = new Set([
  'requirements',
  'specifications',
  'commercialNotes',
  'contactName',
  'contactEmail',
]);

/** Field-level before/after for audit; free text is reported as changed, not copied (logs stay lean). */
function diff(before: ReturnType<typeof toDto>, after: ReturnType<typeof toDto>) {
  const changes: Record<string, Prisma.InputJsonValue> = {};
  for (const key of Object.keys(after) as (keyof typeof after)[]) {
    if (key === 'updatedAt' || key === 'version') continue;
    if (JSON.stringify(before[key]) === JSON.stringify(after[key])) continue;
    changes[key] = REDACTED.has(key)
      ? 'changed'
      : ({ from: before[key], to: after[key] } as Prisma.InputJsonObject);
  }
  return changes;
}

@Controller('requests')
export class RequestsController {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    private readonly notifier: Notifier,
  ) {}

  /** Loads a request the user may see; anything else is a 404 so ids leak nothing (US-004). */
  private async load(tx: Tx | PrismaClient, id: string, user: AuthUser): Promise<Row> {
    const row = await tx.travelRequest.findUnique({ where: { id }, include });
    if (!row || !canView(user, row)) throw new NotFoundException('Solicitud no encontrada');
    return row;
  }

  /** Optimistic write: fails with 409 if someone saved in between (US-142). */
  private async write(tx: Tx, row: Row, version: number, data: Prisma.TravelRequestUncheckedUpdateInput) {
    if (row.version !== version)
      throw new ConflictException({
        code: 'VERSION_CONFLICT',
        message: 'La solicitud cambió; recarga e inténtalo de nuevo',
      });
    const { count } = await tx.travelRequest.updateMany({
      where: { id: row.id, version },
      data: { ...data, version: { increment: 1 } },
    });
    if (!count)
      throw new ConflictException({
        code: 'VERSION_CONFLICT',
        message: 'La solicitud cambió; recarga e inténtalo de nuevo',
      });
    return tx.travelRequest.findUniqueOrThrow({ where: { id: row.id }, include });
  }

  @Post()
  async create(
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
    @Body(new ZodPipe(CreateRequest)) body: z.infer<typeof CreateRequest>,
  ) {
    if (!canCreateIn(user, body.officeId)) throw new ForbiddenException();
    const { officeId, ...fields } = body;
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.prisma.$transaction(async (tx) => {
          const office = await tx.office.findUnique({ where: { id: officeId } });
          if (!office?.active) throw new NotFoundException('Oficina no encontrada');
          const row = await tx.travelRequest.create({
            data: {
              ...(toColumns(fields) as Prisma.TravelRequestUncheckedCreateInput),
              folio: newFolio(),
              officeId,
              requesterId: user.id,
            },
            include,
          });
          await audit(tx, {
            actorUserId: user.id,
            action: 'request.created',
            entityType: 'TravelRequest',
            entityId: row.id,
            correlationId: req.correlationId,
            diff: { folio: row.folio },
          });
          return toDto(row);
        });
      } catch (err) {
        // Folio collision (≈1 in 10⁹): retry with a new one.
        const folioClash = err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
        if (!folioClash || attempt >= 2) throw err;
      }
    }
  }

  /** Inbox, search and filters (US-018, US-019, US-021); always within the user's offices. */
  @Get()
  async list(
    @CurrentUser() user: AuthUser,
    @Query(new ZodPipe(ListRequestsQuery)) q: z.infer<typeof ListRequestsQuery>,
  ) {
    const scope = officeScope(user);
    const adminOffices = officesWithRole(user, ['OFFICE_ADMIN']);
    const where: Prisma.TravelRequestWhereInput = {
      AND: [
        { officeId: { in: scope } },
        {
          OR: [{ status: { not: 'DRAFT' } }, { requesterId: user.id }, { officeId: { in: adminOffices } }],
        },
        q.officeId ? { officeId: q.officeId } : {},
        q.status ? { status: q.status } : {},
        q.assignedToMe === 'true' ? { assigneeId: user.id } : {},
        q.q
          ? FOLIO_PATTERN.test(q.q.toUpperCase())
            ? { folio: q.q.toUpperCase() }
            : { groupName: { contains: q.q, mode: 'insensitive' } }
          : {},
      ],
    };
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.travelRequest.count({ where }),
      this.prisma.travelRequest.findMany({
        where,
        include,
        orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
        skip: (q.page - 1) * q.limit,
        take: q.limit,
      }),
    ]);
    return { items: rows.map(toDto), total, page: q.page, limit: q.limit };
  }

  @Get(':id')
  async get(@CurrentUser() user: AuthUser, @Param('id', uuid) id: string) {
    return toDto(await this.load(this.prisma, id, user));
  }

  @Patch(':id')
  async update(
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
    @Param('id', uuid) id: string,
    @Body(new ZodPipe(UpdateRequest)) body: z.infer<typeof UpdateRequest>,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const row = await this.load(tx, id, user);
      if (!canEdit(user, row))
        throw new ForbiddenException('No puedes editar esta solicitud en su estado actual');
      const next = { departureDate: day(row.departureDate)!, returnDate: day(row.returnDate)!, ...body };
      if (next.returnDate < next.departureDate) {
        throw new BadRequestException({
          code: 'VALIDATION_ERROR',
          message: 'El regreso no puede ser anterior a la salida',
        });
      }
      const updated = await this.write(tx, row, body.version, toColumns(body));
      const changes = diff(toDto(row), toDto(updated));
      await audit(tx, {
        actorUserId: user.id,
        action: row.status === 'DRAFT' ? 'request.updated' : 'request.updated_after_submit',
        entityType: 'TravelRequest',
        entityId: id,
        correlationId: req.correlationId,
        diff: changes,
      });
      return toDto(updated);
    });
  }

  /** US-011 */
  @Post(':id/submit')
  async submit(
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
    @Param('id', uuid) id: string,
    @Body(new ZodPipe(VersionOnly)) body: z.infer<typeof VersionOnly>,
  ) {
    return this.transition(user, req, id, body.version, canSubmit, 'request.submitted', () => ({
      status: 'SUBMITTED',
    }));
  }

  /** US-020, US-197: assign or reassign a QUOTER of the same office. */
  @Post(':id/assign')
  async assign(
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
    @Param('id', uuid) id: string,
    @Body(new ZodPipe(AssignRequest)) body: z.infer<typeof AssignRequest>,
  ) {
    const dto = await this.transition(
      user,
      req,
      id,
      body.version,
      canAssign,
      'request.assigned',
      async (tx, row) => {
        const assignee = await tx.user.findUnique({
          where: { id: body.assigneeId },
          include: { officeRoles: true },
        });
        const isQuoter = assignee?.officeRoles.some(
          (r) => r.officeId === row.officeId && r.role === 'QUOTER',
        );
        if (!assignee || assignee.status === 'DISABLED' || !isQuoter) {
          throw new BadRequestException({
            code: 'INVALID_ASSIGNEE',
            message: 'El responsable debe ser cotizador activo de la oficina',
          });
        }
        return {
          status: 'QUOTING',
          assigneeId: assignee.id,
          auditDiff: { from: row.assigneeId, to: assignee.id },
        };
      },
    );
    void this.notifier.notify({ kind: 'ASSIGNED', requestId: id }, user.id);
    return dto;
  }

  /** US-024 */
  @Post(':id/cancel')
  async cancel(
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
    @Param('id', uuid) id: string,
    @Body(new ZodPipe(CancelRequest)) body: z.infer<typeof CancelRequest>,
  ) {
    return this.transition(user, req, id, body.version, canCancel, 'request.cancelled', () => ({
      status: 'CANCELLED',
      cancelReason: body.reason,
      auditDiff: { reason: body.reason },
    }));
  }

  /** PRD F-06: one winner per request (unique column), and it must be a version actually sent to the client. */
  @Post(':id/outcome')
  async outcome(
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
    @Param('id', uuid) id: string,
    @Body(new ZodPipe(RecordOutcome)) body: z.infer<typeof RecordOutcome>,
  ) {
    const action = body.outcome === 'WON' ? 'request.won' : 'request.lost';
    return this.transition(user, req, id, body.version, canRecordOutcome, action, async (tx, row) => {
      if (body.outcome === 'LOST')
        return {
          status: 'LOST',
          lostReason: body.reason,
          closedAt: new Date(),
          auditDiff: { reason: body.reason },
        };
      const v = await tx.quoteVersion.findFirst({
        where: { id: body.versionId, status: 'SENT', scenario: { requestId: row.id } },
        select: { id: true, number: true, scenario: { select: { name: true } } },
      });
      if (!v)
        throw new BadRequestException('La propuesta ganadora debe ser una versión enviada de esta solicitud');
      return {
        status: 'WON',
        wonVersionId: v.id,
        closedAt: new Date(),
        auditDiff: { versionId: v.id, proposal: `${v.scenario.name} · v${v.number}` },
      };
    });
  }

  private transition(
    user: AuthUser,
    req: Request,
    id: string,
    version: number,
    allowed: (u: AuthUser, r: Row) => boolean,
    action: string,
    change: (
      tx: Tx,
      row: Row,
    ) =>
      | (Prisma.TravelRequestUncheckedUpdateInput & { auditDiff?: Prisma.InputJsonValue })
      | Promise<Prisma.TravelRequestUncheckedUpdateInput & { auditDiff?: Prisma.InputJsonValue }>,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const row = await this.load(tx, id, user);
      if (!allowed(user, row)) throw new ForbiddenException('Acción no permitida en el estado actual');
      const { auditDiff, ...data } = await change(tx, row);
      const updated = await this.write(tx, row, version, data);
      await audit(tx, {
        actorUserId: user.id,
        action,
        entityType: 'TravelRequest',
        entityId: id,
        correlationId: req.correlationId,
        diff: {
          status: { from: row.status, to: updated.status },
          ...(auditDiff ? { detail: auditDiff } : {}),
        },
      });
      return toDto(updated);
    });
  }

  /** US-023 */
  @Post(':id/comments')
  async comment(
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
    @Param('id', uuid) id: string,
    @Body(new ZodPipe(CreateComment)) body: z.infer<typeof CreateComment>,
  ) {
    return this.prisma.$transaction(async (tx) => {
      await this.load(tx, id, user);
      const c = await tx.requestComment.create({
        data: { requestId: id, authorId: user.id, body: body.body },
      });
      await audit(tx, {
        actorUserId: user.id,
        action: 'request.commented',
        entityType: 'TravelRequest',
        entityId: id,
        correlationId: req.correlationId,
        diff: { commentId: c.id },
      });
      return {
        id: c.id,
        body: c.body,
        author: { id: user.id, name: user.name },
        createdAt: c.createdAt.toISOString(),
      };
    });
  }

  /** US-022: audited events + comments, oldest first. */
  @Get(':id/timeline')
  async timeline(@CurrentUser() user: AuthUser, @Param('id', uuid) id: string) {
    const r = await this.load(this.prisma, id, user);
    // Quote events (price, approval, sending) only for those who may see the quotes themselves.
    const versions = canViewQuotes(user, r)
      ? await this.prisma.quoteVersion.findMany({
          where: { scenario: { requestId: id } },
          select: { id: true },
        })
      : [];
    const [events, comments] = await Promise.all([
      this.prisma.auditLog.findMany({
        where: {
          OR: [
            { entityType: 'TravelRequest', entityId: id },
            { entityType: 'QuoteVersion', entityId: { in: versions.map((v) => v.id) } },
          ],
        },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.requestComment.findMany({
        where: { requestId: id },
        include: { author: { select: { id: true, name: true } } },
        orderBy: { createdAt: 'asc' },
      }),
    ]);
    const actorIds = [...new Set(events.map((e) => e.actorUserId).filter((x): x is string => !!x))];
    const actors = new Map(
      (
        await this.prisma.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, name: true } })
      ).map((a) => [a.id, a]),
    );
    return {
      events: events.map((e) => ({
        id: e.id,
        action: e.action,
        actor: e.actorUserId ? (actors.get(e.actorUserId) ?? null) : null,
        at: e.createdAt.toISOString(),
        detail: e.diff,
      })),
      comments: comments.map((c) => ({
        id: c.id,
        body: c.body,
        author: c.author,
        createdAt: c.createdAt.toISOString(),
      })),
    };
  }
}

/** For the assign picker: active quoters of an office. */
@Controller('offices')
export class OfficeQuotersController {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  @Get(':officeId/quoters')
  quoters(@CurrentUser() user: AuthUser, @Param('officeId', uuid) officeId: string) {
    if (!hasOfficeRole(user, officeId, ['OFFICE_ADMIN'])) throw new NotFoundException();
    return this.prisma.user.findMany({
      where: { status: { not: 'DISABLED' }, officeRoles: { some: { officeId, role: 'QUOTER' } } },
      select: { id: true, name: true, email: true },
      orderBy: { name: 'asc' },
    });
  }
}
