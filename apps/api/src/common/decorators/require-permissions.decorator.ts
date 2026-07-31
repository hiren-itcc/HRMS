import type { Permission } from '@hrms/shared';
import { SetMetadata } from '@nestjs/common';

export const PERMISSIONS_KEY = 'requiredPermissions';

/**
 * Declares the permissions a route needs. Any-of semantics:
 * `@RequirePermissions('leave.approve.team', 'leave.approve')` passes if the
 * caller holds either (docs/04-rbac.md §enforcement).
 */
export const RequirePermissions = (...permissions: Permission[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);
