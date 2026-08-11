import { RoleCode } from '@hrms/types';

/**
 * RBAC catalog — the single source of truth (docs/04-rbac.md).
 * Consumed by: the API seed (Permission rows + RolePermission grants),
 * the PermissionsGuard (compile-time-safe codes), and `can()` from the web
 * app's `useSession()`. There is no `useCan` hook, whatever this line used to
 * say — three docs claimed one and anybody who believed them wrote an import
 * that does not resolve.
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
   * Bulk import, and it is separate from `employee.create` on purpose.
   *
   * `employee.create` means "may add a person". This means "may add four
   * hundred people, resolve their reporting lines, and — with a second,
   * explicit opt-in — email all of them". That is a different blast radius, and
   * the same argument this file already makes for `employee.onboarding.approve`
   * sitting apart from `employee.update`.
   *
   * The honest counter-argument, recorded because it is a fair one: the dry-run
   * preview and the row caps are the real controls, and `employee.create` would
   * do. It is a new code anyway because removing a granted permission later is
   * a breaking change to a tenant's access model, and adding one is not.
   */
  'employee.import',

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
   * Signing off one line of somebody's exit clearance. Separate from
   * `employee.offboard` because the two are different jobs: offboard decides
   * whether and when somebody leaves, this says a laptop came back. Finance
   * and Managers hold it and hold nothing else about exits.
   *
   * Whose exit a Manager may sign off is not something the guard can answer,
   * so the service checks they are actually that employee's manager.
   */
  'offboarding.clearance',

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

  /*
   * Working from home. The `.team` pair is the entire workflow — a manager
   * agreeing their own reports' days — which is why this mirrors leave rather
   * than assets, where no manager scope existed to give.
   *
   * There is no `wfh.manage`. The weekly cap is a settings edit and the
   * per-employee allowance is an employee edit, so both are already gated by a
   * code that exists.
   */
  'wfh.read.own',
  'wfh.request.own',
  'wfh.read.team',
  'wfh.approve.team',
  'wfh.read',
  'wfh.approve',

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

  /*
   * The asset register. `assign` is separate from `manage` for the same reason
   * `offboarding.clearance` is separate from `employee.offboard`: buying and
   * retiring equipment is an admin job, handing a laptop to a new joiner is
   * not, and an organization may well want IT doing the second without being
   * able to write off the first.
   *
   * There is no `.team` scope. A manager has no workflow that needs to know
   * what their reports were issued — and the one place the question genuinely
   * arises, an exit, is already gated on `employee.offboard`.
   */
  'asset.read.own',
  'asset.read',
  'asset.manage',
  'asset.assign',

  /*
   * Expense claims. Shaped like leave and WFH — own / team / all — because it
   * is the same shape of thing: somebody asks, their manager or finance
   * agrees, and money moves.
   *
   * `expense.manage` is categories only, and it sits apart from `approve` for
   * a specific reason: a category names the payslip line a claim pays out on,
   * so holding it means choosing where company money leaves from. That is a
   * finance decision, not an approver's, and an organization may well want
   * managers approving claims without being able to invent new ones.
   *
   * There is no `expense.pay`. Whether a claim was paid is whether the payroll
   * run carrying it was published, and that is already gated by `payroll.pay`.
   */
  'expense.read.own',
  'expense.submit.own',
  'expense.read.team',
  'expense.approve.team',
  'expense.read',
  'expense.approve',
  'expense.manage',

  /*
   * Goals and review cycles. The own / team / all triad again, because it is
   * the same shape as leave, WFH and expenses: somebody writes something about
   * themselves, their manager answers it, and HR watches the whole thing.
   *
   * `performance.goal.own` sits apart from `performance.read.own` because they
   * are different windows on the same object. Goal setting closes weeks before
   * the review does, and an employee keeps reading their goals long after they
   * can no longer add one — a single code could not express that.
   *
   * Setting a goal and writing a review are separate codes at the team scope,
   * because they are separate decisions months apart: agreeing what somebody
   * will work on is a planning conversation, and marking them on it afterwards
   * is a judgement. An organization may well want a team lead doing the first
   * without the second.
   *
   * There is no `performance.approve`. A review is not approved or rejected; it
   * is written by two people, shared, and acknowledged. Nor is there a separate
   * code for rating: writing the manager half *is* rating, and splitting them
   * would describe a workflow where somebody comments without scoring, which
   * this module does not have.
   *
   * There is no `performance.review.own` either. Writing your own
   * self-assessment is not a privilege HR grants — you were put in a cycle, and
   * the API says so on the payload (`canSelfAssess`) rather than in a grant.
   *
   * There is no org-wide `performance.review.write`, which is the code you
   * reach for once you notice that somebody at the top of the chart has no
   * manager, and that a manager who leaves mid-cycle strands every review they
   * were holding. Both are real, and both are answered by reassigning the
   * reviewer under `performance.manage` instead. That keeps "your manager wrote
   * this" true, which is the one claim the module rests on — a code letting HR
   * type into the manager's box would quietly make it false.
   */
  'performance.read.own',
  'performance.goal.own',
  'performance.read.team',
  'performance.goal.team',
  'performance.review.team',
  'performance.read',
  'performance.manage',

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

  /*
   * Recruitment. `recruitment.hire` is separate from `recruitment.offer.manage`
   * for the same reason `employee.onboarding.approve` is separate from
   * `employee.update`: converting somebody into staff creates a login and a
   * payroll subject, and an organization may well want that held by someone
   * other than whoever negotiates the offer.
   *
   * Hiring also needs `employee.invite`, because it goes through the same
   * onboarding invite as every other new starter. That is stated rather than
   * implied — the service says so when it refuses.
   */
  'recruitment.read',
  'recruitment.read.team',
  'recruitment.opening.manage',
  'recruitment.candidate.manage',
  'recruitment.interview.submit',
  'recruitment.offer.manage',
  'recruitment.hire',

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
  // Asking to work from home is not a privilege HR grants; withholding it
  // would only mean the request arrives by chat instead.
  'wfh.read.own',
  'wfh.request.own',
  'document.read.own',
  'document.upload.own',
  'letter.read.own',
  // What they were issued. Read-only: the register is IT's record, and an
  // employee editing it would be the register disagreeing with itself.
  'asset.read.own',
  // Claiming back money you spent on the company's behalf is not a privilege
  // HR grants; withholding it would only mean claims arrive by email.
  'expense.read.own',
  'expense.submit.own',
  // Writing down what you are working towards, and reading what your manager
  // said about it. Neither is a privilege: an employee with no goals of their
  // own is the failure state a review cycle exists to prevent.
  'performance.read.own',
  'performance.goal.own',
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
  'wfh.read.team',
  'wfh.approve.team',
  'expense.read.team',
  'expense.approve.team',
  // The manager half of a review is the whole manager workflow here — there is
  // no step a manager takes that is not about somebody who reports to them.
  'performance.read.team',
  'performance.goal.team',
  'performance.review.team',
  'document.read.team',
  'report.view.team',
  'payroll.read.team',
  'resignation.read.team',
  'resignation.approve.team',
  // A manager signs off the handover for their own leaver, and nothing else.
  'offboarding.clearance',
  // Their own openings, and feedback on the people they interview. Not the
  // offer, and not the hire.
  'recruitment.read.team',
  'recruitment.interview.submit',
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
  // Loading a company's existing people in one go — an HR job, and one that
  // happens once. Finance and Managers have no use for it.
  'employee.import',
  'resignation.read',
  'resignation.approve',
  'offboarding.clearance',
  'attendance.read',
  'attendance.approve',
  'attendance.manage',
  'leave.read',
  'leave.approve',
  'leave.manage',
  'wfh.read',
  'wfh.approve',
  'document.read',
  'document.upload',
  'document.manage',
  'letter.read',
  'letter.issue',
  'letter.template.manage',
  'asset.read',
  'asset.manage',
  'asset.assign',
  /*
   * HR sees every claim and approves none of them. Reading is what makes an
   * exit or a dispute answerable; approving is Finance's, for the same reason
   * HR runs payroll and cannot pay it.
   */
  'expense.read',
  /*
   * HR opens and closes cycles, reads every review, and writes none of them.
   * The manager half belongs to the manager — an HR team that could type into
   * it would make "your manager said this" untrue, which is the one claim the
   * whole module rests on. Where there is no manager to write it, `manage`
   * reassigns the reviewer rather than standing in for one.
   */
  'performance.read',
  'performance.manage',
  'announcement.manage',
  'org.manage',
  'report.view',
  'report.export',
  // HR configures and runs payroll but cannot approve or pay it.
  'payroll.read',
  'payroll.structure.manage',
  'payroll.salary.manage',
  'payroll.process',
  // HR runs hiring end to end, and already holds `employee.invite` — which is
  // what a hire actually spends when it creates the new starter's login.
  'recruitment.read',
  'recruitment.opening.manage',
  'recruitment.candidate.manage',
  'recruitment.interview.submit',
  'recruitment.offer.manage',
  'recruitment.hire',
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
  // Finance clears outstanding dues on the way out.
  'offboarding.clearance',
  /*
   * Expenses across the organization, and the categories behind them. Finance
   * rather than HR because a category names the payslip line a claim pays out
   * on — deciding where money leaves from is their job, not a people one.
   */
  'expense.read',
  'expense.approve',
  'expense.manage',
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
