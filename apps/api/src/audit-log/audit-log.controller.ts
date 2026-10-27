import { Controller, ForbiddenException, Get, Inject, Query } from '@nestjs/common';
import { ListAuditLogsQuery } from '@ee/contracts';
import type { Prisma, PrismaClient } from '@ee/db';
import type { z } from 'zod';
import type { AuthUser } from '../auth/auth.types.js';
import { officesWithRole } from '../auth/authz.js';
import { CurrentUser } from '../auth/session.guard.js';
import { PRISMA } from '../prisma.service.js';
import { ZodPipe } from '../zod.pipe.js';

// Office admins and auditors read their offices' entries; global ones (logins, policies, catalog) stay with system admins.
const READERS = ['OFFICE_ADMIN', 'AUDITOR'] as const;

/** Read-only browser over the append-only audit log (SECURITY.md control 11). */
@Controller('audit-logs')
export class AuditLogController {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  @Get()
  async list(
    @CurrentUser() user: AuthUser,
    @Query(new ZodPipe(ListAuditLogsQuery)) q: z.infer<typeof ListAuditLogsQuery>,
  ) {
    const scope = officesWithRole(user, READERS);
    if (scope !== 'ALL' && scope.length === 0)
      throw new ForbiddenException('Solo coordinadores, auditores y administradores consultan la bitácora');
    if (q.officeId && scope !== 'ALL' && !scope.includes(q.officeId)) throw new ForbiddenException();

    const actor = q.actorEmail
      ? await this.prisma.user.findUnique({
          where: { email: q.actorEmail.toLowerCase() },
          select: { id: true },
        })
      : undefined;
    const where: Prisma.AuditLogWhereInput = {
      AND: [
        scope === 'ALL' ? {} : { officeId: { in: scope } },
        q.officeId ? { officeId: q.officeId } : {},
        q.action ? { action: { startsWith: q.action } } : {},
        // Unknown email: match nothing rather than ignoring the filter.
        q.actorEmail ? { actorUserId: actor?.id ?? '00000000-0000-0000-0000-000000000000' } : {},
        q.entityId ? { entityId: q.entityId } : {},
        q.from ? { createdAt: { gte: new Date(`${q.from}T00:00:00Z`) } } : {},
        q.to ? { createdAt: { lt: new Date(new Date(`${q.to}T00:00:00Z`).getTime() + 86_400_000) } } : {},
      ],
    };
    const [rows, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (q.page - 1) * q.limit,
        take: q.limit,
      }),
      this.prisma.auditLog.count({ where }),
    ]);
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
      items: rows.map((r) => ({
        id: r.id,
        at: r.createdAt.toISOString(),
        action: r.action,
        entityType: r.entityType,
        entityId: r.entityId,
        actor: users.find((u) => u.id === r.actorUserId) ?? null,
        office: offices.find((o) => o.id === r.officeId)?.code ?? null,
        diff: r.diff,
        correlationId: r.correlationId,
      })),
      total,
      page: q.page,
      limit: q.limit,
    };
  }
}
