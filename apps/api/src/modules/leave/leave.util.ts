import { eachDayKey, isWeekend } from '../../common/utils/calendar';

/**
 * Pure leave rules — no Prisma, no I/O, fully unit-testable.
 * Weekends and holidays never consume leave balance.
 */

export type HalfDaySide = 'FIRST_HALF' | 'SECOND_HALF';

export interface LeaveDayBreakdown {
  /** Days actually deducted from the balance. */
  days: number;
  /** Working days in the range (the ones leave applies to). */
  workingDays: string[];
  /** Days skipped because they are weekends or holidays. */
  skipped: string[];
}

/**
 * How much balance a date range consumes. A half day is only meaningful
 * for a single-day request; longer ranges always count whole days.
 */
export function calculateLeaveDays(
  startKey: string,
  endKey: string,
  holidayKeys: Set<string>,
  halfDaySide?: HalfDaySide | null,
  /** Org working week; omit for the default Sat+Sun weekend. */
  weekOffDays?: number[],
): LeaveDayBreakdown {
  const workingDays: string[] = [];
  const skipped: string[] = [];

  for (const dateKey of eachDayKey(startKey, endKey)) {
    if (isWeekend(dateKey, weekOffDays) || holidayKeys.has(dateKey)) skipped.push(dateKey);
    else workingDays.push(dateKey);
  }

  const isHalf = Boolean(halfDaySide) && startKey === endKey;
  return {
    days: isHalf ? workingDays.length * 0.5 : workingDays.length,
    workingDays,
    skipped,
  };
}

export interface BalanceLike {
  allocated: number;
  carriedOver: number;
  used: number;
}

/** What is still available to book. */
export function availableDays(balance: BalanceLike): number {
  return round1(balance.allocated + balance.carriedOver - balance.used);
}

/** Decimal days carry one decimal place — keep float noise out of totals. */
export function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

/** A request only blocks a new one while it is pending or approved. */
export const BLOCKING_STATUSES = ['PENDING', 'APPROVED'] as const;

/**
 * Approved leave may be withdrawn while it has not started; once it is
 * under way only HR should be unwinding it.
 */
export function canEmployeeCancel(
  request: { status: string; startDate: string },
  todayKey: string,
): boolean {
  if (request.status === 'PENDING') return true;
  return request.status === 'APPROVED' && request.startDate > todayKey;
}
