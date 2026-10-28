import { Controller, ForbiddenException, Get, Inject, Query, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { ListAuditLogsQuery } from '@ee/contracts';
import type { Prisma, PrismaClient } from '@ee/db';
import type { z } from 'zod';
import { audit } from '../audit.js';
import type { AuthUser } from '../auth/auth.types.js';
import { agencyWide, officesWithRole } from '../auth/authz.js';
import { CurrentUser } from '../auth/session.guard.js';
import { PRISMA } from '../prisma.service.js';
import { ZodPipe } from '../zod.pipe.js';

// Office admins and auditors read their offices' entries; agency-wide ones (logins, policies, catalog) need agency-wide readers.
const READERS = ['OFFICE_ADMIN', 'AUDITOR'] as const;
const EXPORT_LIMIT = 10_000;
/** RFC 4180 quoting, and a leading quote on cells Excel would run as a formula (CSV injection). */
export const csvCell = (v: string) => {
  const safe = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
  return /[",\r\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
};

/** Read-only browser over the append-only audit log (SECURITY.md control 11). */
@Controller('audit-logs')
export class AuditLogController {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  private async filter(user: AuthUser, q: z.infer<typeof ListAuditLogsQuery>) {
    const scope = officesWithRole(user, READERS);
    if (scope.length === 0 && !agencyWide(user, READERS))
      throw new ForbiddenException('Solo coordinadores, auditores y administradores consultan la bitácora');
    if (q.officeId && !scope.includes(q.officeId)) throw new ForbiddenException();

    const actor = q.actorEmail
      ? await this.prisma.user.findUnique({
          where: { email: q.actorEmail.toLowerCase() },
          select: { id: true },
        })
      : undefined;
    const versions = q.requestId
      ? await this.prisma.quoteVersion.findMany({
          where: { scenario: { requestId: q.requestId } },
          select: { id: true },
        })
      : [];
    const where: Prisma.AuditLogWhereInput = {
      AND: [
        agencyWide(user, READERS) ? { agencyId: user.agencyId } : { officeId: { in: scope } },
        q.officeId ? { officeId: q.officeId } : {},
        q.action ? { action: { startsWith: q.action } } : {},
        // Unknown email: match nothing rather than ignoring the filter.
        q.actorEmail ? { actorUserId: actor?.id ?? '00000000-0000-0000-0000-000000000000' } : {},
        q.entityId ? { entityId: q.entityId } : {},
        q.requestId ? { entityId: { in: [q.requestId, ...versions.map((v) => v.id)] } } : {},
        q.from ? { createdAt: { gte: new Date(`${q.from}T00:00:00Z`) } } : {},
        q.to ? { createdAt: { lt: new Date(new Date(`${q.to}T00:00:00Z`).getTime() + 86_400_000) } } : {},
      ],
    };
    return where;
  }

  private async named(rows: { actorUserId: string | null; officeId: string | null }[]) {
    const ids = [...new Set(rows.map((r) => r.actorUserId).filter((x): x is string => !!x))];
    const officeIds = [...new Set(rows.map((r) => r.officeId).filter((x): x is string => !!x))];
    const [users, offices] = await Promise.all([
      this.prisma.user.findMany({
        where: { id: { in: ids } },
        select: { id: true, name: true, email: true },
      }),
      this.prisma.office.findMany({ where: { id: { in: officeIds } }, select: { id: true, code: true } }),
    ]);
    return {
      actor: (id: string | null) => users.find((u) => u.id === id) ?? null,
      office: (id: string | null) => offices.find((o) => o.id === id)?.code ?? null,
    };
  }

  @Get()
  async list(
    @CurrentUser() user: AuthUser,
    @Query(new ZodPipe(ListAuditLogsQuery)) q: z.infer<typeof ListAuditLogsQuery>,
  ) {
    const where = await this.filter(user, q);
    const [rows, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (q.page - 1) * q.limit,
        take: q.limit,
      }),
      this.prisma.auditLog.count({ where }),
    ]);
    const n = await this.named(rows);
    return {
      items: rows.map((r) => ({
        id: r.id,
        at: r.createdAt.toISOString(),
        action: r.action,
        entityType: r.entityType,
        entityId: r.entityId,
        actor: n.actor(r.actorUserId),
        office: n.office(r.officeId),
        diff: r.diff,
        correlationId: r.correlationId,
      })),
      total,
      page: q.page,
      limit: q.limit,
    };
  }

  /** Same filters as the list, as CSV for Finance/auditors; the export itself is audited. */
  @Get('export.csv')
  async export(
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
    @Res() res: Response,
    @Query(new ZodPipe(ListAuditLogsQuery)) q: z.infer<typeof ListAuditLogsQuery>,
  ) {
    const where = await this.filter(user, q);
    const rows = await this.prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: EXPORT_LIMIT + 1,
    });
    const n = await this.named(rows);
    const lines = [
      [
        'Fecha (UTC)',
        'Oficina',
        'Usuario',
        'Correo',
        'Acción',
        'Entidad',
        'ID entidad',
        'Detalle',
        'Correlación',
      ],
      ...rows.slice(0, EXPORT_LIMIT).map((r) => {
        const a = n.actor(r.actorUserId);
        return [
          r.createdAt.toISOString(),
          n.office(r.officeId) ?? '',
          a?.name ?? 'Proceso automático',
          a?.email ?? '',
          r.action,
          r.entityType,
          r.entityId,
          r.diff == null ? '' : JSON.stringify(r.diff),
          r.correlationId ?? '',
        ];
      }),
    ];
    if (rows.length > EXPORT_LIMIT) lines.push([`Recortado a ${EXPORT_LIMIT} filas: acota las fechas.`]);
    await audit(this.prisma, {
      actorUserId: user.id,
      action: 'audit_log.exported',
      entityType: q.officeId ? 'Office' : 'AuditLog',
      entityId: q.officeId ?? 'export',
      correlationId: req.correlationId,
      diff: {
        filters: { ...q, page: undefined, limit: undefined },
        rows: Math.min(rows.length, EXPORT_LIMIT),
      },
    });
    // BOM so Excel opens accents correctly.
    res
      .type('text/csv; charset=utf-8')
      .attachment(`bitacora-${new Date().toISOString().slice(0, 10)}.csv`)
      .send('\uFEFF' + lines.map((l) => l.map(csvCell).join(',')).join('\r\n'));
  }
}
