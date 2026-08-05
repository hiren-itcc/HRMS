/**
 * Probation and notice-period arithmetic. Pure — no Prisma, no clock, no
 * config lookups; today is always passed in.
 *
 * It is pure because it runs on both sides of the same fact. The daily tick
 * uses it to decide who to confirm, and every read path uses it to decide what
 * to *display* — so a probation that ended last night reads as ended the
 * moment somebody opens the page, whether or not the tick has run. That
 * matters more here than in most of the app: this API is on a plan where the
 * instance sleeps, so "the job ran" is not something a screen may depend on.
 *
 * The same rule the schema already states about leaving applies to joining:
 * the date is the mechanism, the status is the label.
 */

import { addDays, addMonths, dateKeyOf, daysBetween } from '../../common/utils/calendar';

export type ProbationState = 'NONE' | 'PROBATION' | 'EXTENDED' | 'CONFIRMED';

/** Only the fields the rules read, so callers can pass a partial select. */
export interface LifecycleFields {
  joinDate: Date;
  probationMonths: number | null;
  probationEndDate: Date | null;
  probationExtendedTo: Date | null;
  confirmedOn: Date | null;
  noticePeriodDays: number | null;
}

/** Only the settings the rules read. */
export interface LifecycleDefaults {
  defaultNoticeDays: number;
  defaultProbationMonths: number;
}

export interface ProbationView {
  state: ProbationState;
  /** The date that counts — the extension when there is one. Null if NONE. */
  endDate: string | null;
  /** The originally agreed end, present only when it was extended. */
  originalEndDate: string | null;
  /** Days from today to `endDate`; negative once it has passed. Null if NONE. */
  daysRemaining: number | null;
  /** Past its end date with nobody confirmed. The list HR has to act on. */
  isOverdue: boolean;
}

const key = (date: Date | null | undefined): string | null => (date ? dateKeyOf(date) : null);

/**
 * The end date in force: an extension supersedes the original, and the
 * original is kept rather than overwritten so "extended by three weeks on 4
 * August" is still answerable afterwards.
 */
export function effectiveProbationEnd(employee: LifecycleFields): string | null {
  return key(employee.probationExtendedTo) ?? key(employee.probationEndDate);
}

/**
 * Where a new hire's probation lands. Called at create, and nowhere else —
 * once stored, the date is what HR agreed and is only moved by an explicit
 * extension. Recomputing it from settings would silently re-date every
 * existing hire the first time somebody edits the company default.
 */
export function probationEndFor(
  joinDateKey: string,
  months: number | null,
  defaults: LifecycleDefaults,
): string | null {
  const effective = months ?? defaults.defaultProbationMonths;
  return effective > 0 ? addMonths(joinDateKey, effective) : null;
}

export function probationStateOf(employee: LifecycleFields, todayKey: string): ProbationView {
  const endDate = effectiveProbationEnd(employee);
  const originalEndDate = employee.probationExtendedTo ? key(employee.probationEndDate) : null;

  if (employee.confirmedOn) {
    return {
      state: 'CONFIRMED',
      endDate,
      originalEndDate,
      daysRemaining: null,
      isOverdue: false,
    };
  }

  // No end date means nobody ever put them on probation — a consultant, or a
  // record that predates this feature. Not the same as "confirmed", and not
  // something to invent a date for.
  if (!endDate) {
    return {
      state: 'NONE',
      endDate: null,
      originalEndDate: null,
      daysRemaining: null,
      isOverdue: false,
    };
  }

  const daysRemaining = daysBetween(todayKey, endDate);
  return {
    state: employee.probationExtendedTo ? 'EXTENDED' : 'PROBATION',
    endDate,
    originalEndDate,
    daysRemaining,
    // The end date is the last day *of* probation, so it is only overdue once
    // that day has passed.
    isOverdue: daysRemaining < 0,
  };
}

export function effectiveNoticeDays(
  employee: Pick<LifecycleFields, 'noticePeriodDays'>,
  defaults: LifecycleDefaults,
): number {
  return employee.noticePeriodDays ?? defaults.defaultNoticeDays;
}

/**
 * The soonest last working day a notice period allows.
 *
 * Counted in calendar days from the day the resignation is filed, which is how
 * an Indian notice clause is normally written ("three months from the date of
 * resignation"). Working days would need the holiday calendar and the
 * employee's week-off pattern, and would still disagree with the contract.
 */
export function earliestLastWorkingDate(submittedOnKey: string, noticeDays: number): string {
  return addDays(submittedOnKey, noticeDays);
}
