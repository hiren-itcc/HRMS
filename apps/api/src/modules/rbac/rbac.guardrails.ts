import type { Permission } from '@hrms/shared';

/**
 * Pure guardrails for the roles editor — no Prisma, no I/O.
 *
 * `isSystem` has been seeded true since foundation and read nowhere. These
 * are the rules docs/04 describes but the code never enforced.
 */

/**
 * Without these an administrator can lock every human out of the workspace
 * with one checkbox, and no remaining account could undo it. They are the
 * floor referred to in docs/04 §RBAC.
 */
export const ADMIN_FLOOR: Permission[] = ['settings.manage', 'role.manage'];

export interface RoleLike {
  code: string;
  isSystem: boolean;
}

export type GuardrailReason = string | null;

/**
 * Why this permission cannot be revoked from this role, or null if it can.
 * Returning the reason rather than a boolean lets the API say what is wrong
 * and the UI show it in a tooltip, from one definition.
 */
export function revokeBlockedReason(role: RoleLike, permission: string): GuardrailReason {
  if (role.code === 'ADMIN' && ADMIN_FLOOR.includes(permission as Permission)) {
    return 'Admin must keep this permission — removing it would lock everyone out of settings';
  }
  return null;
}

export function canRevoke(role: RoleLike, permission: string): boolean {
  return revokeBlockedReason(role, permission) === null;
}

/** System roles are structural: renaming or deleting them breaks the seed. */
export function editBlockedReason(role: RoleLike): GuardrailReason {
  return role.isSystem ? 'System roles cannot be renamed or deleted' : null;
}

/**
 * The grants that would survive applying `next` to `role`, with anything the
 * guardrails protect added back. Callers get a valid set rather than an error
 * on a partially-invalid submission.
 */
export function applyGuardrails(
  role: RoleLike,
  current: string[],
  next: string[],
): { permissions: string[]; blocked: string[] } {
  const wanted = new Set(next);
  const blocked = current.filter((code) => !wanted.has(code) && !canRevoke(role, code));
  for (const code of blocked) wanted.add(code);
  return { permissions: [...wanted].sort(), blocked };
}
