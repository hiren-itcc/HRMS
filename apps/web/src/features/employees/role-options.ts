import type { RoleCodeInput } from '@hrms/shared';

/**
 * The five system roles as a person picks them (docs/04-rbac.md).
 *
 * Shared by the create form and the change-role dialog: two copies of this list
 * is how one of them ends up offering a role the other doesn't.
 */
export const ROLE_OPTIONS: { value: RoleCodeInput; label: string }[] = [
  { value: 'EMPLOYEE', label: 'Employee — self service' },
  { value: 'MANAGER', label: 'Manager — plus direct reports' },
  { value: 'HR', label: 'HR — all people operations' },
  { value: 'FINANCE', label: 'Finance — approves and pays payroll' },
  { value: 'ADMIN', label: 'Admin — everything' },
];

/** Short form for badges and summaries, where the explanation doesn't fit. */
export const ROLE_LABEL: Record<RoleCodeInput, string> = {
  EMPLOYEE: 'Employee',
  MANAGER: 'Manager',
  HR: 'HR',
  FINANCE: 'Finance',
  ADMIN: 'Admin',
};
