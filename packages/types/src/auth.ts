import type { RoleCode, UserStatus } from './enums';

/** Claims carried in the access-token JWT (doc 07). */
export interface AccessTokenClaims {
  sub: string;
  orgId: string;
  employeeId?: string;
  roleCode: RoleCode;
  perms: string[];
  /**
   * The account still holds the shared default password. Carried in the token
   * so `PasswordChangeGuard` can refuse every route but the ones needed to
   * replace it, without a database read per request.
   *
   * Optional because tokens minted before this claim existed are still valid
   * until they expire; absent is treated as "not required to change".
   */
  mustChangePassword?: boolean;
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
  /**
   * The account still has the password it was created with. Sign-in succeeds,
   * but the app sends them to change it before anything else — a shared
   * default is only safe while it cannot stay in use.
   */
  mustChangePassword: boolean;
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
