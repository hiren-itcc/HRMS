import { RoleCode } from '@hrms/types';

/**
 * RBAC catalog — the single source of truth (docs/04-rbac.md).
 * Consumed by: the API seed (Permission rows + RolePermission grants),
 * the PermissionsGuard (compile-time-safe codes), and the web `useCan` hook.
 */
export const PERMISSIONS = [
  'employee.read.own',
  'employee.update.own',
  'employee.read.team',
  'employee.read',
  'employee.create',
  'employee.update',
  'employee.delete',
  'employee.invite',
  'employee.offboard',
  /*
   * Approving onboarding is what turns a candidate into a member of staff, so
   * it is its own code rather than folded into `employee.update`: an
   * organization that wants the person checking the ID proof to be someone
   * other than the person editing records can compose that in Settings.
   */
  'employee.onboarding.approve',
  /*
   * Confirming somebody off probation, or extending it. Separate from
   * `employee.update` for the same reason approving onboarding is: it decides
   * whether a person keeps their job, and an organization may well want that
   * held by somebody other than whoever edits phone numbers.
   *
   * There is no matching code for offboarding — `employee.offboard` already
   * exists, is already granted to exactly Admin and HR, and already means "may
   * change whether this person works here". A second code would be a synonym.
   */
  'employee.confirm',

  /*
   * Resignation is the only workflow in the product an ordinary employee
   * *starts* about themselves, which is why `request.own` exists at all —
   * everything else self-service is a read or an edit of their own record.
   *
   * The `.team` pair is what a manager holds: the scope is resolved from
   * `Employee.managerId` at query time, never from a request parameter.
   */
  'resignation.request.own',
  'resignation.read.own',
  'resignation.read.team',
  'resignation.approve.team',
  'resignation.read',
  'resignation.approve',

  /*
   * The company directory: work contact details for everyone, and nothing
   * else. Deliberately separate from `employee.read`, which opens the HR
   * record — date of birth, home address, bank details. Every role holds it.
   */
  'directory.read',

  'attendance.read.own',
  'attendance.mark.own',
  'attendance.request.own',
  'attendance.read.team',
  'attendance.approve.team',
  'attendance.read',
  'attendance.approve',
  'attendance.manage',

  'leave.read.own',
  'leave.request.own',
  'leave.read.team',
  'leave.approve.team',
  'leave.read',
  'leave.approve',
  'leave.manage',

  'document.read.own',
  'document.upload.own',
  'document.read.team',
  'document.read',
  'document.upload',
  'document.manage',

  /*
   * Letters have no `.team` scope on purpose. A document is a filing cabinet a
   * manager legitimately browses; an offer or relieving letter is a bilateral
   * instrument between the company and one person, and no manager workflow
   * needs it. Adding the scope later is one code and one branch — removing it
   * after tenants have granted it is a breaking change to their access model.
   *
   * Salary is not protected by these codes at all: it is gated on the letter's
   * own `containsSalary`, so a custom role composed in Settings cannot become
   * a second unguarded path to a CTC figure.
   */
  'letter.read.own',
  'letter.read',
  'letter.issue',
  'letter.template.manage',

  'announcement.read',
  'announcement.manage',

  'org.read',
  'org.manage',

  'report.view.team',
  'report.view',
  'report.export',

  /*
   * Payroll splits along separation-of-duties lines: HR configures and
   * processes, Finance approves and pays. Nobody holds both `payroll.process`
   * and `payroll.approve` by default, and that is the point.
   */
  'payroll.read.own',
  'payroll.read.team',
  'payroll.read',
  'payroll.structure.manage',
  'payroll.salary.manage',
  'payroll.process',
  'payroll.approve',
  'payroll.pay',

  'settings.manage',
  'role.manage',
  'audit.read',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const EMPLOYEE_PERMS: Permission[] = [
  'employee.read.own',
  'employee.update.own',
  // Everyone can look a colleague up; nobody gains their HR record by it.
  'directory.read',
  'attendance.read.own',
  'attendance.mark.own',
  'attendance.request.own',
  'leave.read.own',
  'leave.request.own',
  'document.read.own',
  'document.upload.own',
  'letter.read.own',
  'announcement.read',
  'org.read',
  'payroll.read.own',
  // Resigning is not a privilege HR grants; withholding it would only mean
  // resignations arrive by email instead.
  'resignation.request.own',
  'resignation.read.own',
];

const MANAGER_PERMS: Permission[] = [
  ...EMPLOYEE_PERMS,
  'employee.read.team',
  'attendance.read.team',
  'attendance.approve.team',
  'leave.read.team',
  'leave.approve.team',
  'document.read.team',
  'report.view.team',
  'payroll.read.team',
  'resignation.read.team',
  'resignation.approve.team',
];

const HR_PERMS: Permission[] = [
  ...MANAGER_PERMS,
  'employee.read',
  'employee.create',
  'employee.update',
  'employee.invite',
  'employee.offboard',
  'employee.onboarding.approve',
  'employee.confirm',
  'resignation.read',
  'resignation.approve',
  'attendance.read',
  'attendance.approve',
  'attendance.manage',
  'leave.read',
  'leave.approve',
  'leave.manage',
  'document.read',
  'document.upload',
  'document.manage',
  'letter.read',
  'letter.issue',
  'letter.template.manage',
  'announcement.manage',
  'org.manage',
  'report.view',
  'report.export',
  // HR configures and runs payroll but cannot approve or pay it.
  'payroll.read',
  'payroll.structure.manage',
  'payroll.salary.manage',
  'payroll.process',
];

/** Approves and pays; deliberately holds no salary or structure write. */
const FINANCE_PERMS: Permission[] = [
  // Finance is a person before it is a function: they book leave and read
  // announcements like anyone else. Omitting this left them unable to use the
  // product they work in.
  ...EMPLOYEE_PERMS,
  // Needs to see who a payslip belongs to.
  'employee.read',
  'payroll.read',
  'payroll.approve',
  'payroll.pay',
  'report.view',
  'report.export',
];

/** Default grants per system role (docs/04-rbac.md permission matrix). */
export const ROLE_PERMISSIONS: Record<RoleCode, readonly Permission[]> = {
  [RoleCode.ADMIN]: PERMISSIONS,
  [RoleCode.HR]: [...new Set(HR_PERMS)],
  [RoleCode.FINANCE]: [...new Set(FINANCE_PERMS)],
  [RoleCode.MANAGER]: [...new Set(MANAGER_PERMS)],
  [RoleCode.EMPLOYEE]: EMPLOYEE_PERMS,
};

export const SYSTEM_ROLES: { code: RoleCode; name: string; description: string }[] = [
  {
    code: RoleCode.ADMIN,
    name: 'Admin',
    description: 'Full access including settings, roles and audit',
  },
  { code: RoleCode.HR, name: 'HR', description: 'All people operations org-wide' },
  {
    code: RoleCode.FINANCE,
    name: 'Finance',
    description: 'Approves and pays payroll; cannot change salaries',
  },
  {
    code: RoleCode.MANAGER,
    name: 'Manager',
    description: 'Self service plus direct-report visibility and approvals',
  },
  { code: RoleCode.EMPLOYEE, name: 'Employee', description: 'Self service' },
];
