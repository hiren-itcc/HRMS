import { z } from 'zod';
import { dateOnlySchema, paginationQuerySchema } from './common';

/**
 * Goals, review cycles and reviews.
 *
 * A cycle is a window: what period is being assessed, and when the answers are
 * due. Everything the UI needs to know about "what can I do right now" is
 * derived from those dates and today rather than stored — there is no scheduler
 * in this product, so a stored phase would be a field that goes stale overnight
 * and stays wrong until something happens to touch it.
 *
 * There is no `Decimal` anywhere in this module, deliberately. Weights, ratings
 * and progress are whole numbers, so the only fractional value the API returns
 * is a weighted average computed from integers — which means no field here can
 * repeat the mistake that put `NaN` on a recruitment screen, where a `Decimal`
 * serialized to JSON as a string and the web side declared it a number.
 */

// ── Cycle ─────────────────────────────────────────────────────────────

export const REVIEW_CYCLE_STATUSES = ['DRAFT', 'OPEN', 'CLOSED'] as const;
export const reviewCycleStatusSchema = z.enum(REVIEW_CYCLE_STATUSES);
export type ReviewCycleStatusCode = (typeof REVIEW_CYCLE_STATUSES)[number];

export const REVIEW_CYCLE_STATUS_LABELS: Record<ReviewCycleStatusCode, string> = {
  DRAFT: 'Not started',
  OPEN: 'Running',
  CLOSED: 'Closed',
};

export const reviewCycleCreateSchema = z
  .object({
    name: z.string().trim().min(1, 'Give the cycle a name').max(60),
    periodStart: dateOnlySchema,
    periodEnd: dateOnlySchema,
    /** When assessments are expected. Nothing enforces it — overdue is derived. */
    dueOn: dateOnlySchema.nullish(),
    /**
     * Service before `periodEnd` needed to be enrolled. On the cycle rather
     * than in Settings because it is a decision per cycle: a mid-year catch-up
     * cycle wants a different answer from the annual one.
     */
    minServiceDays: z.coerce.number().int().min(0).max(730).default(90),
  })
  .refine((c) => c.periodStart < c.periodEnd, {
    message: 'The cycle has to end after it starts',
    path: ['periodEnd'],
  })
  .refine((c) => !c.dueOn || c.dueOn >= c.periodStart, {
    message: 'Assessments cannot be due before the period they assess',
    path: ['dueOn'],
  });
export type ReviewCycleCreateInput = z.infer<typeof reviewCycleCreateSchema>;

export const reviewCycleUpdateSchema = reviewCycleCreateSchema;
export type ReviewCycleUpdateInput = z.infer<typeof reviewCycleUpdateSchema>;

/**
 * Closing with reviews still outstanding. Refused by default and possible with
 * `force`, because a cycle nobody can ever close — because two people ignored
 * it — is worse than a closed cycle with the counts written into the audit log.
 */
export const cycleCloseSchema = z.object({ force: z.boolean().default(false) });
export type CycleCloseInput = z.infer<typeof cycleCloseSchema>;

export const reviewCycleQuerySchema = paginationQuerySchema.extend({
  status: reviewCycleStatusSchema.optional(),
});
export type ReviewCycleQuery = z.infer<typeof reviewCycleQuerySchema>;

// ── Goals ─────────────────────────────────────────────────────────────

/**
 * Four states, and the two you expect to see are missing on purpose.
 *
 * `NOT_STARTED` is `progress === 0` and `IN_PROGRESS` is `progress > 0`; storing
 * them as well would be two representations of one fact, and they would drift
 * the first time somebody moved a slider without changing a dropdown. `AT_RISK`
 * is `dueOn` in the past while still `ACTIVE`, derived on read for the same
 * reason nothing else here is stored on a timer.
 */
export const GOAL_STATUSES = ['ACTIVE', 'ACHIEVED', 'MISSED', 'CANCELLED'] as const;
export const goalStatusSchema = z.enum(GOAL_STATUSES);
export type GoalStatusCode = (typeof GOAL_STATUSES)[number];

export const GOAL_STATUS_LABELS: Record<GoalStatusCode, string> = {
  ACTIVE: 'In progress',
  ACHIEVED: 'Achieved',
  MISSED: 'Missed',
  CANCELLED: 'Dropped',
};

/**
 * Whole percent, and `0` means unweighted.
 *
 * An integer rather than a decimal: three equal goals become 34/33/33 rather
 * than 33.33 each, which nobody has ever minded, and it keeps this module free
 * of `Decimal` entirely. Zero is allowed and is not a mistake — an unweighted
 * goal set is a legitimate choice, and forcing weights onto a three-goal list
 * is ceremony. What is refused is *half* of them being weighted.
 */
const percent = z.coerce
  .number()
  .int('Whole percentages only')
  .min(0)
  .max(100, 'Percent, so 0 to 100');

export const RATING_SCALE = [1, 2, 3, 4, 5] as const;
export type Rating = (typeof RATING_SCALE)[number];

/** The words are the scale. A number with no wording is not a rating. */
export const RATING_LABELS: Record<Rating, string> = {
  1: 'Below expectations',
  2: 'Partly meets',
  3: 'Meets expectations',
  4: 'Exceeds expectations',
  5: 'Outstanding',
};

const rating = z.coerce.number().int('Ratings are whole numbers').min(1, 'Pick a rating').max(5);

/**
 * `''` is what a cleared select posts, and `z.coerce.number()` reads it as 0 —
 * which here would be a rating below the bottom of the scale rather than "not
 * rated at all". Same guard `expense.ts` uses for an optional cap.
 */
const optionalRating = z
  .literal('')
  .transform(() => null)
  .or(rating)
  .nullish();

export const goalCreateSchema = z.object({
  cycleId: z.string().min(1, 'Choose a review cycle'),
  /**
   * Whose goal. Absent means your own; naming somebody else needs
   * `performance.goal.team`, which the guard cannot check because it does not
   * know who reports to whom. The service does.
   */
  employeeId: z.string().optional(),
  title: z.string().trim().min(1, 'Say what the goal is').max(140),
  description: z.string().trim().max(2000).nullish(),
  /** What "done" looks like, in words. A number with a unit would be a metric engine. */
  target: z.string().trim().max(200).nullish(),
  progress: percent.default(0),
  weight: percent.default(0),
  status: goalStatusSchema.default('ACTIVE'),
  dueOn: dateOnlySchema.nullish(),
});
export type GoalCreateInput = z.infer<typeof goalCreateSchema>;

export const goalUpdateSchema = goalCreateSchema
  .omit({ cycleId: true, employeeId: true })
  .partial();
export type GoalUpdateInput = z.infer<typeof goalUpdateSchema>;

export const goalQuerySchema = paginationQuerySchema.extend({
  cycleId: z.string().optional(),
  employeeId: z.string().optional(),
  status: goalStatusSchema.optional(),
  scope: z.enum(['own', 'team', 'all']).default('own'),
});
export type GoalQuery = z.infer<typeof goalQuerySchema>;

// ── Reviews ───────────────────────────────────────────────────────────

/**
 * One row, two authors, and the status answers "who is this waiting on" —
 * which is exactly what both inboxes render.
 *
 * Drafting lives *inside* `PENDING_SELF` and `PENDING_MANAGER`: the author
 * saves as often as they like and the status does not move until they submit,
 * the same way an `ExpenseClaim` is edited freely while `DRAFT`. The finer
 * chronology is in `selfSubmittedAt` / `managerSubmittedAt`.
 *
 * Not `ApprovalStatus`, which is PENDING/APPROVED/REJECTED/CANCELLED. A review
 * is never approved and never rejected; mapping `SHARED` onto `APPROVED` would
 * make the enum's name a lie at every call site, and `ACKNOWLEDGED` has no
 * member to map to at all. Widening the shared one instead would make both
 * representable on every leave request in the product — the same argument
 * `expense.ts` makes for having its own list.
 */
export const REVIEW_STATUSES = [
  'PENDING_SELF',
  'PENDING_MANAGER',
  'SHARED',
  'ACKNOWLEDGED',
  'CANCELLED',
] as const;
export const reviewStatusSchema = z.enum(REVIEW_STATUSES);
export type ReviewStatusCode = (typeof REVIEW_STATUSES)[number];

export const REVIEW_STATUS_LABELS: Record<ReviewStatusCode, string> = {
  PENDING_SELF: 'Awaiting self-assessment',
  PENDING_MANAGER: 'With the manager',
  SHARED: 'Shared',
  ACKNOWLEDGED: 'Signed off',
  CANCELLED: 'Dropped',
};

/** Whose move it is. `null` means nobody's — the review is finished. */
export const REVIEW_DESKS = ['SELF', 'MANAGER', 'HR'] as const;
export const reviewDeskSchema = z.enum(REVIEW_DESKS);
export type ReviewDesk = (typeof REVIEW_DESKS)[number];

/**
 * Saving a draft is permissive; submitting is not. Completeness is checked by
 * `selfSubmissionProblems` in the rules file at submit time, so a half-written
 * assessment can be saved and come back to — the same split
 * `expenseClaimUpdateSchema` and `submissionProblems` already make.
 */
export const reviewSelfSchema = z.object({
  selfRating: optionalRating,
  selfComment: z.string().trim().max(5000).nullish(),
});
export type ReviewSelfInput = z.infer<typeof reviewSelfSchema>;

export const reviewManagerSchema = z.object({
  managerRating: optionalRating,
  managerComment: z.string().trim().max(5000).nullish(),
  /** The part the employee is meant to act on, and the next cycle reads back. */
  managerActions: z.string().trim().max(2000).nullish(),
});
export type ReviewManagerInput = z.infer<typeof reviewManagerSchema>;

export const reviewAcknowledgeSchema = z.object({
  note: z.string().trim().max(1000).optional(),
});
export type ReviewAcknowledgeInput = z.infer<typeof reviewAcknowledgeSchema>;

/** Reopening, cancelling, reassigning — each has to say why. */
export const reviewNoteSchema = z.object({
  note: z.string().trim().min(1, 'Say why').max(500),
});
export type ReviewNoteInput = z.infer<typeof reviewNoteSchema>;

export const reviewReassignSchema = z.object({
  reviewerId: z.string().min(1, 'Choose who writes this review'),
  note: z.string().trim().max(500).optional(),
});
export type ReviewReassignInput = z.infer<typeof reviewReassignSchema>;

export const reviewQuerySchema = paginationQuerySchema.extend({
  cycleId: z.string().optional(),
  employeeId: z.string().optional(),
  status: reviewStatusSchema.optional(),
  /** `team` is resolved from the reviewer snapshot; `all` needs `performance.read`. */
  scope: z.enum(['own', 'team', 'all']).default('own'),
  awaitingMe: z.enum(['true', 'false']).optional(),
});
export type ReviewQuery = z.infer<typeof reviewQuerySchema>;
