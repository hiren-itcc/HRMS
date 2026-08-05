/**
 * The resignation state machine.
 *
 * Pure and in one file for the same reason `payroll.workflow.ts` is: "can this
 * be approved?" gets asked from the service, the controller's permission
 * decision and the UI, and the answer must never differ between them.
 *
 * Most of the validations the brief asks for are this table rather than an
 * `if` somewhere — "cannot approve twice" is `hr_approve` having no `APPROVED`
 * in its `from`, and "cannot withdraw after approval" is `withdraw` not having
 * it either. A rule expressed as data cannot be forgotten at one call site.
 */

import type { ResignationStatusCode } from '@hrms/shared';

export type ResignationAction =
  | 'withdraw'
  | 'manager_approve'
  | 'manager_reject'
  | 'request_changes'
  | 'resubmit'
  | 'hr_approve'
  | 'hr_reject'
  | 'complete'
  | 'reopen';

const TRANSITIONS: Record<
  ResignationAction,
  { from: ResignationStatusCode[]; to: ResignationStatusCode }
> = {
  /*
   * Only while it is still with a reviewer. Once HR has approved, the exit is
   * scheduled, the employee is ON_NOTICE and an offboarding exists — undoing
   * that is cancelling the offboarding, which is HR's call and not the
   * employee's.
   */
  withdraw: {
    from: ['SUBMITTED', 'MANAGER_APPROVED', 'CHANGES_REQUESTED'],
    to: 'WITHDRAWN',
  },
  manager_approve: { from: ['SUBMITTED'], to: 'MANAGER_APPROVED' },
  manager_reject: { from: ['SUBMITTED'], to: 'REJECTED' },
  request_changes: { from: ['SUBMITTED', 'MANAGER_APPROVED'], to: 'CHANGES_REQUESTED' },
  resubmit: { from: ['CHANGES_REQUESTED'], to: 'SUBMITTED' },
  /*
   * SUBMITTED as well as MANAGER_APPROVED, so HR can act directly when the
   * organization runs no manager step, or when the employee has no reporting
   * manager — whoever is at the top of the chart has nobody to review them and
   * would otherwise sit at SUBMITTED forever.
   */
  hr_approve: { from: ['MANAGER_APPROVED', 'SUBMITTED'], to: 'APPROVED' },
  hr_reject: { from: ['MANAGER_APPROVED', 'SUBMITTED'], to: 'REJECTED' },
  /** Stamped when the offboarding completes, not by a person. */
  complete: { from: ['APPROVED'], to: 'COMPLETED' },
  /** The offboarding was cancelled: the resignation goes back to HR's desk. */
  reopen: { from: ['APPROVED'], to: 'MANAGER_APPROVED' },
};

/** The permission each action demands, so the rule lives with the machine. */
export const RESIGNATION_ACTION_PERMISSION: Record<ResignationAction, string> = {
  withdraw: 'resignation.request.own',
  manager_approve: 'resignation.approve.team',
  manager_reject: 'resignation.approve.team',
  // HR sends back as well as managers do, so this is the weaker of the two and
  // the service checks the caller is actually in the chain.
  request_changes: 'resignation.approve.team',
  resubmit: 'resignation.request.own',
  hr_approve: 'resignation.approve',
  hr_reject: 'resignation.approve',
  complete: 'employee.offboard',
  reopen: 'employee.offboard',
};

export function canTransition(status: ResignationStatusCode, action: ResignationAction): boolean {
  return TRANSITIONS[action].from.includes(status);
}

export function nextStatus(
  status: ResignationStatusCode,
  action: ResignationAction,
): ResignationStatusCode | null {
  return canTransition(status, action) ? TRANSITIONS[action].to : null;
}

/** Human-readable refusal, used verbatim in the API error. */
export function transitionError(status: ResignationStatusCode, action: ResignationAction): string {
  if (status === 'WITHDRAWN') return 'This resignation was withdrawn';
  if (status === 'REJECTED') return 'This resignation was rejected';
  if (status === 'COMPLETED') return 'This resignation is already complete';
  if (status === 'APPROVED' && action === 'withdraw') {
    return 'This resignation has already been approved — ask HR to cancel the offboarding instead';
  }
  if (status === 'APPROVED') {
    return 'This resignation is already approved and the offboarding has started';
  }
  const allowed = TRANSITIONS[action].from.join(' or ');
  return `Cannot do that while the resignation is ${status} — it must be ${allowed}`;
}

/** Is the employee still allowed to edit or withdraw their own request? */
export function isWithEmployee(status: ResignationStatusCode): boolean {
  return status === 'SUBMITTED' || status === 'CHANGES_REQUESTED';
}

/**
 * Which of the two review desks it is sitting on, if either.
 *
 * A submitted request with no routed manager is at HR's desk, not nobody's.
 * That is the case for whoever sits at the top of the org chart, and for every
 * request when the organization has turned the manager step off — without this
 * they would sit at SUBMITTED forever with no desk able to act.
 */
export function awaitingDesk(
  status: ResignationStatusCode,
  routedManagerId: string | null,
): 'MANAGER' | 'HR' | null {
  if (status === 'SUBMITTED') return routedManagerId ? 'MANAGER' : 'HR';
  if (status === 'MANAGER_APPROVED') return 'HR';
  return null;
}
