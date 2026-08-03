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

/**
 * A browser position reading. All three fields travel together or not at all —
 * a coordinate without its accuracy cannot be judged, so the refinement below
 * refuses the half-supplied case rather than guessing a precision.
 */
const fixFields = {
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  accuracyMeters: z.number().nonnegative().max(100_000).optional(),
  /**
   * The device or the page cannot supply a position at all: no geolocation
   * support, or a page served over plain HTTP where the browser refuses to
   * ask. Distinct from a refusal, which the client turns into an error instead
   * of sending — one is something the person can fix, the other is not.
   */
  locationUnavailable: z.boolean().optional(),
};

type FixInput = {
  latitude?: number;
  longitude?: number;
  accuracyMeters?: number;
  locationUnavailable?: boolean;
};

const hasWholeFixOrNone = (d: FixInput) => {
  const given = [d.latitude, d.longitude, d.accuracyMeters].filter((v) => v !== undefined).length;
  return given === 0 || given === 3;
};
const FIX_MESSAGE = 'Send latitude, longitude and accuracy together, or none of them';

const hasFix = (d: FixInput) => d.latitude !== undefined && d.longitude !== undefined;
const hasPositionOrReason = (d: FixInput) => hasFix(d) || d.locationUnavailable === true;
const REQUIRED_MESSAGE = 'Location is required to clock in or out';

/**
 * POST /attendance/check-in. No work mode: where somebody is working is worked
 * out from the position, and accepting a declared mode would let the client
 * dictate the very answer this computes.
 */
export const clockInSchema = z
  .object(fixFields)
  .refine(hasWholeFixOrNone, { path: ['accuracyMeters'], message: FIX_MESSAGE })
  .refine(hasPositionOrReason, { path: ['latitude'], message: REQUIRED_MESSAGE });
export type ClockInInput = z.infer<typeof clockInSchema>;

/** POST /attendance/check-out — same position rules; the mode is already settled. */
export const clockOutSchema = z
  .object(fixFields)
  .refine(hasWholeFixOrNone, { path: ['accuracyMeters'], message: FIX_MESSAGE })
  .refine(hasPositionOrReason, { path: ['latitude'], message: REQUIRED_MESSAGE });
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
