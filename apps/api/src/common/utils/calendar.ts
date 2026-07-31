/**
 * Working-calendar primitives shared by Attendance and Leave.
 * One definition of "weekend" so the two modules can never disagree about
 * what a working day is.
 */

/** Non-working days of the week. Sunday = 0. */
export const WEEKEND_DAYS = [0, 6];

/** Day-of-week for a YYYY-MM-DD key, timezone-independent. */
export function weekdayOf(dateKey: string): number {
  return new Date(`${dateKey}T00:00:00.000Z`).getUTCDay();
}

export function isWeekend(dateKey: string): boolean {
  return WEEKEND_DAYS.includes(weekdayOf(dateKey));
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
