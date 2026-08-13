import { z } from 'zod';

/**
 * Income tax: the regime somebody picked, what they declared, and the rules
 * both are read against.
 *
 * Three things this module deliberately does not model: previous-employer
 * income, perquisites, and any income that is not salary. This projects what
 * *this* employer will pay and applies the deductions an employer is allowed to
 * consider when deducting TDS. It is not an income-tax return.
 */

export const TAX_REGIMES = ['NEW', 'OLD'] as const;
export const taxRegimeSchema = z.enum(TAX_REGIMES);
export type TaxRegimeCode = (typeof TAX_REGIMES)[number];

export const TAX_REGIME_LABELS: Record<TaxRegimeCode, string> = {
  NEW: 'New Tax Regime',
  OLD: 'Old Tax Regime',
};

export const TAX_DECLARATION_STATUSES = ['DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED'] as const;
export const taxDeclarationStatusSchema = z.enum(TAX_DECLARATION_STATUSES);
export type TaxDeclarationStatusCode = (typeof TAX_DECLARATION_STATUSES)[number];

export const TAX_DECLARATION_STATUS_LABELS: Record<TaxDeclarationStatusCode, string> = {
  DRAFT: 'Draft',
  SUBMITTED: 'Awaiting HR',
  APPROVED: 'Approved',
  REJECTED: 'Sent back',
};

/**
 * The deduction sections this product understands.
 *
 * A closed list rather than free text, because the engine looks each one up by
 * key: a section nobody configured contributes nothing, silently. Which of
 * these a given financial year actually allows is a `TaxDeductionRule` row —
 * this constant only says which keys are spellable.
 */
export const TAX_SECTIONS = [
  '80C',
  '80CCD1B',
  '80D_SELF',
  '80D_PARENTS',
  '80E',
  '80G',
  '80TTA',
  '80U',
  '80DD',
  'HOME_LOAN_INTEREST',
] as const;
export const taxSectionSchema = z.enum(TAX_SECTIONS);
export type TaxSectionCode = (typeof TAX_SECTIONS)[number];

/** `YYYY-YY`, the same shape `TdsReturn.financialYear` and `tds-period.ts` use. */
export const financialYearSchema = z
  .string()
  .regex(/^\d{4}-\d{2}$/, 'Use a financial year like 2026-27')
  .refine((value) => {
    const start = Number(value.slice(0, 4));
    return Number(value.slice(5)) === (start + 1) % 100;
  }, 'A financial year runs April to March, so the second half is the next year — 2026-27');

const money = z
  .number()
  .min(0, 'This cannot be negative')
  .max(99_999_999, 'That is larger than this system can handle')
  .multipleOf(0.01, 'Amounts go to two decimal places');

/**
 * `''` is what a cleared optional number field posts, and `z.coerce.number()`
 * reads it as 0. The same guard `expense.ts` and `employee.ts` use.
 */
const optionalMoney = z
  .literal('')
  .transform(() => null)
  .or(z.coerce.number().pipe(money))
  .nullish();

export const taxRegimeSelectionSchema = z.object({
  financialYear: financialYearSchema,
  regime: taxRegimeSchema,
});
export type TaxRegimeSelectionInput = z.infer<typeof taxRegimeSelectionSchema>;

export const taxDeclarationItemSchema = z.object({
  section: taxSectionSchema,
  /**
   * What the employee says they invested. Declaring above the section limit is
   * allowed and capped on the way through — people do invest more than they can
   * claim, and refusing the number would only teach them to under-report it.
   */
  declaredAmount: z.coerce.number().pipe(money),
});
export type TaxDeclarationItemInput = z.infer<typeof taxDeclarationItemSchema>;

export const taxDeclarationSchema = z.object({
  financialYear: financialYearSchema,
  /**
   * HRA inputs, not an HRA exemption. The exemption is the least of three
   * formulas and is computed from these plus the salary structure — asked for
   * "your exemption" people type the allowance they receive, which is almost
   * never the exempt figure.
   */
  annualRentPaid: optionalMoney,
  metroCity: z.boolean().default(false),
  /** Sent whole: a declaration is filled as one form and saved as one form. */
  items: z.array(taxDeclarationItemSchema).max(TAX_SECTIONS.length),
});
export type TaxDeclarationInput = z.infer<typeof taxDeclarationSchema>;

export const taxDeclarationDecisionSchema = z.object({
  /**
   * Optional on approval, required on a rejection — enforced in the service.
   * Sending a declaration back without saying why produces the same
   * declaration again.
   */
  note: z.string().trim().max(500).optional(),
  /**
   * Per-section overrides, for the case a proof came up short. Absent means
   * "approve what was declared, capped by the statutory limit".
   */
  approved: z
    .array(z.object({ section: taxSectionSchema, approvedAmount: z.coerce.number().pipe(money) }))
    .optional(),
});
export type TaxDeclarationDecisionInput = z.infer<typeof taxDeclarationDecisionSchema>;

export const tdsOverrideSchema = z.object({
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Pick a payroll month'),
  overrideTds: z.coerce.number().pipe(money),
  reason: z.string().trim().min(1, 'Say why this month differs').max(500),
});
export type TdsOverrideInput = z.infer<typeof tdsOverrideSchema>;

export const taxEmployeeQuerySchema = z.object({
  financialYear: financialYearSchema.optional(),
  regime: taxRegimeSchema.optional(),
  status: taxDeclarationStatusSchema.optional(),
  departmentId: z.string().optional(),
  search: z.string().trim().max(200).optional(),
});
export type TaxEmployeeQuery = z.infer<typeof taxEmployeeQuerySchema>;
