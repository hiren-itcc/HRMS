import { z } from 'zod';
import { dateOnlySchema, paginationQuerySchema } from './common';

const name = z.string().trim().min(1, 'Name is required').max(60);
const days = z.coerce.number().min(0).max(365);

export const halfDaySideSchema = z.enum(['FIRST_HALF', 'SECOND_HALF']);
export const leaveStatusSchema = z.enum(['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED']);
const yearSchema = z.coerce.number().int().min(2000).max(2100);

// ── Leave types ───────────────────────────────────────────────────────
/** Kept unrefined so `.partial()` stays available for the update schema. */
const leaveTypeFields = z.object({
  name,
  code: z
    .string()
    .trim()
    .min(1, 'Code is required')
    .max(10)
    .transform((v) => v.toUpperCase()),
  daysPerYear: days,
  isPaid: z.boolean().default(true),
  carryForward: z.boolean().default(false),
  maxCarryForward: days.optional().nullable(),
  requiresApproval: z.boolean().default(true),
});

/** Carry-forward without a cap would allow unbounded accrual. */
const requireCarryCap = {
  check: (d: { carryForward?: boolean; maxCarryForward?: number | null }) =>
    !d.carryForward || d.maxCarryForward != null,
  options: { path: ['maxCarryForward'], message: 'Set a carry-forward cap' },
};

export const leaveTypeCreateSchema = leaveTypeFields.refine(
  requireCarryCap.check,
  requireCarryCap.options,
);
export const leaveTypeUpdateSchema = leaveTypeFields
  .partial()
  .refine(requireCarryCap.check, requireCarryCap.options);
export type LeaveTypeCreateInput = z.infer<typeof leaveTypeCreateSchema>;
export type LeaveTypeUpdateInput = z.infer<typeof leaveTypeUpdateSchema>;

// ── Applying ──────────────────────────────────────────────────────────
export const leaveApplySchema = z
  .object({
    leaveTypeId: z.string().min(1, 'Choose a leave type'),
    startDate: dateOnlySchema,
    endDate: dateOnlySchema,
    halfDaySide: halfDaySideSchema.optional().nullable(),
    reason: z.string().trim().min(5, 'Give a short reason').max(300),
  })
  .refine((d) => d.endDate >= d.startDate, {
    path: ['endDate'],
    message: 'End date cannot be before the start date',
  })
  .refine((d) => !d.halfDaySide || d.startDate === d.endDate, {
    path: ['halfDaySide'],
    message: 'Half day applies to a single date only',
  });
export type LeaveApplyInput = z.infer<typeof leaveApplySchema>;

/** Live "how many days will this cost?" while the form is being filled. */
export const leavePreviewQuerySchema = z.object({
  startDate: dateOnlySchema,
  endDate: dateOnlySchema,
  halfDaySide: halfDaySideSchema.optional(),
});
export type LeavePreviewQuery = z.infer<typeof leavePreviewQuerySchema>;

export const leaveRequestQuerySchema = paginationQuerySchema.extend({
  status: leaveStatusSchema.optional(),
  scope: z.enum(['own', 'inbox', 'all']).default('own'),
  leaveTypeId: z.string().optional(),
});
export type LeaveRequestQuery = z.infer<typeof leaveRequestQuerySchema>;

export const leaveDecisionSchema = z.object({
  note: z
    .string()
    .trim()
    .max(300)
    .optional()
    .or(z.literal('').transform(() => undefined)),
});
export type LeaveDecisionInput = z.infer<typeof leaveDecisionSchema>;

// ── Balances ──────────────────────────────────────────────────────────
export const leaveBalanceQuerySchema = paginationQuerySchema.extend({
  year: yearSchema.optional(),
  employeeId: z.string().optional(),
});
export type LeaveBalanceQuery = z.infer<typeof leaveBalanceQuerySchema>;

/** HR sets the allocation for one employee + type + year. */
export const leaveBalanceAdjustSchema = z.object({
  employeeId: z.string().min(1),
  leaveTypeId: z.string().min(1),
  year: yearSchema,
  allocated: days,
  carriedOver: days.default(0),
  note: z
    .string()
    .trim()
    .max(200)
    .optional()
    .or(z.literal('').transform(() => undefined)),
});
export type LeaveBalanceAdjustInput = z.infer<typeof leaveBalanceAdjustSchema>;

export const leaveCalendarQuerySchema = z.object({
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Expected YYYY-MM'),
});
export type LeaveCalendarQuery = z.infer<typeof leaveCalendarQuerySchema>;
