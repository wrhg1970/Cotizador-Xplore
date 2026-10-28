import type { EditableRole, RoleName, RolePolicyInput } from '@ee/contracts';

export interface OfficeRole {
  officeId: string;
  role: RoleName;
}

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  /** Tenant boundary: every query is limited to this agency's offices and catalogs. */
  agencyId: string;
  /** Every office of the agency, inactive ones too; what "all offices" means for admins and national roles. */
  agencyOfficeIds: string[];
  roles: OfficeRole[];
  /** Loaded from role_policies on each request; missing entries fall back to DEFAULT_POLICIES. */
  policies?: Partial<Record<EditableRole, RolePolicyInput>>;
  /** The system admin actually signed in while viewing the app as this user; writes are refused. */
  simulatedBy?: { id: string; name: string; email: string };
}
