/**
 * Payroll run and payment state machines.
 *
 * Kept pure and in one file because "can this be edited?" is asked from a
 * dozen places, and the answer must never differ between them. The rules
 * here are the ones that stop a locked payroll being quietly rewritten.
 */

export type RunStatus = 'DRAFT' | 'IN_REVIEW' | 'APPROVED' | 'LOCKED' | 'PUBLISHED' | 'CANCELLED';

export type RunAction = 'calculate' | 'approve' | 'reopen' | 'lock' | 'publish' | 'cancel';

export type PaymentStatus = 'PENDING' | 'PROCESSING' | 'PAID' | 'FAILED' | 'CANCELLED';

/** Where each action may be taken from, and where it lands. */
const RUN_TRANSITIONS: Record<RunAction, { from: RunStatus[]; to: RunStatus }> = {
  // Recalculation is allowed repeatedly while the run is still under review.
  calculate: { from: ['DRAFT', 'IN_REVIEW'], to: 'IN_REVIEW' },
  approve: { from: ['IN_REVIEW'], to: 'APPROVED' },
  /*
   * Only from APPROVED. A locked or published run is never reopened — a
   * mistake there is corrected by an adjustment in the next run, which is how
   * payroll works everywhere. Allowing it would mean a payslip an employee
   * has already seen could change underneath them.
   */
  reopen: { from: ['APPROVED'], to: 'IN_REVIEW' },
  lock: { from: ['APPROVED'], to: 'LOCKED' },
  publish: { from: ['LOCKED'], to: 'PUBLISHED' },
  cancel: { from: ['DRAFT', 'IN_REVIEW', 'APPROVED'], to: 'CANCELLED' },
};

/** The permission each action demands, so the rule lives with the machine. */
export const RUN_ACTION_PERMISSION: Record<RunAction, string> = {
  calculate: 'payroll.process',
  approve: 'payroll.approve',
  // Un-approving is the approver's call, not the processor's.
  reopen: 'payroll.approve',
  lock: 'payroll.approve',
  publish: 'payroll.process',
  cancel: 'payroll.process',
};

export function canTransition(status: RunStatus, action: RunAction): boolean {
  return RUN_TRANSITIONS[action].from.includes(status);
}

export function nextStatus(status: RunStatus, action: RunAction): RunStatus | null {
  return canTransition(status, action) ? RUN_TRANSITIONS[action].to : null;
}

/** Human-readable refusal, used verbatim in the API error. */
export function transitionError(status: RunStatus, action: RunAction): string {
  if (status === 'LOCKED' || status === 'PUBLISHED') {
    return `This payroll is ${status.toLowerCase()} and can no longer be changed — correct it with an adjustment in the next run`;
  }
  if (status === 'CANCELLED') return 'This payroll was cancelled';
  const allowed = RUN_TRANSITIONS[action].from.join(' or ');
  return `Cannot ${action} a payroll that is ${status} — it must be ${allowed}`;
}

/**
 * Employees see a payslip only once the run is published. Before that the
 * numbers are still moving, and a payslip seen once cannot be unseen.
 */
export function isPayslipVisibleToEmployee(status: RunStatus): boolean {
  return status === 'PUBLISHED';
}

const PAYMENT_TRANSITIONS: Record<PaymentStatus, PaymentStatus[]> = {
  PENDING: ['PROCESSING', 'CANCELLED'],
  // A failed transfer is retried, which is why FAILED goes back to PROCESSING.
  PROCESSING: ['PAID', 'FAILED'],
  FAILED: ['PROCESSING', 'CANCELLED'],
  PAID: [],
  CANCELLED: [],
};

export function canPay(runStatus: RunStatus): boolean {
  return runStatus === 'PUBLISHED';
}

export function canTransitionPayment(from: PaymentStatus, to: PaymentStatus): boolean {
  return PAYMENT_TRANSITIONS[from].includes(to);
}

export function paymentTransitionError(from: PaymentStatus, to: PaymentStatus): string {
  if (from === 'PAID') return 'This payslip is already paid';
  if (from === 'CANCELLED') return 'This payslip was cancelled';
  return `Cannot move a ${from} payslip to ${to}`;
}
