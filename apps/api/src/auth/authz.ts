import type { RoleName } from '@ee/contracts';
import type { AuthUser } from './auth.types.js';

/** SYSTEM_ADMIN in any office is global (PRD F-01); every other role is scoped to its office. */
export const isSystemAdmin = (user: AuthUser): boolean => user.roles.some((r) => r.role === 'SYSTEM_ADMIN');

export const hasOfficeRole = (user: AuthUser, officeId: string, roles: readonly RoleName[]): boolean =>
  isSystemAdmin(user) || user.roles.some((r) => r.officeId === officeId && roles.includes(r.role));

/** Office ids the user may read, or 'ALL'. Repositories must filter by this (IDOR/BOLA). */
export const officeScope = (user: AuthUser): string[] | 'ALL' =>
  isSystemAdmin(user) ? 'ALL' : [...new Set(user.roles.map((r) => r.officeId))];

/** Roles an OFFICE_ADMIN may grant inside their own office; admin roles need a SYSTEM_ADMIN. */
const OFFICE_GRANTABLE: readonly RoleName[] = ['ADVISOR', 'QUOTER', 'APPROVER', 'AUDITOR'];

export const canGrantRole = (user: AuthUser, officeId: string, role: RoleName): boolean =>
  isSystemAdmin(user) || (OFFICE_GRANTABLE.includes(role) && hasOfficeRole(user, officeId, ['OFFICE_ADMIN']));
