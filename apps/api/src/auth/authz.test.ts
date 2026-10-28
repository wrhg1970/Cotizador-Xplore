import { describe, expect, it } from 'vitest';
import type { AuthUser } from './auth.types.js';
import {
  approvalLimitMxn,
  canExportInternalXlsx,
  canGrantRole,
  canSeeInternalCosts,
  DEFAULT_POLICIES,
  hasOfficeRole,
  officeScope,
  officesWithRole,
} from './authz.js';

const A = '00000000-0000-4000-8000-00000000000a';
const B = '00000000-0000-4000-8000-00000000000b';
const C = '00000000-0000-4000-8000-00000000000c'; // office of another agency
const user = (roles: AuthUser['roles']): AuthUser => ({
  id: 'u',
  email: 'u@x',
  name: 'U',
  agencyId: 'ag',
  agencyOfficeIds: [A, B],
  roles,
});

describe('authz', () => {
  it('scopes office roles to their office', () => {
    const quoter = user([{ officeId: A, role: 'QUOTER' }]);
    expect(hasOfficeRole(quoter, A, ['QUOTER'])).toBe(true);
    expect(hasOfficeRole(quoter, B, ['QUOTER'])).toBe(false);
    expect(hasOfficeRole(quoter, A, ['APPROVER'])).toBe(false);
    expect(officeScope(quoter)).toEqual([A]);
  });

  it('system admin is global', () => {
    const admin = user([{ officeId: A, role: 'SYSTEM_ADMIN' }]);
    expect(hasOfficeRole(admin, B, ['APPROVER'])).toBe(true);
    expect(officeScope(admin)).toEqual([A, B]);
  });

  it('never reaches an office of another agency, whatever the role or policy', () => {
    const admin = user([{ officeId: A, role: 'SYSTEM_ADMIN' }]);
    const national = {
      ...user([{ officeId: A, role: 'AUDITOR' }]),
      policies: { ...DEFAULT_POLICIES, AUDITOR: { ...DEFAULT_POLICIES.AUDITOR, allOffices: true } },
    };
    for (const u of [admin, national]) {
      expect(hasOfficeRole(u, C, ['AUDITOR', 'OFFICE_ADMIN'])).toBe(false);
      expect(canSeeInternalCosts(u, C)).toBe(false);
      expect(canExportInternalXlsx(u, C)).toBe(false);
      expect(officeScope(u)).not.toContain(C);
    }
    expect(canGrantRole(admin, C, 'QUOTER')).toBe(false);
  });

  it('office admin grants only non-admin roles in own office', () => {
    const oa = user([{ officeId: A, role: 'OFFICE_ADMIN' }]);
    expect(canGrantRole(oa, A, 'QUOTER')).toBe(true);
    expect(canGrantRole(oa, A, 'OFFICE_ADMIN')).toBe(false);
    expect(canGrantRole(oa, A, 'SYSTEM_ADMIN')).toBe(false);
    expect(canGrantRole(oa, B, 'QUOTER')).toBe(false);
  });

  it('defaults keep internal costs on the quoting side of the office', () => {
    const advisor = user([{ officeId: A, role: 'ADVISOR' }]);
    const auditor = user([{ officeId: A, role: 'AUDITOR' }]);
    expect(canSeeInternalCosts(advisor, A)).toBe(false);
    expect(canSeeInternalCosts(auditor, A)).toBe(true);
    expect(canSeeInternalCosts(auditor, B)).toBe(false);
    expect(canExportInternalXlsx(auditor, A)).toBe(true);
    expect(approvalLimitMxn(user([{ officeId: A, role: 'APPROVER' }]))).toBeNull();
  });

  it('applies configured policies: national roles, costs, Excel and approval limit', () => {
    const policies = {
      ...DEFAULT_POLICIES,
      AUDITOR: { ...DEFAULT_POLICIES.AUDITOR, allOffices: true, exportInternalXlsx: false },
      ADVISOR: { ...DEFAULT_POLICIES.ADVISOR, viewInternalCosts: true },
      APPROVER: { ...DEFAULT_POLICIES.APPROVER, approvalLimitMxn: '500000.00' },
    };
    const auditor = { ...user([{ officeId: A, role: 'AUDITOR' }]), policies };
    expect(officeScope(auditor)).toEqual([A, B]);
    expect(hasOfficeRole(auditor, B, ['AUDITOR'])).toBe(true);
    expect(hasOfficeRole(auditor, B, ['QUOTER'])).toBe(false);
    expect(canSeeInternalCosts(auditor, B)).toBe(true);
    expect(canExportInternalXlsx(auditor, B)).toBe(false);

    // A national auditor who is also a local quoter quotes only in their own office.
    const mixed = {
      ...user([
        { officeId: A, role: 'QUOTER' },
        { officeId: A, role: 'AUDITOR' },
      ]),
      policies,
    };
    expect(officesWithRole(mixed, ['QUOTER'])).toEqual([A]);

    expect(canSeeInternalCosts({ ...user([{ officeId: A, role: 'ADVISOR' }]), policies }, A)).toBe(true);
    expect(approvalLimitMxn({ ...user([{ officeId: A, role: 'APPROVER' }]), policies })).toBe('500000.00');
    expect(approvalLimitMxn({ ...user([{ officeId: A, role: 'SYSTEM_ADMIN' }]), policies })).toBeNull();
  });
});
