import type { SettlementStatusCode } from '@hrms/shared';

/**
 * Who may move a settlement where. Pure, like `payroll.workflow.ts` — the
 * question "can this be approved" should be answerable without a database.
 *
 * Separation of duties is the whole point of the shape: HR prepares
 * (`payroll.process`), Finance approves and releases (`payroll.approve`,
 * `payroll.pay`). It mirrors the payroll run exactly, and reuses those
 * permissions rather than minting settlement-specific ones — the people who
 * hold them are already the right people.
 */

const TRANSITIONS: Record<SettlementStatusCode, SettlementStatusCode[]> = {
  // Cancelled from DRAFT too: an exit called off before Finance ever saw the
  // figures still leaves a record behind, and deleting it would erase the fact
  // that a settlement was once prepared.
  DRAFT: ['APPROVED', 'CANCELLED'],
  APPROVED: ['PAID', 'CANCELLED'],
  // Terminal. Money that has left the account cannot be un-sent by an edit;
  // a mistaken payment is corrected by a second settlement, not by rewriting
  // the first.
  PAID: [],
  CANCELLED: [],
};

export function canTransition(from: SettlementStatusCode, to: SettlementStatusCode): boolean {
  return TRANSITIONS[from].includes(to);
}

export function transitionError(from: SettlementStatusCode, to: SettlementStatusCode): string {
  if (from === 'PAID') return 'This settlement has already been paid';
  if (from === 'CANCELLED') return 'This settlement was cancelled';
  if (to === 'PAID' && from === 'DRAFT') return 'Approve the settlement before paying it';
  return `Cannot move a ${from.toLowerCase()} settlement to ${to.toLowerCase()}`;
}

/**
 * Figures can only be touched while the settlement is a draft.
 *
 * The same bargain `payroll-runs.calculate()` makes. Once Finance has approved
 * an amount, that amount is what they approved — editing it afterwards would
 * mean the approval on record was given to a number nobody can now see.
 */
export function canEditLines(status: SettlementStatusCode): boolean {
  return status === 'DRAFT';
}

export function editError(status: SettlementStatusCode): string {
  return status === 'CANCELLED'
    ? 'This settlement was cancelled'
    : `A ${status.toLowerCase()} settlement can no longer be changed`;
}
