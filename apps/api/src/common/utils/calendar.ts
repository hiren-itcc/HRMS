/**
 * Working-calendar primitives shared by Attendance and Leave.
 * One definition of "weekend" so the two modules can never disagree about
 * what a working day is.
 */

/** Non-working days of the week. Sunday = 0. The default when unconfigured. */
export const WEEKEND_DAYS = [0, 6];

/** Day-of-week for a YYYY-MM-DD key, timezone-independent. */
export function weekdayOf(dateKey: string): number {
  return new Date(`${dateKey}T00:00:00.000Z`).getUTCDay();
}

/**
 * Is this a non-working day? `weekOffDays` comes from organization settings
 * (six-day weeks are common); it defaults to Sat+Sun so any caller that has
 * no settings in hand behaves exactly as before.
 */
export function isWeekend(dateKey: string, weekOffDays: number[] = WEEKEND_DAYS): boolean {
  return weekOffDays.includes(weekdayOf(dateKey));
}

/**
 * The leave year a date belongs to, identified by its starting calendar year.
 * `startMonth` is 1-based: 1 = calendar year, 4 = the Apr–Mar financial year,
 * where 2026-03-31 is still leave year 2025.
 */
export function leaveYearOf(dateKey: string, startMonth = 1): number {
  const year = Number(dateKey.slice(0, 4));
  const month = Number(dateKey.slice(5, 7));
  return month >= startMonth ? year : year - 1;
}

/** DB `@db.Date` columns are stored at UTC midnight — always build them that way. */
export function toDate(dateKey: string): Date {
  return new Date(`${dateKey}T00:00:00.000Z`);
}

export function dateKeyOf(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Every YYYY-MM-DD in a month, given "YYYY-MM". */
export function daysInMonth(month: string): string[] {
  const [y = '1970', m = '01'] = month.split('-');
  const count = new Date(Date.UTC(Number(y), Number(m), 0)).getUTCDate();
  return Array.from({ length: count }, (_, i) => `${y}-${m}-${String(i + 1).padStart(2, '0')}`);
}

/** Inclusive list of date keys from start to end (capped for safety). */
export function eachDayKey(startKey: string, endKey: string, maxDays = 400): string[] {
  const keys: string[] = [];
  const cursor = toDate(startKey);
  const end = toDate(endKey);
  while (cursor <= end && keys.length < maxDays) {
    keys.push(dateKeyOf(cursor));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return keys;
}

/** Do two inclusive date ranges share any day? */
export function rangesOverlap(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  return aStart <= bEnd && bStart <= aEnd;
}
