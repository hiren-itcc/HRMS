import { z } from 'zod';
import { dateOnlySchema, paginationQuerySchema } from './common';

/**
 * Working from home: permission to, agreed in advance.
 *
 * Attendance already records *who did*, from the position taken at the punch.
 * Nothing here is enforced at clock-in — an unapproved remote day is still
 * recorded, and flagged on read.
 */

const range = {
  startDate: dateOnlySchema,
  endDate: dateOnlySchema,
};

/** A range that ends before it starts is a typo, not a request. */
const endNotBeforeStart = {
  check: (v: { startDate: string; endDate: string }) => v.endDate >= v.startDate,
  options: { path: ['endDate'], message: 'The last day cannot be before the first' },
};

export const wfhPreviewQuerySchema = z.object(range);
export type WfhPreviewQuery = z.infer<typeof wfhPreviewQuerySchema>;

export const wfhApplySchema = z
  .object({
    ...range,
    reason: z.string().trim().min(3, 'Say why').max(500),
  })
  .refine(endNotBeforeStart.check, endNotBeforeStart.options);
export type WfhApplyInput = z.infer<typeof wfhApplySchema>;

export const wfhAmendSchema = wfhApplySchema;
export type WfhAmendInput = z.infer<typeof wfhAmendSchema>;

export const wfhDecisionSchema = z.object({
  note: z
    .string()
    .trim()
    .max(300)
    .optional()
    .or(z.literal('').transform(() => undefined)),
});
export type WfhDecisionInput = z.infer<typeof wfhDecisionSchema>;

export const wfhQuerySchema = paginationQuerySchema.extend({
  status: z.enum(['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED']).optional(),
  /** Same three the leave inbox uses, and for the same reasons. */
  scope: z.enum(['own', 'inbox', 'all']).default('own'),
  from: dateOnlySchema.optional(),
  to: dateOnlySchema.optional(),
});
export type WfhQuery = z.infer<typeof wfhQuerySchema>;

/** What the apply form is told before anything is submitted. */
export interface WfhPreview {
  /** Days the request would actually cover — weekends and holidays removed. */
  workingDays: string[];
  /** Days in the range that are weekends or holidays. */
  skipped: string[];
  /** Their allowance, theirs or the company's. Seven means no limit. */
  cap: number;
  /** Weeks this would push past the cap, each named with its count. */
  breaches: { weekKey: string; would: number; cap: number }[];
}
