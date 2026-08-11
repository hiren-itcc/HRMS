import type { GoalStatusCode, ReviewCycleStatusCode, ReviewStatusCode } from '@hrms/shared';

/**
 * Every refusal in the performance module, in one file.
 *
 * Pure, like `expense.rules.ts`, `asset.status.ts` and `settlement.calc.ts`: no
 * Prisma, no settings lookup, and no clock — anything that depends on today
 * takes `todayKey` as an argument. That is what lets the whole state machine be
 * tested without a database and without freezing time.
 */

const DAY_MS = 86_400_000;

/** One decimal place, so a weighted average never surfaces as 0.30000000000000004. */
function round1(value: number): number {
  return Math.round((value + Number.EPSILON) * 10) / 10;
}

function daysBetweenKeys(fromKey: string, toKey: string): number {
  return Math.round((Date.parse(toKey) - Date.parse(fromKey)) / DAY_MS);
}

// ── Cycles ────────────────────────────────────────────────────────────

export type CycleAction = 'edit' | 'open' | 'close' | 'reopen' | 'delete';

/**
 * A cycle's dates may only change while nobody has written against them.
 * Editing an open cycle would silently re-scope what "H1" means after twenty
 * people had already answered it.
 */
export function canEditCycle(status: ReviewCycleStatusCode): boolean {
  return status === 'DRAFT';
}

/**
 * `CLOSED` is deliberately openable. It is what makes reopening a prematurely
 * closed cycle possible, and it is the same call that makes enrolment
 * idempotent for somebody who joined late.
 */
export function canOpenCycle(status: ReviewCycleStatusCode): boolean {
  return status === 'DRAFT' || status === 'CLOSED';
}

export function canCloseCycle(status: ReviewCycleStatusCode): boolean {
  return status === 'OPEN';
}

/** Only a draft nobody has been enrolled into. */
export function canDeleteCycle(status: ReviewCycleStatusCode, reviewCount: number): boolean {
  return status === 'DRAFT' && reviewCount === 0;
}

export function cycleError(status: ReviewCycleStatusCode, action: CycleAction): string {
  if (action === 'delete') {
    return status === 'DRAFT'
      ? 'People have already been enrolled in this cycle, so it cannot be deleted. Close it instead.'
      : 'Only a cycle that has never been opened can be deleted.';
  }
  if (action === 'edit') {
    return status === 'OPEN'
      ? 'This cycle is running, so its dates cannot change — people have already answered against them.'
      : 'This cycle is closed. Reopen it before editing the dates.';
  }
  if (action === 'open') return 'This cycle is already running.';
  if (action === 'close') {
    return status === 'DRAFT'
      ? 'This cycle has not been opened yet.'
      : 'This cycle is already closed.';
  }
  return 'This cycle is not closed, so there is nothing to reopen.';
}

export interface Period {
  periodStart: string;
  periodEnd: string;
}

const MAX_PERIOD_DAYS = 730;

/**
 * Every problem at once. A form that reveals one problem per submit is a form
 * people abandon — same reason `submissionProblems` in expenses returns a list.
 */
export function periodProblems(period: Period, dueOn: string | null): string[] {
  const problems: string[] = [];
  if (period.periodEnd < period.periodStart) {
    problems.push('The cycle has to end after it starts.');
  } else if (daysBetweenKeys(period.periodStart, period.periodEnd) > MAX_PERIOD_DAYS) {
    problems.push('That is longer than two years — this is a review cycle, not a career.');
  }
  if (dueOn && dueOn < period.periodStart) {
    problems.push('Assessments cannot be due before the period they assess.');
  }
  return problems;
}

/**
 * Two live cycles must not cover the same dates. Half-open, so a cycle ending
 * 30 June and one starting 1 July do not overlap — and neither do two that
 * merely touch. Only OPEN and CLOSED cycles are passed in; a DRAFT overlapping
 * is somebody planning, not somebody making a mistake.
 */
export function overlapsExistingCycle(candidate: Period, existing: Period[]): boolean {
  return existing.some(
    (other) => candidate.periodStart <= other.periodEnd && other.periodStart <= candidate.periodEnd,
  );
}

// ── Eligibility ───────────────────────────────────────────────────────

export interface EligibleEmployee {
  id: string;
  status: string;
  joinDate: string;
  managerId: string | null;
}

/**
 * Who gets enrolled when a cycle opens.
 *
 * Refuses somebody who never started (`ONBOARDING`), somebody already gone
 * (`EXITED`), and somebody three weeks into the job — there is nothing to
 * review yet, which is what `minServiceDays` is for.
 *
 * Deliberately does **not** refuse an employee with no manager. They are
 * enrolled with no reviewer and HR assigns one, because the alternative is that
 * whoever is at the top of the chart is silently absent from every cycle. That
 * asymmetry is the entire reason this is a function and not a `where` clause.
 */
export function isEligible(
  employee: EligibleEmployee,
  cycle: { periodEnd: string; minServiceDays: number },
): boolean {
  if (employee.status === 'ONBOARDING' || employee.status === 'EXITED') return false;
  return daysBetweenKeys(employee.joinDate, cycle.periodEnd) >= cycle.minServiceDays;
}

export function eligibleFor<T extends EligibleEmployee>(
  employees: T[],
  cycle: { periodEnd: string; minServiceDays: number },
): T[] {
  return employees.filter((employee) => isEligible(employee, cycle));
}

// ── Goals ─────────────────────────────────────────────────────────────

export function canEditGoal(
  cycleStatus: ReviewCycleStatusCode,
  goalStatus: GoalStatusCode,
): boolean {
  return cycleStatus !== 'CLOSED' && goalStatus !== 'CANCELLED';
}

/**
 * Takes only the cycle status, because those are the only two refusals
 * `canEditGoal` has and the cycle decides which one applies: a closed cycle
 * refuses everything, so anything still refused inside an open one is a dropped
 * goal.
 */
export function goalEditError(cycleStatus: ReviewCycleStatusCode): string {
  if (cycleStatus === 'CLOSED') {
    return 'That cycle is closed. Its goals are a record of what happened and cannot change.';
  }
  return 'This goal was dropped. Add a new one rather than reviving it.';
}

export interface WeightedGoal {
  weight: number;
  progress: number;
}

export function weightTotal(goals: { weight: number }[]): number {
  return goals.reduce((total, goal) => total + goal.weight, 0);
}

/**
 * Refuses exactly two things, and stays quiet about a third.
 *
 * Weights that are partly used — 50 / 50 / 0 — are refused, because that zero
 * is almost always somebody who stopped halfway rather than a goal genuinely
 * worth nothing. Weighted goals that do not total 100 are refused for the
 * obvious reason. All-zero is **silent**: an unweighted goal set is a
 * legitimate choice, and forcing weights onto a three-goal list is ceremony.
 */
export function weightProblems(goals: { weight: number }[]): string[] {
  if (goals.length === 0) return [];
  const weighted = goals.filter((goal) => goal.weight > 0);
  if (weighted.length === 0) return [];

  if (weighted.length < goals.length) {
    const bare = goals.length - weighted.length;
    return [
      `${bare} of these goals ${bare === 1 ? 'has' : 'have'} no weight while the others do — weight all of them, or none.`,
    ];
  }
  const total = weightTotal(goals);
  if (total !== 100) {
    return [
      total > 100
        ? `The weights total ${total}%. Trim them to 100%.`
        : `The weights total ${total}%. ${100 - total}% of the cycle is unallocated.`,
    ];
  }
  return [];
}

/**
 * `null` when nothing is weighted — "no weighting" is not "zero progress", and
 * returning 0 would put an honest-looking bar at the far left of the screen.
 */
export function weightedProgress(goals: WeightedGoal[]): number | null {
  const weighted = goals.filter((goal) => goal.weight > 0);
  if (weighted.length === 0) return null;
  const total = weightTotal(weighted);
  if (total === 0) return null;
  const sum = weighted.reduce((acc, goal) => acc + goal.weight * goal.progress, 0);
  return round1(sum / total);
}

/** Empty is 0, not NaN — an employee with no goals has made no progress. */
export function averageProgress(goals: { progress: number }[]): number {
  if (goals.length === 0) return 0;
  return round1(goals.reduce((total, goal) => total + goal.progress, 0) / goals.length);
}

/** Today is not late, so the comparison is strict. A finished goal is never overdue. */
export function isGoalOverdue(
  goal: { dueOn: string | null; status: GoalStatusCode },
  todayKey: string,
): boolean {
  if (!goal.dueOn || goal.status !== 'ACTIVE') return false;
  return goal.dueOn < todayKey;
}

// ── Reviews ───────────────────────────────────────────────────────────

export type ReviewAction =
  | 'saveSelf'
  | 'submitSelf'
  | 'skipSelf'
  | 'saveManager'
  | 'share'
  | 'acknowledge'
  | 'reopen'
  | 'cancel';

/**
 * The whole state machine, in one lookup, and the only place a transition is
 * written down. `null` means refused.
 *
 * Every `can*` below is derived from this rather than repeating it, so a
 * transition cannot be legal in one place and illegal in another — which is the
 * failure mode a scattered set of boolean helpers eventually produces.
 *
 * Two entries worth reading twice. An `ACKNOWLEDGED` review **cannot be
 * cancelled**: the employee has signed it, and erasing it afterwards is not
 * something this system should offer. It can be *reopened*, which leaves the
 * trail intact. And `skipSelf` exists because a self-assessment nobody is ever
 * going to write must not hold a cycle open forever.
 */
const TRANSITIONS: Record<ReviewStatusCode, Partial<Record<ReviewAction, ReviewStatusCode>>> = {
  PENDING_SELF: {
    saveSelf: 'PENDING_SELF',
    submitSelf: 'PENDING_MANAGER',
    skipSelf: 'PENDING_MANAGER',
    cancel: 'CANCELLED',
  },
  PENDING_MANAGER: {
    saveManager: 'PENDING_MANAGER',
    share: 'SHARED',
    cancel: 'CANCELLED',
  },
  SHARED: {
    acknowledge: 'ACKNOWLEDGED',
    reopen: 'PENDING_MANAGER',
    cancel: 'CANCELLED',
  },
  ACKNOWLEDGED: {
    reopen: 'PENDING_MANAGER',
  },
  CANCELLED: {},
};

export function nextStatus(
  current: ReviewStatusCode,
  action: ReviewAction,
): ReviewStatusCode | null {
  return TRANSITIONS[current][action] ?? null;
}

const allows = (status: ReviewStatusCode, action: ReviewAction) =>
  nextStatus(status, action) !== null;

export const canSaveSelf = (s: ReviewStatusCode) => allows(s, 'saveSelf');
export const canSubmitSelf = (s: ReviewStatusCode) => allows(s, 'submitSelf');
export const canSkipSelf = (s: ReviewStatusCode) => allows(s, 'skipSelf');
export const canSaveManager = (s: ReviewStatusCode) => allows(s, 'saveManager');
export const canShare = (s: ReviewStatusCode) => allows(s, 'share');
export const canAcknowledge = (s: ReviewStatusCode) => allows(s, 'acknowledge');
export const canReopen = (s: ReviewStatusCode) => allows(s, 'reopen');
export const canCancelReview = (s: ReviewStatusCode) => allows(s, 'cancel');

const ACTION_NAMES: Record<ReviewAction, string> = {
  saveSelf: 'edit this self-assessment',
  submitSelf: 'submit this self-assessment',
  skipSelf: 'move past this self-assessment',
  saveManager: 'edit this review',
  share: 'share this review',
  acknowledge: 'sign this review off',
  reopen: 'reopen this review',
  cancel: 'drop this review',
};

const STATUS_REASONS: Record<ReviewStatusCode, string> = {
  PENDING_SELF: 'it is still with the employee',
  PENDING_MANAGER: 'it is still with the manager',
  SHARED: 'it has already been shared',
  ACKNOWLEDGED: 'it has already been signed off',
  CANCELLED: 'it was dropped',
};

export function reviewError(status: ReviewStatusCode, action: ReviewAction): string {
  return `You cannot ${ACTION_NAMES[action]} — ${STATUS_REASONS[status]}.`;
}

export interface SelfDraft {
  selfRating: number | null;
  selfComment: string | null;
}

/**
 * Checked at submit, not at save. A draft is allowed to be half-written; what
 * is not allowed is sending a half-written one to somebody's manager.
 */
export function selfSubmissionProblems(draft: SelfDraft, goals: { weight: number }[]): string[] {
  const problems: string[] = [];
  if (!draft.selfComment?.trim()) {
    problems.push('Say something about how the period went.');
  }
  if (draft.selfRating === null || draft.selfRating < 1 || draft.selfRating > 5) {
    problems.push('Rate yourself before submitting.');
  }
  problems.push(...weightProblems(goals));
  return problems;
}

export interface ManagerDraft {
  managerRating: number | null;
  managerComment: string | null;
}

/** A rating with no words is the review everybody complains about. */
export function managerSubmissionProblems(draft: ManagerDraft): string[] {
  const problems: string[] = [];
  if (draft.managerRating === null || draft.managerRating < 1 || draft.managerRating > 5) {
    problems.push('Give a rating.');
  }
  if (!draft.managerComment?.trim()) {
    problems.push('Write something to go with the rating.');
  }
  return problems;
}

// ── Cycle coverage ────────────────────────────────────────────────────

export interface Coverage {
  total: number;
  pendingSelf: number;
  pendingManager: number;
  shared: number;
  acknowledged: number;
  cancelled: number;
}

export function cycleCoverage(reviews: { status: ReviewStatusCode }[]): Coverage {
  const coverage: Coverage = {
    total: reviews.length,
    pendingSelf: 0,
    pendingManager: 0,
    shared: 0,
    acknowledged: 0,
    cancelled: 0,
  };
  for (const review of reviews) {
    if (review.status === 'PENDING_SELF') coverage.pendingSelf += 1;
    else if (review.status === 'PENDING_MANAGER') coverage.pendingManager += 1;
    else if (review.status === 'SHARED') coverage.shared += 1;
    else if (review.status === 'ACKNOWLEDGED') coverage.acknowledged += 1;
    else coverage.cancelled += 1;
  }
  return coverage;
}

/**
 * What stops a cycle closing. A dropped review never blocks — it was dropped
 * precisely so it would not.
 *
 * The caller may override with `force`, and should audit the coverage when it
 * does: a cycle that can never be closed because two people ignored it is worse
 * than a closed cycle with the counts written down.
 */
export function closeProblems(coverage: Coverage): string[] {
  const problems: string[] = [];
  if (coverage.pendingSelf > 0) {
    problems.push(
      `${coverage.pendingSelf} ${coverage.pendingSelf === 1 ? 'person has' : 'people have'} not written a self-assessment.`,
    );
  }
  if (coverage.pendingManager > 0) {
    problems.push(
      `${coverage.pendingManager} ${coverage.pendingManager === 1 ? 'review is' : 'reviews are'} still with a manager.`,
    );
  }
  if (coverage.shared > 0) {
    problems.push(
      `${coverage.shared} shared ${coverage.shared === 1 ? 'review has' : 'reviews have'} not been signed off. Closing anyway is fine — this is a nudge, not a blocker.`,
    );
  }
  return problems;
}

/**
 * Unsigned shared reviews are listed by `closeProblems` but do not actually
 * stop a close: chasing a signature is not HR's to enforce, and a cycle held
 * open for one is a cycle nobody closes.
 */
export function blocksClose(coverage: Coverage): boolean {
  return coverage.pendingSelf > 0 || coverage.pendingManager > 0;
}
