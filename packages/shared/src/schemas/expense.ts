import { z } from 'zod';
import { dateOnlySchema, paginationQuerySchema } from './common';

/**
 * Expense claims and their reimbursement.
 *
 * A claim is a batch of lines, not a single amount, because that is how people
 * actually spend — one trip is a flight, two taxis and three meals, approved or
 * declined as one thing.
 *
 * The payslip end of this already existed. `PayComponent.taxable` carries the
 * note "Reimbursements and employer contributions do not", and
 * `PayrollAdjustment` is keyed (employee, month, component), so an approved
 * claim becomes a payroll row and nothing in payroll changes.
 */

/**
 * A claim's own states, not the shared `ApprovalStatus`.
 *
 * That one is PENDING/APPROVED/REJECTED/CANCELLED and a claim needs a DRAFT to
 * add lines to before anybody sees it. Widening it would make DRAFT
 * representable on every other approval in the product.
 *
 * There is no PAID: whether the money arrived is whether the payroll run for
 * the claim's month was published, which payroll already knows.
 */
export const EXPENSE_CLAIM_STATUSES = [
  'DRAFT',
  'SUBMITTED',
  'APPROVED',
  'REJECTED',
  'CANCELLED',
] as const;
export const expenseClaimStatusSchema = z.enum(EXPENSE_CLAIM_STATUSES);
export type ExpenseClaimStatusCode = (typeof EXPENSE_CLAIM_STATUSES)[number];

export const EXPENSE_CLAIM_STATUS_LABELS: Record<ExpenseClaimStatusCode, string> = {
  DRAFT: 'Draft',
  SUBMITTED: 'Awaiting approval',
  APPROVED: 'Approved',
  REJECTED: 'Declined',
  CANCELLED: 'Withdrawn',
};

/** Money, to the paisa, and never negative — direction comes from the component. */
const money = z
  .number()
  .positive('Enter an amount above zero')
  .max(99_999_999, 'That is larger than this system can pay')
  .multipleOf(0.01, 'Amounts go to two decimal places');

/**
 * `''` is what a cleared optional number field posts, and `z.coerce.number()`
 * reads it as 0 — which for a cap would silently mean "nothing may be claimed"
 * rather than "no ceiling". Same guard `employee.ts` and `recruitment.ts` use.
 */
const optionalMoney = z
  .literal('')
  .transform(() => null)
  .or(z.coerce.number().pipe(money))
  .nullish();

export const expenseCategoryCreateSchema = z.object({
  code: z
    .string()
    .trim()
    .min(1, 'Give it a short code')
    .max(24)
    .regex(/^[A-Z0-9_]+$/, 'Use capitals, numbers and underscores'),
  name: z.string().trim().min(1, 'Give it a name').max(80),
  capPerClaim: optionalMoney,
  requiresReceipt: z.boolean().default(true),
  componentId: z.string().min(1, 'Choose which payslip line this pays out on'),
  active: z.boolean().default(true),
  order: z.coerce.number().int().min(0).max(999).default(0),
});
export type ExpenseCategoryCreateInput = z.infer<typeof expenseCategoryCreateSchema>;

export const expenseCategoryUpdateSchema = expenseCategoryCreateSchema.partial();
export type ExpenseCategoryUpdateInput = z.infer<typeof expenseCategoryUpdateSchema>;

export const expenseItemInputSchema = z.object({
  categoryId: z.string().min(1, 'Choose a category'),
  spentOn: dateOnlySchema,
  amount: z.coerce.number().pipe(money),
  description: z.string().trim().min(1, 'Say what this was for').max(200),
  /** A Document id, uploaded before the line is saved. */
  receiptId: z.string().nullish(),
});
export type ExpenseItemInput = z.infer<typeof expenseItemInputSchema>;

export const expenseClaimCreateSchema = z.object({
  title: z.string().trim().min(1, 'Give the claim a title').max(120),
  /**
   * Sent whole rather than line by line. A claim is edited as one thing and
   * saved as one thing, so a half-saved claim is a state that cannot happen —
   * the same reason emergency contacts are a replace-all array.
   */
  items: z.array(expenseItemInputSchema).max(50, 'Split this into more than one claim'),
});
export type ExpenseClaimCreateInput = z.infer<typeof expenseClaimCreateSchema>;

export const expenseClaimUpdateSchema = expenseClaimCreateSchema.partial();
export type ExpenseClaimUpdateInput = z.infer<typeof expenseClaimUpdateSchema>;

export const expenseDecisionSchema = z.object({
  /**
   * yyyy-MM. The approver's decision, not the claimant's: which month somebody
   * is paid in is a judgement, and a claim filed on the 31st is usually next
   * month's. Required on approval, ignored on a decline.
   */
  payrollMonth: z
    .string()
    .regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Pick the month this is paid in')
    .optional(),
  note: z.string().trim().max(500).optional(),
});
export type ExpenseDecisionInput = z.infer<typeof expenseDecisionSchema>;

export const expenseClaimQuerySchema = paginationQuerySchema.extend({
  status: expenseClaimStatusSchema.optional(),
  employeeId: z.string().optional(),
  /** `own` is the default for everybody; the others need the matching permission. */
  scope: z.enum(['own', 'team', 'all']).default('own'),
});
export type ExpenseClaimQuery = z.infer<typeof expenseClaimQuerySchema>;
