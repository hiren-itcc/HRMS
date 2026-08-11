import type {
  CyclePhase,
  GoalStatusCode,
  ReviewCycleStatusCode,
  ReviewDesk,
  ReviewStatusCode,
} from '@hrms/shared';

/**
 * The shapes the performance API returns.
 *
 * **Every number here is genuinely a number**, which is worth saying out loud
 * because it is not true of most modules in this app. Prisma's `Decimal`
 * serializes to JSON as a string, and a screen formatting a string shows `NaN`
 * with no stack trace to find it by — recruitment shipped exactly that.
 *
 * This module has no `Decimal` at all: weights, ratings and progress are `Int`
 * columns on purpose, and `weightedProgress` is computed from integers in a
 * pure function rather than read out of the database. So `Number.parseFloat` is
 * not needed anywhere in this feature, and if somebody later makes a rating
 * `Decimal(3,2)` to allow half-points, this comment is the warning that they
 * have just moved this feature into the class of bug it was designed out of.
 */

export interface EmployeeRef {
  id: string;
  firstName: string;
  lastName: string;
  employeeCode: string;
  department?: { name: string } | null;
}

export interface ReviewCycle {
  id: string;
  name: string;
  periodStart: string;
  periodEnd: string;
  dueOn: string | null;
  minServiceDays: number;
  status: ReviewCycleStatusCode;
  phase: CyclePhase;
  /**
   * Two flags, and they are not the same flag. Goal setting and progress
   * updates close at different moments; a screen that hides "update progress"
   * when "add a goal" disappears is wrong for most of a cycle.
   */
  canSetGoals: boolean;
  canUpdateProgress: boolean;
  overdue: boolean;
  openedAt: string | null;
  closedAt: string | null;
  createdAt: string;
  enrolled?: number;
  coverage?: Coverage;
}

export interface Coverage {
  total: number;
  pendingSelf: number;
  pendingManager: number;
  shared: number;
  acknowledged: number;
  cancelled: number;
}

export interface Goal {
  id: string;
  cycleId: string;
  employeeId: string;
  employee?: EmployeeRef;
  title: string;
  description: string | null;
  target: string | null;
  progress: number;
  weight: number;
  status: GoalStatusCode;
  dueOn: string | null;
  /** Derived from `dueOn` and today, not a stored fifth status. */
  overdue: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface GoalSummary {
  count: number;
  weightTotal: number;
  /** `null` when nothing is weighted — which is not the same as zero progress. */
  weightedProgress: number | null;
}

export interface Review {
  id: string;
  cycleId: string;
  cycle?: ReviewCycle;
  employeeId: string;
  employee?: EmployeeRef;
  reviewerId: string | null;
  reviewer?: { id: string; firstName: string; lastName: string };
  status: ReviewStatusCode;
  awaitingDesk: ReviewDesk | null;

  selfRating: number | null;
  selfComment: string | null;
  selfSubmittedAt: string | null;

  /*
   * Absent, not null, when this reader may not see it yet. The API omits the
   * keys rather than nulling them, because `null` would be indistinguishable
   * from "the manager wrote nothing" — a different fact, and one the employee
   * is entitled to at the right time.
   */
  managerRating?: number | null;
  managerComment?: string | null;
  managerActions?: string | null;
  managerSubmittedAt?: string | null;

  sharedAt: string | null;
  acknowledgedAt: string | null;
  acknowledgeNote: string | null;
  createdAt: string;

  /*
   * What *this* reader may do, decided by the API. Deliberately not derived on
   * the client from permissions: writing your own self-assessment is not a
   * granted privilege, it is a consequence of being enrolled in a cycle.
   */
  canSelfAssess: boolean;
  canManagerAssess: boolean;
  canShare: boolean;
  canAcknowledge: boolean;
  managerVisibleToEmployee: boolean;

  goals?: Goal[];
  goalSummary?: GoalSummary;
}
