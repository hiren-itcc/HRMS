import type { ExpenseClaimStatusCode } from '@hrms/shared';

/**
 * What may happen to a claim, and what a claim adds up to.
 *
 * Pure, like `asset.status.ts`, `settlement.calc.ts` and `application.stage.ts`
 * — no Prisma and no clock, so "may this be submitted" and "is this over its
 * cap" are answerable without a database and exhaustively testable.
 *
 * The money here is in rupees as `number`, not Decimal. Every amount reaching
 * these functions has already been through `expenses.mapper.ts`, which is where
 * Prisma's Decimal — a string on the wire — becomes a number exactly once.
 */

/** Two decimal places, and the same rounding the payroll mapper uses. */
export function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export interface RuleItem {
  categoryId: string;
  amount: number;
  receiptId?: string | null;
}

export interface RuleCategory {
  id: string;
  name: string;
  capPerClaim: number | null;
  requiresReceipt: boolean;
  active: boolean;
}

/** Only a draft is editable. Everything else has been seen by somebody. */
export function canEdit(status: ExpenseClaimStatusCode): boolean {
  return status === 'DRAFT';
}

/** A draft is submitted; a submitted claim is decided. Nothing else moves. */
export function canSubmit(status: ExpenseClaimStatusCode): boolean {
  return status === 'DRAFT';
}

export function canDecide(status: ExpenseClaimStatusCode): boolean {
  return status === 'SUBMITTED';
}

/**
 * The claimant may pull a claim back until somebody has decided it.
 *
 * Deliberately *not* a delete once submitted: an approver may already have read
 * it, and a row that vanishes from an inbox with no trace is how two people end
 * up disagreeing about whether a claim ever existed.
 */
export function canWithdraw(status: ExpenseClaimStatusCode): boolean {
  return status === 'DRAFT' || status === 'SUBMITTED';
}

export function editError(status: ExpenseClaimStatusCode): string {
  switch (status) {
    case 'SUBMITTED':
      return 'This is with an approver — withdraw it first';
    case 'APPROVED':
      return 'This was approved and is on its way to payroll';
    case 'REJECTED':
      return 'This was declined. Raise a new claim rather than editing this one';
    case 'CANCELLED':
      return 'This was withdrawn';
    default:
      return 'This claim cannot be edited';
  }
}

/** What the claim comes to. The only place a total is computed. */
export function claimTotal(items: RuleItem[]): number {
  return round2(items.reduce((sum, item) => sum + item.amount, 0));
}

/** Per category, because a cap is per category rather than per claim. */
export function totalsByCategory(items: RuleItem[]): Map<string, number> {
  const totals = new Map<string, number>();
  for (const item of items) {
    totals.set(item.categoryId, round2((totals.get(item.categoryId) ?? 0) + item.amount));
  }
  return totals;
}

export interface CapBreach {
  categoryId: string;
  categoryName: string;
  total: number;
  cap: number;
}

/**
 * Which categories the claim exceeds.
 *
 * Summed per category rather than checked line by line: a £200 cap that three
 * £100 lines walk straight through is not a cap. A category with no cap, and a
 * category not in the list at all, breach nothing — the unknown-category case
 * is caught by `unknownCategories` instead, which says something useful.
 */
export function capBreaches(items: RuleItem[], categories: RuleCategory[]): CapBreach[] {
  const byId = new Map(categories.map((category) => [category.id, category]));
  const breaches: CapBreach[] = [];
  for (const [categoryId, total] of totalsByCategory(items)) {
    const category = byId.get(categoryId);
    if (!category || category.capPerClaim === null) continue;
    if (total > category.capPerClaim) {
      breaches.push({
        categoryId,
        categoryName: category.name,
        total,
        cap: category.capPerClaim,
      });
    }
  }
  return breaches;
}

/** Lines whose category wants a receipt and has none. Returned as indexes,
 * so the caller can point at the row rather than describe it. */
export function missingReceipts(items: RuleItem[], categories: RuleCategory[]): number[] {
  const byId = new Map(categories.map((category) => [category.id, category]));
  return items.flatMap((item, index) =>
    byId.get(item.categoryId)?.requiresReceipt && !item.receiptId ? [index] : [],
  );
}

/** A category that was deactivated after the draft was written, or never existed. */
export function unknownCategories(items: RuleItem[], categories: RuleCategory[]): string[] {
  const usable = new Set(categories.filter((category) => category.active).map((c) => c.id));
  return [...new Set(items.map((item) => item.categoryId).filter((id) => !usable.has(id)))];
}

/**
 * Everything that stops a claim being submitted, in one pass.
 *
 * One call rather than three, because a claim with two problems should say so
 * once. Being told about a missing receipt, fixing it, and only then being told
 * about the cap is the sort of thing that makes people give up on a form.
 */
export function submissionProblems(
  items: RuleItem[],
  categories: RuleCategory[],
): { problems: string[]; total: number } {
  const problems: string[] = [];
  if (items.length === 0) problems.push('Add at least one line before submitting');

  for (const categoryId of unknownCategories(items, categories)) {
    problems.push(`One line uses a category that is no longer available (${categoryId})`);
  }
  for (const index of missingReceipts(items, categories)) {
    problems.push(`Line ${index + 1} needs a receipt`);
  }
  for (const breach of capBreaches(items, categories)) {
    problems.push(
      `${breach.categoryName} totals ${breach.total}, above the ${breach.cap} allowed per claim`,
    );
  }
  return { problems, total: claimTotal(items) };
}

/**
 * What an approved claim owes each payslip line.
 *
 * Grouped by the category's pay component rather than by category, because two
 * categories may pay out on one component and `PayrollAdjustment` is unique per
 * (employee, month, component) — two rows would be two payslip lines with the
 * same code and no way to tell them apart.
 */
export function payoutByComponent(
  items: RuleItem[],
  categories: { id: string; componentId: string }[],
): Map<string, number> {
  const componentOf = new Map(categories.map((category) => [category.id, category.componentId]));
  const payouts = new Map<string, number>();
  for (const item of items) {
    const componentId = componentOf.get(item.categoryId);
    if (!componentId) continue;
    payouts.set(componentId, round2((payouts.get(componentId) ?? 0) + item.amount));
  }
  return payouts;
}
