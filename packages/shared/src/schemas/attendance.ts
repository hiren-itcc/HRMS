import { z } from 'zod';
import { dateOnlySchema, paginationQuerySchema } from './common';

export const attendanceStatusSchema = z.enum([
  'PRESENT',
  'ABSENT',
  'HALF_DAY',
  'ON_LEAVE',
  'HOLIDAY',
  'WEEK_OFF',
  'WFH',
]);

export const monthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Expected YYYY-MM');

/** GET /me/attendance — calendar/history for one month. */
export const myAttendanceQuerySchema = z.object({
  month: monthSchema,
});
export type MyAttendanceQuery = z.infer<typeof myAttendanceQuerySchema>;

/** GET /attendance — team or org day view. */
export const attendanceDayQuerySchema = paginationQuerySchema.extend({
  date: dateOnlySchema.optional(),
  departmentId: z.string().optional(),
  locationId: z.string().optional(),
});
export type AttendanceDayQuery = z.infer<typeof attendanceDayQuerySchema>;

/** GET /attendance/summary — monthly totals per employee. */
export const attendanceSummaryQuerySchema = paginationQuerySchema.extend({
  month: monthSchema,
  departmentId: z.string().optional(),
});
export type AttendanceSummaryQuery = z.infer<typeof attendanceSummaryQuerySchema>;

const timeHHmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use 24h HH:MM');

/** Correction (regularization) request — at least one time must be given. */
export const attendanceRequestCreateSchema = z
  .object({
    date: dateOnlySchema,
    requestedIn: timeHHmm.optional().or(z.literal('').transform(() => undefined)),
    requestedOut: timeHHmm.optional().or(z.literal('').transform(() => undefined)),
    reason: z.string().trim().min(5, 'Give a short reason').max(300),
  })
  .refine((d) => d.requestedIn || d.requestedOut, {
    path: ['requestedIn'],
    message: 'Provide a check-in or check-out time',
  })
  .refine((d) => !d.requestedIn || !d.requestedOut || d.requestedOut > d.requestedIn, {
    path: ['requestedOut'],
    message: 'Check-out must be after check-in',
  });
export type AttendanceRequestCreateInput = z.infer<typeof attendanceRequestCreateSchema>;

export const attendanceRequestQuerySchema = paginationQuerySchema.extend({
  status: z.enum(['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED']).optional(),
  scope: z.enum(['own', 'inbox']).default('own'),
});
export type AttendanceRequestQuery = z.infer<typeof attendanceRequestQuerySchema>;

export const approvalDecisionSchema = z.object({
  note: z
    .string()
    .trim()
    .max(300)
    .optional()
    .or(z.literal('').transform(() => undefined)),
});
export type ApprovalDecisionInput = z.infer<typeof approvalDecisionSchema>;
