import type { EditableRole, RoleName, RolePolicyInput } from '@ee/contracts';

export interface OfficeRole {
  officeId: string;
  role: RoleName;
}

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  roles: OfficeRole[];
  /** Loaded from role_policies on each request; missing entries fall back to DEFAULT_POLICIES. */
  policies?: Partial<Record<EditableRole, RolePolicyInput>>;
}
