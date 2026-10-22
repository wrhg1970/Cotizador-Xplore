import type { RoleName } from '@ee/contracts';

export interface OfficeRole {
  officeId: string;
  role: RoleName;
}

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  roles: OfficeRole[];
}
