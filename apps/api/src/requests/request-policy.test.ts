import { describe, expect, it } from 'vitest';
import type { AuthUser } from '../auth/auth.types.js';
import { canAssign, canCancel, canEdit, canSubmit, canView, type RequestRef } from './request-policy.js';

const A = '00000000-0000-4000-8000-00000000000a';
const B = '00000000-0000-4000-8000-00000000000b';
const u = (id: string, roles: AuthUser['roles']): AuthUser => ({
  id,
  email: `${id}@x`,
  name: id,
  agencyId: 'ag',
  agencyOfficeIds: [A, B],
  roles,
});
const advisor = u('adv', [{ officeId: A, role: 'ADVISOR' }]);
const otherAdvisor = u('adv2', [{ officeId: A, role: 'ADVISOR' }]);
const quoter = u('quo', [{ officeId: A, role: 'QUOTER' }]);
const admin = u('adm', [{ officeId: A, role: 'OFFICE_ADMIN' }]);
const foreign = u('for', [{ officeId: B, role: 'OFFICE_ADMIN' }]);
const req = (patch: Partial<RequestRef> = {}): RequestRef => ({
  officeId: A,
  requesterId: 'adv',
  assigneeId: null,
  status: 'DRAFT',
  ...patch,
});

describe('request policy', () => {
  it('drafts are private to author and office admin', () => {
    expect(canView(advisor, req())).toBe(true);
    expect(canView(admin, req())).toBe(true);
    expect(canView(otherAdvisor, req())).toBe(false);
    expect(canView(otherAdvisor, req({ status: 'SUBMITTED' }))).toBe(true);
  });

  it('other offices see nothing', () => {
    expect(canView(foreign, req({ status: 'SUBMITTED' }))).toBe(false);
    expect(canAssign(foreign, req({ status: 'SUBMITTED' }))).toBe(false);
    expect(canCancel(foreign, req({ status: 'SUBMITTED' }))).toBe(false);
  });

  it('edit rights follow role and status', () => {
    expect(canEdit(advisor, req())).toBe(true);
    expect(canEdit(otherAdvisor, req({ status: 'SUBMITTED' }))).toBe(false);
    expect(canEdit(quoter, req({ status: 'QUOTING', assigneeId: 'quo' }))).toBe(true);
    expect(canEdit(advisor, req({ status: 'SENT' }))).toBe(false);
  });

  it('transitions', () => {
    expect(canSubmit(advisor, req())).toBe(true);
    expect(canSubmit(advisor, req({ status: 'SUBMITTED' }))).toBe(false);
    expect(canAssign(admin, req({ status: 'DRAFT' }))).toBe(false);
    expect(canAssign(admin, req({ status: 'QUOTING' }))).toBe(true);
    expect(canCancel(admin, req({ status: 'WON' }))).toBe(false);
    expect(canCancel(advisor, req({ status: 'SUBMITTED' }))).toBe(false);
  });
});
