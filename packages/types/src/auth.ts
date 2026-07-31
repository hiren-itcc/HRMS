import type { RoleCode, UserStatus } from './enums';

/** Claims carried in the access-token JWT (doc 07). */
export interface AccessTokenClaims {
  sub: string;
  orgId: string;
  employeeId?: string;
  roleCode: RoleCode;
  perms: string[];
}

/** Shape returned by POST /auth/login and POST /auth/refresh. */
export interface AuthResponse {
  accessToken: string;
  user: SessionUser;
}

/** Shape returned by GET /auth/me and POST /auth/login. */
export interface SessionUser {
  id: string;
  email: string;
  status: UserStatus;
  roleCode: RoleCode;
  permissions: string[];
  employee?: {
    id: string;
    firstName: string;
    lastName: string;
    avatarUrl?: string | null;
    designation?: string | null;
  } | null;
}
