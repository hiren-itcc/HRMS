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

/**
 * What to call an *account* that has no employee record behind it.
 *
 * The bootstrapped administrator is deliberately not a member of staff, so it
 * has no first or last name and every name slot fell back to showing the raw
 * email. This names the account by what it is instead.
 *
 * Separate from ROLE_LABEL rather than a rename of it: that map is what the
 * role picker and the employee record call the role, and "Super Admin" there
 * would change the product's vocabulary for a role that is called Admin
 * everywhere else, including in the permission matrix.
 */
export const ACCOUNT_LABEL: Record<RoleCodeInput, string> = {
  EMPLOYEE: 'Employee Account',
  MANAGER: 'Manager Account',
  HR: 'HR Account',
  FINANCE: 'Finance Account',
  ADMIN: 'Super Admin',
};
