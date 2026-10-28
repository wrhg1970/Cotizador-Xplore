import { ForbiddenException } from '@nestjs/common';
import type { PrismaClient } from '@ee/db';
import type { z } from 'zod';
import { ApprovalRules, DEFAULT_APPROVAL_RULES, OfficeGoals } from '@ee/contracts';
import { audit } from '../audit.js';
import type { AuthUser } from '../auth/auth.types.js';
import { isSystemAdmin } from '../auth/authz.js';

/** An agency's stored setting, or the default when missing or no longer valid for its schema. */
export async function getSetting<T>(
  prisma: PrismaClient,
  agencyId: string,
  key: string,
  schema: z.ZodType<T>,
  fallback: T,
): Promise<T> {
  const row = await prisma.appSetting.findUnique({ where: { agencyId_key: { agencyId, key } } });
  const parsed = schema.safeParse(row?.value);
  return parsed.success ? parsed.data : fallback;
}

/** System admins only, on their own agency; audited with the new value (settings never hold personal data). */
export function putSetting<T extends object>(
  prisma: PrismaClient,
  user: AuthUser,
  correlationId: string,
  key: string,
  value: T,
) {
  if (!isSystemAdmin(user)) throw new ForbiddenException('Solo un administrador del sistema');
  return prisma.$transaction(async (tx) => {
    await tx.appSetting.upsert({
      where: { agencyId_key: { agencyId: user.agencyId, key } },
      create: { agencyId: user.agencyId, key, value, updatedById: user.id },
      update: { value, updatedById: user.id },
    });
    await audit(tx, {
      actorUserId: user.id,
      action: `settings.${key}.updated`,
      entityType: 'AppSetting',
      entityId: key,
      correlationId,
      diff: value,
    });
    return value;
  });
}

export const APPROVAL_RULES_KEY = 'approvalRules';
export const approvalRules = (prisma: PrismaClient, agencyId: string) =>
  getSetting(prisma, agencyId, APPROVAL_RULES_KEY, ApprovalRules, DEFAULT_APPROVAL_RULES);

export const goalsKey = (year: number) => `officeGoals.${year}`;
export const officeGoals = (prisma: PrismaClient, agencyId: string, year: number) =>
  getSetting(prisma, agencyId, goalsKey(year), OfficeGoals, {});
