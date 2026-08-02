import type { Permission } from '@hrms/shared';

/**
 * Pure guardrails for the roles editor — no Prisma, no I/O.
 *
 * `isSystem` has been seeded true since foundation and read nowhere. These
 * are the rules docs/04 describes but the code never enforced.
 */

/**
 * Without someone holding these, nobody can reach Settings or the roles
 * editor again and recovery needs database access. They are the floor
 * referred to in docs/04 §RBAC.
 */
export const ADMIN_FLOOR: Permission[] = ['settings.manage', 'role.manage'];

export interface RoleLike {
  code: string;
  isSystem: boolean;
}

/** A role as the lockout check sees it: its grants and how many people hold it. */
export interface RoleGrants {
  id: string;
  code: string;
  userCount: number;
  permissions: string[];
}

export type GuardrailReason = string | null;

/** System roles are structural: renaming or deleting them breaks the seed. */
export function editBlockedReason(role: RoleLike): GuardrailReason {
  return role.isSystem ? 'System roles cannot be renamed or deleted' : null;
}

/**
 * Would this edit leave nobody able to administer the workspace?
 *
 * Keyed on **users**, not on the ADMIN code. Pinning the floor to `ADMIN`
 * missed every real lockout: an org whose only `role.manage` holder sits on
 * HR or a custom role, or one where ADMIN exists with nobody in it. Checking
 * "does at least one person still hold this" covers all of them.
 */
export function lockoutReason(
  roles: RoleGrants[],
  editedRoleId: string,
  next: string[],
): GuardrailReason {
  const after = roles.map((role) =>
    role.id === editedRoleId ? { ...role, permissions: next } : role,
  );

  for (const permission of ADMIN_FLOOR) {
    const stillHeld = after.some(
      (role) => role.userCount > 0 && role.permissions.includes(permission),
    );
    if (!stillHeld) {
      return `At least one person must keep "${permission}" — this change would lock everyone out of settings`;
    }
  }
  return null;
}

/**
 * Would moving one person from `fromRoleId` to `toRoleId` leave nobody able to
 * administer the workspace?
 *
 * Same floor as `lockoutReason` and the same reasoning, but the other variable:
 * that function changes a role's *permissions* while its membership holds
 * still, this one changes *membership* while the permissions hold still.
 * Demoting the last admin is the obvious case, but keying on the ADMIN code
 * would miss the ones that actually bite — the sole `role.manage` holder
 * sitting on HR or a custom role. Counting people per permission covers both.
 */
export function roleMoveLockoutReason(
  roles: RoleGrants[],
  fromRoleId: string,
  toRoleId: string,
): GuardrailReason {
  if (fromRoleId === toRoleId) return null;

  const after = roles.map((role) => {
    if (role.id === fromRoleId) return { ...role, userCount: role.userCount - 1 };
    if (role.id === toRoleId) return { ...role, userCount: role.userCount + 1 };
    return role;
  });

  for (const permission of ADMIN_FLOOR) {
    const stillHeld = after.some(
      (role) => role.userCount > 0 && role.permissions.includes(permission),
    );
    if (!stillHeld) {
      return `At least one person must keep "${permission}" — this change would lock everyone out of settings`;
    }
  }
  return null;
}

/**
 * The grants to persist, and what the guardrails refused.
 *
 * A refused edit keeps the protected permissions rather than erroring, so a
 * partially-invalid submission still applies the rest — but the caller is
 * told which, so nothing is silently ignored.
 */
export function applyGuardrails(
  roles: RoleGrants[],
  editedRoleId: string,
  next: string[],
): { permissions: string[]; blocked: string[] } {
  const current = roles.find((r) => r.id === editedRoleId)?.permissions ?? [];
  const wanted = new Set(next);
  const blocked: string[] = [];

  // Only floor permissions are ever restored. Walking `current` instead would
  // blame whichever permission happened to come first — with the catalog in
  // its natural order that meant an edit stripping everything reported all 40
  // as blocked, rather than the two that actually matter.
  for (const permission of ADMIN_FLOOR) {
    if (!current.includes(permission) || wanted.has(permission)) continue;
    // Re-checked each time: restoring the first may already clear the second.
    if (lockoutReason(roles, editedRoleId, [...wanted]) === null) continue;
    wanted.add(permission);
    blocked.push(permission);
  }
  return { permissions: [...wanted].sort(), blocked };
}
