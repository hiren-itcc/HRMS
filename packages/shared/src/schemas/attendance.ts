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

export const workModeSchema = z.enum(['OFFICE', 'REMOTE', 'CLIENT_SITE']);
export type WorkModeInput = z.infer<typeof workModeSchema>;

export const locationVerificationSchema = z.enum([
  'VERIFIED',
  'OUTSIDE',
  'UNVERIFIED',
  'NOT_APPLICABLE',
]);

/**
 * A browser position reading. All three fields travel together or not at all —
 * a coordinate without its accuracy cannot be judged, so the refinement below
 * refuses the half-supplied case rather than guessing a precision.
 */
const fixFields = {
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  accuracyMeters: z.number().nonnegative().max(100_000).optional(),
};

const hasWholeFixOrNone = (d: {
  latitude?: number;
  longitude?: number;
  accuracyMeters?: number;
}) => {
  const given = [d.latitude, d.longitude, d.accuracyMeters].filter((v) => v !== undefined).length;
  return given === 0 || given === 3;
};
const FIX_MESSAGE = 'Send latitude, longitude and accuracy together, or none of them';

/**
 * POST /attendance/check-in. Every field is optional so an older client — or a
 * request with no body at all — still clocks in; location is evidence, never a
 * precondition for starting work.
 */
export const clockInSchema = z
  .object({ workMode: workModeSchema.default('OFFICE'), ...fixFields })
  .refine(hasWholeFixOrNone, { path: ['accuracyMeters'], message: FIX_MESSAGE });
export type ClockInInput = z.infer<typeof clockInSchema>;

/** POST /attendance/check-out — the mode was settled when the session opened. */
export const clockOutSchema = z
  .object(fixFields)
  .refine(hasWholeFixOrNone, { path: ['accuracyMeters'], message: FIX_MESSAGE });
export type ClockOutInput = z.infer<typeof clockOutSchema>;

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
