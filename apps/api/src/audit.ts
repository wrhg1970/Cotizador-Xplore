import type { Prisma } from '@ee/db';

type Tx = Pick<Prisma.TransactionClient, 'auditLog'>;

export interface AuditEntry {
  actorUserId: string | null;
  action: string;
  entityType: string;
  entityId: string;
  correlationId: string;
  /** Only for entities the DB trigger can't map to an office (it fills TravelRequest, QuoteVersion…). */
  officeId?: string;
  /** Redacted: never tokens, secrets or full personal payloads. */
  diff?: Prisma.InputJsonValue;
}

export const audit = (tx: Tx, entry: AuditEntry) => tx.auditLog.create({ data: entry });
