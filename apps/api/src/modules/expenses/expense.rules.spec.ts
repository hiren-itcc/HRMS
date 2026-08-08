import {
  canDecide,
  canEdit,
  canSubmit,
  canWithdraw,
  capBreaches,
  claimTotal,
  missingReceipts,
  payoutByComponent,
  type RuleCategory,
  submissionProblems,
  unknownCategories,
} from './expense.rules';

const TRAVEL: RuleCategory = {
  id: 'c-travel',
  name: 'Travel',
  capPerClaim: 5000,
  requiresReceipt: true,
  active: true,
};
const MEALS: RuleCategory = {
  id: 'c-meals',
  name: 'Meals',
  capPerClaim: null,
  requiresReceipt: false,
  active: true,
};
const CATEGORIES = [TRAVEL, MEALS];

const line = (categoryId: string, amount: number, receiptId: string | null = 'doc1') => ({
  categoryId,
  amount,
  receiptId,
});

describe('what may happen to a claim', () => {
  it('lets only a draft be edited or submitted', () => {
    expect(canEdit('DRAFT')).toBe(true);
    expect(canSubmit('DRAFT')).toBe(true);
    for (const status of ['SUBMITTED', 'APPROVED', 'REJECTED', 'CANCELLED'] as const) {
      expect(canEdit(status)).toBe(false);
      expect(canSubmit(status)).toBe(false);
    }
  });

  it('lets only a submitted claim be decided', () => {
    expect(canDecide('SUBMITTED')).toBe(true);
    for (const status of ['DRAFT', 'APPROVED', 'REJECTED', 'CANCELLED'] as const) {
      expect(canDecide(status)).toBe(false);
    }
  });

  /*
   * Withdrawing is allowed while it is still with an approver, and is not the
   * same as deleting: an approver may already have read it, and a row that
   * vanishes from an inbox is how two people end up disagreeing about whether
   * a claim ever existed.
   */
  it('lets a claim be withdrawn until somebody decides it', () => {
    expect(canWithdraw('DRAFT')).toBe(true);
    expect(canWithdraw('SUBMITTED')).toBe(true);
    expect(canWithdraw('APPROVED')).toBe(false);
    expect(canWithdraw('REJECTED')).toBe(false);
  });
});

describe('what a claim comes to', () => {
  it('adds the lines up', () => {
    expect(claimTotal([line('c-travel', 1200.5), line('c-meals', 340.25)])).toBe(1540.75);
  });

  /* Float addition drifts; money that reads 1540.7500000000002 is a bug report. */
  it('does not leak float dust', () => {
    expect(claimTotal([line('c-meals', 0.1), line('c-meals', 0.2)])).toBe(0.3);
  });

  it('is zero for an empty claim', () => {
    expect(claimTotal([])).toBe(0);
  });
});

describe('caps', () => {
  /* The whole point: a 5000 cap that three 2000 lines walk through is not a cap. */
  it('sums a category before comparing, rather than checking line by line', () => {
    const items = [line('c-travel', 2000), line('c-travel', 2000), line('c-travel', 2000)];
    const [breach] = capBreaches(items, CATEGORIES);
    expect(breach).toMatchObject({ categoryId: 'c-travel', total: 6000, cap: 5000 });
  });

  it('allows a claim exactly on the cap', () => {
    expect(capBreaches([line('c-travel', 5000)], CATEGORIES)).toEqual([]);
  });

  it('ignores a category with no ceiling', () => {
    expect(capBreaches([line('c-meals', 999_999)], CATEGORIES)).toEqual([]);
  });

  /* Caps are per category, so one category's excess is not another's problem. */
  it('does not pool unrelated categories', () => {
    const items = [line('c-travel', 4000), line('c-meals', 4000)];
    expect(capBreaches(items, CATEGORIES)).toEqual([]);
  });
});

describe('receipts', () => {
  it('points at the line that is missing one', () => {
    const items = [line('c-travel', 100), line('c-travel', 100, null), line('c-meals', 50)];
    expect(missingReceipts(items, CATEGORIES)).toEqual([1]);
  });

  it('asks for nothing from a category that does not require one', () => {
    expect(missingReceipts([line('c-meals', 50, null)], CATEGORIES)).toEqual([]);
  });
});

/* A category deactivated after the draft was written, or never real. */
describe('categories that are no longer usable', () => {
  it('finds a deactivated one', () => {
    const retired = { ...TRAVEL, active: false };
    expect(unknownCategories([line('c-travel', 10)], [retired, MEALS])).toEqual(['c-travel']);
  });

  it('finds one that was never there', () => {
    expect(unknownCategories([line('c-nope', 10)], CATEGORIES)).toEqual(['c-nope']);
  });
});

/*
 * One pass, so a claim with two problems says so once. Being told about a
 * missing receipt, fixing it, and only then hearing about the cap is what makes
 * people abandon a form.
 */
describe('submitting', () => {
  it('reports every problem at once', () => {
    const items = [line('c-travel', 6000, null)];
    const { problems, total } = submissionProblems(items, CATEGORIES);

    expect(total).toBe(6000);
    expect(problems).toHaveLength(2);
    expect(problems.join(' ')).toMatch(/receipt/i);
    expect(problems.join(' ')).toMatch(/above the 5000/i);
  });

  it('refuses a claim with no lines', () => {
    expect(submissionProblems([], CATEGORIES).problems).toEqual([
      'Add at least one line before submitting',
    ]);
  });

  it('is silent about a claim with nothing wrong', () => {
    const items = [line('c-travel', 1000), line('c-meals', 200, null)];
    expect(submissionProblems(items, CATEGORIES).problems).toEqual([]);
  });
});

/*
 * PayrollAdjustment is unique per (employee, month, component), so two
 * categories paying out on one component have to arrive as one figure. Two rows
 * would be two payslip lines with the same code and no way to tell them apart.
 */
describe('what payroll is owed', () => {
  const mapping = [
    { id: 'c-travel', componentId: 'comp-reimb' },
    { id: 'c-meals', componentId: 'comp-reimb' },
    { id: 'c-phone', componentId: 'comp-phone' },
  ];

  it('groups by pay component, not by category', () => {
    const items = [line('c-travel', 1000), line('c-meals', 250), line('c-phone', 500)];
    const payouts = payoutByComponent(items, mapping);

    expect(payouts.get('comp-reimb')).toBe(1250);
    expect(payouts.get('comp-phone')).toBe(500);
    expect(payouts.size).toBe(2);
  });

  it('skips a line whose category has gone', () => {
    expect(payoutByComponent([line('c-gone', 100)], mapping).size).toBe(0);
  });
});
