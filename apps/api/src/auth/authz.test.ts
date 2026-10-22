import { describe, expect, it } from 'vitest';
import type { AuthUser } from './auth.types.js';
import { canGrantRole, hasOfficeRole, officeScope } from './authz.js';

const A = '00000000-0000-4000-8000-00000000000a';
const B = '00000000-0000-4000-8000-00000000000b';
const user = (roles: AuthUser['roles']): AuthUser => ({ id: 'u', email: 'u@x', name: 'U', roles });

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
    expect(officeScope(admin)).toBe('ALL');
  });

  it('office admin grants only non-admin roles in own office', () => {
    const oa = user([{ officeId: A, role: 'OFFICE_ADMIN' }]);
    expect(canGrantRole(oa, A, 'QUOTER')).toBe(true);
    expect(canGrantRole(oa, A, 'OFFICE_ADMIN')).toBe(false);
    expect(canGrantRole(oa, A, 'SYSTEM_ADMIN')).toBe(false);
    expect(canGrantRole(oa, B, 'QUOTER')).toBe(false);
  });
});
