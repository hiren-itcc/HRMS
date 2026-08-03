import { isWeekend } from '../../common/utils/calendar';

export { daysInMonth, WEEKEND_DAYS, weekdayOf } from '../../common/utils/calendar';

/**
 * Pure attendance rules — no Prisma, no I/O, fully unit-testable.
 * All wall-clock reasoning happens in the employee's timezone
 * (location override → org default, per ADR A7); instants stay UTC.
 */

/** Fallback when an employee has no shift assigned. */
const DEFAULT_SHIFT_MINUTES = 9 * 60;

export interface ShiftLike {
  startTime: string; // "09:00"
  endTime: string; // "18:00"
  graceMinutes: number;
}

export type DerivedStatus =
  | 'PRESENT'
  | 'ABSENT'
  | 'HALF_DAY'
  | 'ON_LEAVE'
  | 'HOLIDAY'
  | 'WEEK_OFF'
  | 'WFH'
  | 'NOT_MARKED'
  | 'NOT_EMPLOYED'
  | 'FUTURE';

/** Days an employee was actually on the payroll (inclusive bounds). */
export interface EmploymentWindow {
  joinDate: string;
  exitDate: string | null;
}

/** Calendar date (YYYY-MM-DD) that `instant` falls on in `timeZone`. */
export function dateKeyInTz(instant: Date, timeZone: string): string {
  // en-CA formats as YYYY-MM-DD
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instant);
}

/** Wall-clock time (HH:MM, 24h) of `instant` in `timeZone`. */
export function timeInTz(instant: Date, timeZone: string): string {
  // hourCycle h23 — `hour12: false` can render midnight as "24:00".
  return new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(instant);
}

/**
 * The UTC instant at which `hhmm` wall-clock occurs on `dateKey` in
 * `timeZone` — the inverse of dateKeyInTz/timeInTz. Used when a corrected
 * time ("I actually arrived 09:15") becomes a stored timestamp.
 */
export function instantFromLocal(dateKey: string, hhmm: string, timeZone: string): Date {
  const asIfUtc = new Date(`${dateKey}T${hhmm}:00.000Z`);
  // How far that instant's local reading sits from the naive value tells us
  // the zone offset at that date (so DST is handled).
  const localReading = new Date(
    `${dateKeyInTz(asIfUtc, timeZone)}T${timeInTz(asIfUtc, timeZone)}:00.000Z`,
  );
  return new Date(asIfUtc.getTime() + (asIfUtc.getTime() - localReading.getTime()));
}

export function minutesOfDay(hhmm: string): number {
  const [h = '0', m = '0'] = hhmm.split(':');
  return Number(h) * 60 + Number(m);
}

/** Shift length in minutes; handles overnight shifts (22:00 → 06:00). */
export function shiftDurationMinutes(shift: ShiftLike | null): number {
  if (!shift) return DEFAULT_SHIFT_MINUTES;
  const start = minutesOfDay(shift.startTime);
  const end = minutesOfDay(shift.endTime);
  return end > start ? end - start : end + 24 * 60 - start;
}

/** Below this many worked minutes the day counts as a half day. */
export function halfDayThresholdMinutes(shift: ShiftLike | null): number {
  return Math.floor(shiftDurationMinutes(shift) / 2);
}

/** Late when arrival is past shift start + grace, in the employee's timezone. */
export function isLateArrival(checkIn: Date, timeZone: string, shift: ShiftLike | null): boolean {
  if (!shift) return false;
  const arrived = minutesOfDay(timeInTz(checkIn, timeZone));
  return arrived > minutesOfDay(shift.startTime) + shift.graceMinutes;
}

/** PRESENT or HALF_DAY from the minutes actually worked. */
export function statusForWorkedMinutes(
  workMinutes: number,
  shift: ShiftLike | null,
): 'PRESENT' | 'HALF_DAY' {
  return workMinutes < halfDayThresholdMinutes(shift) ? 'HALF_DAY' : 'PRESENT';
}

export function workedMinutesBetween(checkIn: Date, checkOut: Date): number {
  return Math.max(0, Math.round((checkOut.getTime() - checkIn.getTime()) / 60_000));
}

/** One clock-in/clock-out pair; `checkOut` is null while the person is in. */
export interface SessionLike {
  checkIn: Date;
  checkOut: Date | null;
}

export interface DayRollUp<T extends SessionLike> {
  checkIn: Date | null;
  checkOut: Date | null;
  workMinutes: number | null;
  workedStatus: 'PRESENT' | 'HALF_DAY';
  /** The session currently running, if any — at most one can be open. */
  openSession: T | null;
  sessions: T[];
}

/**
 * Collapses a day's sessions into the day-level numbers every other screen
 * reads. The single definition of what a multi-session day adds up to.
 *
 * A day still in progress is deliberately not judged: while a session is open
 * the status stays PRESENT, because calling a day half-done before the person
 * has left is how a mistaken clock-out used to freeze a day at HALF_DAY.
 */
export function rollUpSessions<T extends SessionLike>(
  sessions: T[],
  shift: ShiftLike | null,
): DayRollUp<T> {
  const ordered = [...sessions].sort((a, b) => a.checkIn.getTime() - b.checkIn.getTime());
  const openSession = ordered.find((s) => s.checkOut === null) ?? null;
  const last = ordered[ordered.length - 1];

  // Only closed sessions have worked time; the running one is counted when it ends.
  const workMinutes = ordered.reduce(
    (sum, s) => (s.checkOut ? sum + workedMinutesBetween(s.checkIn, s.checkOut) : sum),
    0,
  );

  return {
    checkIn: ordered[0]?.checkIn ?? null,
    // Null while someone is still in, so "who is in right now" stays a null check.
    checkOut: openSession ? null : (last?.checkOut ?? null),
    workMinutes: ordered.length ? workMinutes : null,
    workedStatus: openSession ? 'PRESENT' : statusForWorkedMinutes(workMinutes, shift),
    openSession,
    sessions: ordered,
  };
}

/**
 * Single source of truth for "what happened on this day" — used by the
 * calendar, the day view and every dashboard so they can never disagree.
 * Days with no record are derived rather than written by a nightly job.
 */
export function deriveDayStatus(input: {
  dateKey: string;
  todayKey: string;
  record: { status: string } | null;
  isHoliday: boolean;
  /** Approved leave covering this day (weekends/holidays still win). */
  isOnLeave?: boolean;
  /** Omit to skip the employment check (callers that already scope by date). */
  employment?: EmploymentWindow;
  /** Org working week; omit for the default Sat+Sun weekend. */
  weekOffDays?: number[];
}): DerivedStatus {
  // A real record always wins — never hide data that exists.
  if (input.record) return input.record.status as DerivedStatus;
  // Before joining or after leaving there is nothing to attend.
  if (input.employment && !isEmployedOn(input.dateKey, input.employment)) return 'NOT_EMPLOYED';
  // Calendar facts hold whether the day is past or still to come, so
  // approved leave is visible on the calendar before it starts.
  if (input.isHoliday) return 'HOLIDAY';
  if (isWeekend(input.dateKey, input.weekOffDays)) return 'WEEK_OFF';
  if (input.isOnLeave) return 'ON_LEAVE';
  if (input.dateKey > input.todayKey) return 'FUTURE';
  if (input.dateKey === input.todayKey) return 'NOT_MARKED';
  return 'ABSENT';
}

export function isEmployedOn(dateKey: string, window: EmploymentWindow): boolean {
  if (dateKey < window.joinDate) return false;
  return !window.exitDate || dateKey <= window.exitDate;
}
