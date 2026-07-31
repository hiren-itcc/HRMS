/**
 * Pure attendance rules — no Prisma, no I/O, fully unit-testable.
 * All wall-clock reasoning happens in the employee's timezone
 * (location override → org default, per ADR A7); instants stay UTC.
 */

/** Non-working days when no record exists. Sunday = 0. */
export const WEEKEND_DAYS = [0, 6];

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

/** Day-of-week for a YYYY-MM-DD key, timezone-independent. */
export function weekdayOf(dateKey: string): number {
  return new Date(`${dateKey}T00:00:00.000Z`).getUTCDay();
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
  /** Omit to skip the employment check (callers that already scope by date). */
  employment?: EmploymentWindow;
}): DerivedStatus {
  // A real record always wins — never hide data that exists.
  if (input.record) return input.record.status as DerivedStatus;
  if (input.dateKey > input.todayKey) return 'FUTURE';
  // Before joining or after leaving there is nothing to attend.
  if (input.employment && !isEmployedOn(input.dateKey, input.employment)) return 'NOT_EMPLOYED';
  if (input.isHoliday) return 'HOLIDAY';
  if (WEEKEND_DAYS.includes(weekdayOf(input.dateKey))) return 'WEEK_OFF';
  if (input.dateKey === input.todayKey) return 'NOT_MARKED';
  return 'ABSENT';
}

export function isEmployedOn(dateKey: string, window: EmploymentWindow): boolean {
  if (dateKey < window.joinDate) return false;
  return !window.exitDate || dateKey <= window.exitDate;
}

/** Every YYYY-MM-DD in a month, given "YYYY-MM". */
export function daysInMonth(month: string): string[] {
  const [y = '1970', m = '01'] = month.split('-');
  const year = Number(y);
  const monthIndex = Number(m) - 1;
  const count = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
  return Array.from({ length: count }, (_, i) => `${y}-${m}-${String(i + 1).padStart(2, '0')}`);
}
