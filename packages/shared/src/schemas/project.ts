import { z } from 'zod';
import { dateOnlySchema, paginationQuerySchema } from './common';

/**
 * Projects, who is staffed on them, and the week each person logs against them.
 *
 * Two things this deliberately does not carry.
 *
 * **No money.** There is no cost rate and no billing rate, so nothing here is a
 * Decimal except the hours column itself. A cost rate derived from salary *is*
 * salary data, and would need the same content-based gating the letters module
 * uses; that is a larger decision than a timesheet needs.
 *
 * **No reconciliation against attendance.** Attendance answers "was this person
 * at work". A timesheet answers "what did they work on". Making one validate the
 * other couples two modules that today share nothing, and the failure mode — a
 * week rejected because somebody forgot to clock out — is worse than the gap.
 */

/**
 * A project's life, which is longer than its work.
 *
 * `COMPLETED` and `CANCELLED` both stop new hours arriving, and they are kept
 * apart because the register is read months later: "we finished it" and "we
 * dropped it" are not the same answer to why the hours stop.
 */
export const PROJECT_STATUSES = ['PLANNED', 'ACTIVE', 'ON_HOLD', 'COMPLETED', 'CANCELLED'] as const;
export const projectStatusSchema = z.enum(PROJECT_STATUSES);
export type ProjectStatusCode = (typeof PROJECT_STATUSES)[number];

export const PROJECT_STATUS_LABELS: Record<ProjectStatusCode, string> = {
  PLANNED: 'Planned',
  ACTIVE: 'Active',
  ON_HOLD: 'On hold',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
};

/** Statuses that still accept hours. Everything else is closed to new entries. */
export const OPEN_PROJECT_STATUSES: readonly ProjectStatusCode[] = ['ACTIVE', 'ON_HOLD'];

/**
 * A week's own states, not the shared `ApprovalStatus`.
 *
 * The same call expenses made, for the same reason: a week needs a DRAFT to fill
 * in before anybody sees it, and widening `ApprovalStatus` would make DRAFT
 * representable on every other approval in the product.
 *
 * There is no CANCELLED. A week that should not have been submitted is
 * withdrawn back to DRAFT, because the week still happened — unlike a claim,
 * which can simply not exist.
 */
export const TIMESHEET_STATUSES = ['DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED'] as const;
export const timesheetStatusSchema = z.enum(TIMESHEET_STATUSES);
export type TimesheetStatusCode = (typeof TIMESHEET_STATUSES)[number];

export const TIMESHEET_STATUS_LABELS: Record<TimesheetStatusCode, string> = {
  DRAFT: 'Draft',
  SUBMITTED: 'Awaiting approval',
  APPROVED: 'Approved',
  REJECTED: 'Sent back',
};

/**
 * Hours on one project on one day.
 *
 * Quarter-hour steps because that is how people actually recall a day, and
 * because it keeps the column at two decimal places without inviting 7.3333.
 * The 24 here is only the per-entry ceiling — the per-*day* total across every
 * project is checked in the rules file, which is the one that can see them all.
 */
const hours = z
  .number()
  .positive('Enter hours above zero')
  .max(24, 'A day has 24 hours')
  .multipleOf(0.25, 'Log time in quarter-hour steps');

export const projectCreateSchema = z.object({
  code: z
    .string()
    .trim()
    .min(1, 'Give it a short code')
    .max(24)
    .regex(/^[A-Z0-9_-]+$/, 'Use capitals, numbers, hyphens and underscores'),
  name: z.string().trim().min(1, 'Give it a name').max(120),
  description: z.string().trim().max(500).nullish(),
  status: projectStatusSchema.default('PLANNED'),
  startsOn: dateOnlySchema,
  /** Open-ended until somebody closes it. */
  endsOn: dateOnlySchema.nullish(),
  managerId: z.string().min(1, 'Choose who runs this project'),
});
export type ProjectCreateInput = z.infer<typeof projectCreateSchema>;

export const projectUpdateSchema = projectCreateSchema.partial();
export type ProjectUpdateInput = z.infer<typeof projectUpdateSchema>;

export const projectMemberCreateSchema = z.object({
  employeeId: z.string().min(1, 'Choose who is joining'),
  /** What they do on this project — free text, because job titles do not fit. */
  role: z.string().trim().max(80).nullish(),
  allocation: z.coerce
    .number()
    .int()
    .min(1, 'Allocate at least 1%')
    .max(100, 'Nobody is more than 100% on one project')
    .default(100),
  joinedOn: dateOnlySchema,
  /** Set when somebody rolls off. Their logged hours stay. */
  leftOn: dateOnlySchema.nullish(),
});
export type ProjectMemberCreateInput = z.infer<typeof projectMemberCreateSchema>;

/**
 * `employeeId` is dropped rather than made optional: moving a membership to a
 * different person would silently reassign hours already logged under it.
 * Remove the member and add the other one.
 */
export const projectMemberUpdateSchema = projectMemberCreateSchema
  .omit({ employeeId: true })
  .partial();
export type ProjectMemberUpdateInput = z.infer<typeof projectMemberUpdateSchema>;

export const timesheetEntryInputSchema = z.object({
  projectId: z.string().min(1, 'Choose a project'),
  workedOn: dateOnlySchema,
  hours: z.coerce.number().pipe(hours),
  note: z.string().trim().max(200).nullish(),
});
export type TimesheetEntryInput = z.infer<typeof timesheetEntryInputSchema>;

export const timesheetWeekSchema = z.object({
  /** A Monday. Anything else is refused — see `weekStartOf` in the rules file. */
  weekStart: dateOnlySchema,
  /**
   * Sent whole rather than cell by cell. A week is filled as one grid and saved
   * as one grid, so a half-saved week is a state that cannot happen — the same
   * call `expenseClaimCreateSchema` makes for claim lines.
   *
   * Ten projects across seven days is the ceiling. Somebody genuinely touching
   * more than that in one week has a bigger problem than this form.
   */
  entries: z.array(timesheetEntryInputSchema).max(70, 'That is more than ten projects in one week'),
});
export type TimesheetWeekInput = z.infer<typeof timesheetWeekSchema>;

export const timesheetDecisionSchema = z.object({
  /**
   * Optional on approval, required on a rejection — enforced in the service,
   * because sending a week back without saying why only produces the same week
   * again. Kept in one schema so both routes take the same body.
   */
  note: z.string().trim().max(500).optional(),
});
export type TimesheetDecisionInput = z.infer<typeof timesheetDecisionSchema>;

export const projectQuerySchema = paginationQuerySchema.extend({
  status: projectStatusSchema.optional(),
  /** `own` is the default for everybody; `all` needs `project.read`. */
  scope: z.enum(['own', 'all']).default('own'),
});
export type ProjectQuery = z.infer<typeof projectQuerySchema>;

export const timesheetQuerySchema = paginationQuerySchema.extend({
  status: timesheetStatusSchema.optional(),
  employeeId: z.string().optional(),
  from: dateOnlySchema.optional(),
  to: dateOnlySchema.optional(),
  /** `own` is the default for everybody; the others need the matching permission. */
  scope: z.enum(['own', 'team', 'all']).default('own'),
});
export type TimesheetQuery = z.infer<typeof timesheetQuerySchema>;

export const timesheetWeekQuerySchema = z.object({
  weekStart: dateOnlySchema,
});
export type TimesheetWeekQuery = z.infer<typeof timesheetWeekQuerySchema>;

export const utilisationQuerySchema = z.object({
  from: dateOnlySchema,
  to: dateOnlySchema,
  projectId: z.string().optional(),
});
export type UtilisationQuery = z.infer<typeof utilisationQuerySchema>;
