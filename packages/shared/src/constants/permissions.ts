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
  'announcement.read',
  'org.read',
  'payroll.read.own',
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
];

const HR_PERMS: Permission[] = [
  ...MANAGER_PERMS,
  'employee.read',
  'employee.create',
  'employee.update',
  'employee.invite',
  'employee.offboard',
  'attendance.read',
  'attendance.approve',
  'attendance.manage',
  'leave.read',
  'leave.approve',
  'leave.manage',
  'document.read',
  'document.upload',
  'document.manage',
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
