import type { EditableRole, RoleName, RolePolicyInput } from '@ee/contracts';
import type { AuthUser, OfficeRole } from './auth.types.js';

/** Same values the role_policies migration seeds: the fixed rules from before Sprint C. */
const base = { allOffices: false, canView: true, approvalLimitMxn: null };
const internal = { viewInternalCosts: true, exportInternalXlsx: true };
export const DEFAULT_POLICIES: Record<EditableRole, RolePolicyInput> = {
  ADVISOR: {
    ...base,
    canCreate: true,
    canEdit: true,
    canDelete: false,
    viewInternalCosts: false,
    exportInternalXlsx: false,
  },
  QUOTER: { ...base, ...internal, canCreate: false, canEdit: true, canDelete: false },
  APPROVER: { ...base, ...internal, canCreate: false, canEdit: false, canDelete: false },
  OFFICE_ADMIN: { ...base, ...internal, canCreate: true, canEdit: true, canDelete: true },
  AUDITOR: { ...base, ...internal, canCreate: false, canEdit: false, canDelete: false },
};

/** SYSTEM_ADMIN covers its whole agency (PRD F-01); every other role is scoped to its office. */
export const isSystemAdmin = (user: AuthUser): boolean => user.roles.some((r) => r.role === 'SYSTEM_ADMIN');

const policy = (user: AuthUser, role: EditableRole): RolePolicyInput =>
  user.policies?.[role] ?? DEFAULT_POLICIES[role];

type Grant = OfficeRole & { role: EditableRole };
const grants = (user: AuthUser): Grant[] => user.roles.filter((r): r is Grant => r.role !== 'SYSTEM_ADMIN');

/** Offices of another agency never match, whatever the role (tenant isolation). */
const inAgency = (user: AuthUser, officeId: string) => user.agencyOfficeIds.includes(officeId);

/** Grants of the user that act in this office: granted there, or national by policy. */
const grantsIn = (user: AuthUser, officeId: string): Grant[] =>
  inAgency(user, officeId)
    ? grants(user).filter((r) => r.officeId === officeId || policy(user, r.role).allOffices)
    : [];

const adminIn = (user: AuthUser, officeId: string) => isSystemAdmin(user) && inAgency(user, officeId);

export const hasOfficeRole = (user: AuthUser, officeId: string, roles: readonly RoleName[]): boolean =>
  adminIn(user, officeId) || grantsIn(user, officeId).some((r) => roles.includes(r.role));

/** System admin, or one of the roles is national by policy: acts on the whole agency. */
export const agencyWide = (user: AuthUser, roles: readonly RoleName[]): boolean =>
  isSystemAdmin(user) || grants(user).some((r) => roles.includes(r.role) && policy(user, r.role).allOffices);

/** Office ids of the user's agency where they hold one of the roles. */
export const officesWithRole = (user: AuthUser, roles: readonly RoleName[]): string[] => {
  if (agencyWide(user, roles)) return user.agencyOfficeIds;
  const held = grants(user).filter((r) => roles.includes(r.role) && inAgency(user, r.officeId));
  return [...new Set(held.map((r) => r.officeId))];
};

const viewRoles = (user: AuthUser): RoleName[] =>
  grants(user)
    .filter((r) => policy(user, r.role).canView)
    .map((r) => r.role);

/** Office ids the user may read ("Ver"), always inside their agency. Repositories must filter by this (IDOR/BOLA). */
export const officeScope = (user: AuthUser): string[] => officesWithRole(user, viewRoles(user));

/** Office ids whose internal figures (costs, margin) the user may export. */
export const exportScope = (user: AuthUser): string[] =>
  officesWithRole(
    user,
    grants(user)
      .filter((r) => policy(user, r.role).exportInternalXlsx)
      .map((r) => r.role),
  );

export type CrudAction = 'canCreate' | 'canEdit' | 'canDelete';

/** "Crear" / "Editar" / "Borrar" from the role matrix; workflow rules (who quotes, who approves) still apply on top. */
export const canDo = (user: AuthUser, officeId: string, action: CrudAction): boolean =>
  adminIn(user, officeId) ||
  grantsIn(user, officeId).some((r) => policy(user, r.role).canView && policy(user, r.role)[action]);

/** Internal costs, margins and commissions (PRD §PDF); configurable per role. */
export const canSeeInternalCosts = (user: AuthUser, officeId: string): boolean =>
  adminIn(user, officeId) || grantsIn(user, officeId).some((r) => policy(user, r.role).viewInternalCosts);

/** Agency internal catalogs (suppliers, their rates): anyone who sees internal costs in some office. */
export const seesAnyInternalCosts = (user: AuthUser): boolean =>
  isSystemAdmin(user) || grants(user).some((r) => policy(user, r.role).viewInternalCosts);

export const canExportInternalXlsx = (user: AuthUser, officeId: string): boolean =>
  adminIn(user, officeId) || grantsIn(user, officeId).some((r) => policy(user, r.role).exportInternalXlsx);

/** Highest group price in MXN the user may approve; null = no limit. */
export const approvalLimitMxn = (user: AuthUser): string | null =>
  isSystemAdmin(user) ? null : policy(user, 'APPROVER').approvalLimitMxn;

/** Roles an OFFICE_ADMIN may grant inside their own office; admin roles need a SYSTEM_ADMIN. */
const OFFICE_GRANTABLE: readonly RoleName[] = ['ADVISOR', 'QUOTER', 'APPROVER', 'AUDITOR'];

export const canGrantRole = (user: AuthUser, officeId: string, role: RoleName): boolean =>
  adminIn(user, officeId) ||
  (OFFICE_GRANTABLE.includes(role) && hasOfficeRole(user, officeId, ['OFFICE_ADMIN']));

/** role_policies row → contract shape; amounts travel as strings to keep decimals exact. */
export const toPolicy = (p: {
  allOffices: boolean;
  canView: boolean;
  canCreate: boolean;
  canEdit: boolean;
  canDelete: boolean;
  viewInternalCosts: boolean;
  exportInternalXlsx: boolean;
  approvalLimitMxn: { toFixed(dp: number): string } | null;
}): RolePolicyInput => ({
  allOffices: p.allOffices,
  canView: p.canView,
  canCreate: p.canCreate,
  canEdit: p.canEdit,
  canDelete: p.canDelete,
  viewInternalCosts: p.viewInternalCosts,
  exportInternalXlsx: p.exportInternalXlsx,
  approvalLimitMxn: p.approvalLimitMxn?.toFixed(2) ?? null,
});
