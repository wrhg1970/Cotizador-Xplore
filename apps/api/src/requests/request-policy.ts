import type { RequestStatus } from '@ee/contracts';
import type { AuthUser } from '../auth/auth.types.js';
import { hasOfficeRole, isSystemAdmin } from '../auth/authz.js';

export interface RequestRef {
  officeId: string;
  requesterId: string;
  assigneeId: string | null;
  status: RequestStatus;
}

const EDITABLE: readonly RequestStatus[] = ['DRAFT', 'SUBMITTED', 'QUOTING'];
const CLOSED: readonly RequestStatus[] = ['WON', 'LOST', 'CANCELLED'];

const isOfficeAdmin = (u: AuthUser, r: RequestRef) => hasOfficeRole(u, r.officeId, ['OFFICE_ADMIN']);
const isMember = (u: AuthUser, r: RequestRef) =>
  isSystemAdmin(u) || u.roles.some((x) => x.officeId === r.officeId);

/** Drafts stay private to their author and office admins (US-010). */
export const canView = (u: AuthUser, r: RequestRef): boolean =>
  isMember(u, r) && (r.status !== 'DRAFT' || r.requesterId === u.id || isOfficeAdmin(u, r));

export const canCreateIn = (u: AuthUser, officeId: string): boolean =>
  hasOfficeRole(u, officeId, ['ADVISOR', 'OFFICE_ADMIN']);

/** Edits after submission are allowed but audited with a diff (US-027). */
export const canEdit = (u: AuthUser, r: RequestRef): boolean =>
  EDITABLE.includes(r.status) &&
  isMember(u, r) &&
  (r.requesterId === u.id || r.assigneeId === u.id || isOfficeAdmin(u, r));

export const canSubmit = (u: AuthUser, r: RequestRef): boolean =>
  r.status === 'DRAFT' && (r.requesterId === u.id || isOfficeAdmin(u, r));

export const canAssign = (u: AuthUser, r: RequestRef): boolean =>
  (r.status === 'SUBMITTED' || r.status === 'QUOTING') && isOfficeAdmin(u, r);

export const canCancel = (u: AuthUser, r: RequestRef): boolean =>
  !CLOSED.includes(r.status) && isOfficeAdmin(u, r);
