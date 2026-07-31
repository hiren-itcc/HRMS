import type { AccessTokenClaims } from '@hrms/types';

/** The slice of the JWT claims every org service method scopes by. */
export interface OrgCtx {
  orgId: string;
  userId: string;
}

export function orgCtx(claims: AccessTokenClaims): OrgCtx {
  return { orgId: claims.orgId, userId: claims.sub };
}
