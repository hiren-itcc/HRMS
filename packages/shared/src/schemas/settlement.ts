import { z } from 'zod';
import { dateOnlySchema, paginationQuerySchema } from './common';

/**
 * Full & final settlement: what a leaver is owed, as one document.
 *
 * Deliberately not a payroll run. A run is unique per organization per month
 * and prorates by working days; a settlement lands weeks after the last
 * working day, when that month is closed, and its amounts sit outside the base
 * PF, ESI and professional tax are computed on.
 */

export const SETTLEMENT_STATUSES = ['DRAFT', 'APPROVED', 'PAID', 'CANCELLED'] as const;
export const settlementStatusSchema = z.enum(SETTLEMENT_STATUSES);
export type SettlementStatusCode = (typeof SETTLEMENT_STATUSES)[number];

export const SETTLEMENT_STATUS_LABELS: Record<SettlementStatusCode, string> = {
  DRAFT: 'Draft',
  APPROVED: 'Approved',
  PAID: 'Paid',
  CANCELLED: 'Cancelled',
};

export const SETTLEMENT_LINE_KINDS = ['EARNING', 'DEDUCTION'] as const;
export const settlementLineKindSchema = z.enum(SETTLEMENT_LINE_KINDS);
export type SettlementLineKindCode = (typeof SETTLEMENT_LINE_KINDS)[number];

/**
 * Where a line came from.
 *
 * The three computed sources are what a recompute rebuilds. `MANUAL` is HR's
 * own — a retention bonus, a tax deduction, a laptop nobody returned — and
 * survives a recompute, because a figure somebody entered by hand is the one
 * thing the calculator cannot derive again.
 */
export const SETTLEMENT_LINE_SOURCES = [
  'LEAVE_ENCASHMENT',
  'NOTICE_RECOVERY',
  'GRATUITY',
  'MANUAL',
] as const;
export const settlementLineSourceSchema = z.enum(SETTLEMENT_LINE_SOURCES);
export type SettlementLineSourceCode = (typeof SETTLEMENT_LINE_SOURCES)[number];

export const SETTLEMENT_LINE_SOURCE_LABELS: Record<SettlementLineSourceCode, string> = {
  LEAVE_ENCASHMENT: 'Leave encashment',
  NOTICE_RECOVERY: 'Notice recovery',
  GRATUITY: 'Gratuity',
  MANUAL: 'Added by hand',
};

/** Amounts are money: two decimals, and never negative. A negative earning is
 *  a deduction, and letting one in would make the two totals meaningless. */
const amountSchema = z
  .number()
  .min(0, 'Amount cannot be negative')
  .max(99_999_999.99)
  .multipleOf(0.01, 'Amount cannot be finer than a paisa');

export const settlementCreateSchema = z.object({
  offboardingId: z.string().trim().min(1).max(40),
  notes: z.string().trim().max(2000).optional().nullable(),
});
export type SettlementCreateInput = z.infer<typeof settlementCreateSchema>;

/**
 * Overriding a computed figure.
 *
 * A real settlement is negotiated. A system that computes an unarguable number
 * is a system people work around in a spreadsheet, so every computed line can
 * be changed — and the change is recorded, so the statement can say the figure
 * was not the one the calculator produced.
 */
export const settlementLineUpdateSchema = z.object({
  amount: amountSchema,
  label: z.string().trim().min(1).max(120).optional(),
  basis: z.string().trim().max(200).optional().nullable(),
});
export type SettlementLineUpdateInput = z.infer<typeof settlementLineUpdateSchema>;

/** A line HR adds themselves. Always MANUAL — the computed sources are the
 *  calculator's to create, and one of those added by hand would be silently
 *  destroyed by the next recompute. */
export const settlementLineCreateSchema = z.object({
  kind: settlementLineKindSchema,
  label: z.string().trim().min(1).max(120),
  basis: z.string().trim().max(200).optional().nullable(),
  amount: amountSchema,
});
export type SettlementLineCreateInput = z.infer<typeof settlementLineCreateSchema>;

export const settlementApproveSchema = z.object({
  notes: z.string().trim().max(2000).optional().nullable(),
});
export type SettlementApproveInput = z.infer<typeof settlementApproveSchema>;

/** The bank reference, so Finance can tie this to a statement line. Required:
 *  "paid" with nothing to check it against is a claim, not a record. */
export const settlementPaySchema = z.object({
  paymentRef: z.string().trim().min(1, 'Enter the payment reference').max(120),
  paidOn: dateOnlySchema.optional(),
});
export type SettlementPayInput = z.infer<typeof settlementPaySchema>;

export const settlementCancelSchema = z.object({
  reason: z.string().trim().min(3, 'Say why').max(500),
});
export type SettlementCancelInput = z.infer<typeof settlementCancelSchema>;

export const settlementQuerySchema = paginationQuerySchema.extend({
  status: settlementStatusSchema.optional(),
  employeeId: z.string().trim().max(40).optional(),
});
export type SettlementQuery = z.infer<typeof settlementQuerySchema>;
