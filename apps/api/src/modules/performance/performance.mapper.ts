import type { CyclePhase, ReviewDesk } from '@hrms/shared';
import type { AccessTokenClaims } from '@hrms/types';
import { dateKeyOf } from '../../common/utils/calendar';
import { isGoalOverdue, weightedProgress, weightTotal } from './performance.rules';

/**
 * Rows to payloads.
 *
 * The usual job of a mapper here is converting `Decimal` to `number`, and this
 * module has none to convert — weights, ratings and progress are all `Int` on
 * purpose. What it does instead is derive: a cycle's phase, whether a goal is
 * late, and — the important one — what the reader of a review is allowed to do
 * with it and allowed to see of it.
 */

/** `@db.Date` columns arrive as a Date at UTC midnight; the wire format is a key. */
const dateKey = (value: Date | null | undefined): string | null =>
  value ? dateKeyOf(value) : null;

const iso = (value: Date | null | undefined): string | null => value?.toISOString() ?? null;

interface CycleRow {
  id: string;
  name: string;
  periodStart: Date;
  periodEnd: Date;
  dueOn: Date | null;
  minServiceDays: number;
  status: string;
  openedAt: Date | null;
  closedAt: Date | null;
  createdAt: Date;
}

/**
 * Where a cycle has got to, from its dates and today.
 *
 * Derived rather than stored, because there is no scheduler in this product: a
 * phase column would go stale overnight and stay wrong until something happened
 * to touch it. `dueOn` splits RUNNING from SELF — before it there is work to
 * do, after it there are assessments outstanding.
 */
export function cyclePhase(
  cycle: { status: string; periodStart: Date; periodEnd: Date; dueOn: Date | null },
  todayKey: string,
): CyclePhase {
  if (cycle.status === 'DRAFT') return 'UPCOMING';
  if (cycle.status === 'CLOSED') return 'CLOSED';

  const start = dateKeyOf(cycle.periodStart);
  const end = dateKeyOf(cycle.periodEnd);
  if (todayKey < start) return 'UPCOMING';
  if (todayKey > end) return 'MANAGER';

  const due = cycle.dueOn ? dateKeyOf(cycle.dueOn) : null;
  if (due && todayKey >= due) return 'SELF';
  return 'RUNNING';
}

export function mapCycle(row: CycleRow, todayKey: string) {
  const phase = cyclePhase(row, todayKey);
  return {
    id: row.id,
    name: row.name,
    periodStart: dateKeyOf(row.periodStart),
    periodEnd: dateKeyOf(row.periodEnd),
    dueOn: dateKey(row.dueOn),
    minServiceDays: row.minServiceDays,
    status: row.status,
    phase,
    /*
     * Two flags rather than one, and collapsing them is the likeliest bug in
     * this module: goal setting closes when the cycle does, but progress keeps
     * moving right up to the end. A screen that hides "update progress" the
     * moment "add a goal" disappears is wrong for most of the cycle.
     */
    canSetGoals: row.status === 'OPEN',
    canUpdateProgress: row.status === 'OPEN',
    overdue: row.status === 'OPEN' && !!row.dueOn && todayKey > dateKeyOf(row.dueOn),
    openedAt: iso(row.openedAt),
    closedAt: iso(row.closedAt),
    createdAt: row.createdAt.toISOString(),
  };
}

interface GoalRow {
  id: string;
  cycleId: string;
  employeeId: string;
  title: string;
  description: string | null;
  target: string | null;
  progress: number;
  weight: number;
  status: string;
  dueOn: Date | null;
  createdAt: Date;
  updatedAt: Date;
  employee?: {
    id: string;
    firstName: string;
    lastName: string;
    employeeCode: string;
  } | null;
}

export function mapGoal(row: GoalRow, todayKey: string) {
  return {
    id: row.id,
    cycleId: row.cycleId,
    employeeId: row.employeeId,
    employee: row.employee ?? undefined,
    title: row.title,
    description: row.description,
    target: row.target,
    progress: row.progress,
    weight: row.weight,
    status: row.status,
    dueOn: dateKey(row.dueOn),
    // `AT_RISK` as a derived flag rather than a fifth enum member — two
    // representations of one fact drift, and this one would drift daily.
    overdue: isGoalOverdue({ dueOn: dateKey(row.dueOn), status: row.status as never }, todayKey),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

interface ReviewRow {
  id: string;
  cycleId: string;
  employeeId: string;
  reviewerId: string | null;
  status: string;
  selfRating: number | null;
  selfComment: string | null;
  selfSubmittedAt: Date | null;
  managerRating: number | null;
  managerComment: string | null;
  managerActions: string | null;
  managerSubmittedAt: Date | null;
  sharedAt: Date | null;
  acknowledgedAt: Date | null;
  acknowledgeNote: string | null;
  createdAt: Date;
  employee?: {
    id: string;
    firstName: string;
    lastName: string;
    employeeCode: string;
    department?: { name: string } | null;
  } | null;
  reviewer?: { id: string; firstName: string; lastName: string } | null;
  cycle?: CycleRow | null;
}

/** Whose move it is. `null` means nobody's — the review is finished or dropped. */
export function awaitingDesk(status: string, reviewerId: string | null): ReviewDesk | null {
  if (status === 'PENDING_SELF') return 'SELF';
  // No reviewer and it is their turn: HR has to assign somebody before this
  // can move, so the review sits on HR's desk rather than nowhere.
  if (status === 'PENDING_MANAGER') return reviewerId ? 'MANAGER' : 'HR';
  if (status === 'SHARED') return 'SELF';
  return null;
}

/**
 * What this particular reader may do with this review, and see of it.
 *
 * These are payload flags rather than permission checks on the client, and the
 * distinction is deliberate. Writing your own self-assessment is not a
 * privilege HR grants — you were put in a cycle — so no permission code
 * expresses it and none should.
 *
 * `managerVisibleToEmployee` is the one that matters. A manager's rating exists
 * from the moment they start typing and must not reach the employee until it is
 * shared. Deciding that here, on the server, means the client cannot leak it by
 * rendering it and hiding it in CSS — which is what happens when the rule lives
 * in a component.
 */
export function mapReview(row: ReviewRow, claims: AccessTokenClaims, todayKey: string) {
  const perms = new Set(claims.perms);
  const isSubject = row.employeeId === claims.employeeId;
  const isReviewer = !!row.reviewerId && row.reviewerId === claims.employeeId;
  const managerVisible = row.status === 'SHARED' || row.status === 'ACKNOWLEDGED';

  // HR reads everything and writes no manager half; the reviewer writes theirs.
  const mayWriteManager =
    (isReviewer && perms.has('performance.review.team')) ||
    (!row.reviewerId && perms.has('performance.manage'));

  const seesManagerHalf = mayWriteManager || perms.has('performance.read') || managerVisible;

  return {
    id: row.id,
    cycleId: row.cycleId,
    cycle: row.cycle ? mapCycle(row.cycle, todayKey) : undefined,
    employeeId: row.employeeId,
    employee: row.employee ?? undefined,
    reviewerId: row.reviewerId,
    reviewer: row.reviewer ?? undefined,
    status: row.status,
    awaitingDesk: awaitingDesk(row.status, row.reviewerId),

    selfRating: row.selfRating,
    selfComment: row.selfComment,
    selfSubmittedAt: iso(row.selfSubmittedAt),

    /*
     * Omitted, not nulled, when the reader may not see it. A `null` here would
     * be indistinguishable from "the manager wrote nothing", which is a
     * different fact and one the employee is entitled to at the right time.
     */
    ...(seesManagerHalf
      ? {
          managerRating: row.managerRating,
          managerComment: row.managerComment,
          managerActions: row.managerActions,
          managerSubmittedAt: iso(row.managerSubmittedAt),
        }
      : {}),

    sharedAt: iso(row.sharedAt),
    acknowledgedAt: iso(row.acknowledgedAt),
    acknowledgeNote: row.acknowledgeNote,
    createdAt: row.createdAt.toISOString(),

    canSelfAssess: isSubject && row.status === 'PENDING_SELF',
    canManagerAssess: mayWriteManager && row.status === 'PENDING_MANAGER',
    canShare: mayWriteManager && row.status === 'PENDING_MANAGER',
    canAcknowledge: isSubject && row.status === 'SHARED',
    managerVisibleToEmployee: managerVisible,
  };
}

/** The goal roll-up a review screen shows beside the ratings. */
export function goalSummary(goals: { weight: number; progress: number }[]) {
  return {
    count: goals.length,
    weightTotal: weightTotal(goals),
    weightedProgress: weightedProgress(goals),
  };
}
