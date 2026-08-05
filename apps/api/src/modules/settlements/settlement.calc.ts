/**
 * Full & final settlement arithmetic. Pure — no Prisma, no clock, no settings
 * lookups; everything is passed in.
 *
 * Pure for the same reason `payroll.calc.ts` and `lifecycle.rules.ts` are: this
 * is the part somebody will dispute. A leaver who thinks their encashment is
 * wrong deserves an answer that can be reproduced, and a function with no
 * dependencies can be reproduced in a test.
 *
 * **Nothing here touches the statutory engine.** Settlement amounts are
 * deliberately outside the base that PF, ESI and professional tax are computed
 * on: an earning added to monthly gross would cross the ESI threshold, which is
 * a cliff rather than a taper, and switch ESI off for the month
 * (`payroll.statutory.ts` — `if (gross > esi.wageThreshold) return 0`). Tax on a
 * settlement is entered by hand, exactly as monthly TDS already is.
 */

import type { OrgSettings, PerDayBasis } from '@hrms/shared';
import { addDays, addMonths, daysBetween, daysInMonth } from '../../common/utils/calendar';

export type SettlementConfig = OrgSettings['settlement'];
export type GratuityConfig = SettlementConfig['gratuity'];

/** Rounded to paise, the way every money figure in payroll is. */
const round2 = (n: number): number => Math.round(n * 100) / 100;

/**
 * What one day of pay is worth.
 *
 * The divisor is policy, not arithmetic — 26 is the statutory basis and the
 * common Indian practice, 30 suits a contract written in calendar days, and
 * `CALENDAR_MONTH` divides by however many days the month of the last working
 * day actually had. The last is the only one that needs to know the month,
 * which is why the month is a parameter rather than derived.
 */
export function perDayRate(monthlyPay: number, monthKey: string, basis: PerDayBasis): number {
  const divisor =
    basis === 'DAYS_26' ? 26 : basis === 'DAYS_30' ? 30 : daysInMonth(monthKey).length;
  return divisor > 0 ? round2(monthlyPay / divisor) : 0;
}

export interface EncashableBalance {
  leaveTypeId: string;
  code: string;
  name: string;
  encashable: boolean;
  /** `allocated + carriedOver − used`, as `availableDays` computes it. */
  availableDays: number;
}

export interface EncashmentLine {
  leaveTypeId: string;
  code: string;
  name: string;
  days: number;
  amount: number;
}

/**
 * One line per encashable leave type that has a balance left.
 *
 * Types that are not encashable, and balances of zero or less, produce no line
 * at all rather than a zero one — a settlement listing "Casual leave: ₹0" is
 * noise, and a negative balance is somebody who took leave they had not
 * accrued, which is a payroll deduction that already happened.
 */
export function encashmentLines(balances: EncashableBalance[], rate: number): EncashmentLine[] {
  return balances
    .filter((b) => b.encashable && b.availableDays > 0)
    .map((b) => ({
      leaveTypeId: b.leaveTypeId,
      code: b.code,
      name: b.name,
      days: b.availableDays,
      amount: round2(b.availableDays * rate),
    }));
}

/**
 * Days of notice the employee did not serve.
 *
 * Zero — never negative — when they served their full notice or more, and zero
 * when there was no resignation behind the exit at all. **The company ending
 * somebody's employment owes them notice; it does not recover it.** Passing a
 * null `earliestLastWorkingDate` is how a termination, a contract ending or a
 * retirement says so.
 */
export function noticeShortfallDays(
  actualLastWorkingDate: string,
  earliestLastWorkingDate: string | null,
): number {
  if (!earliestLastWorkingDate) return 0;
  return Math.max(0, daysBetween(actualLastWorkingDate, earliestLastWorkingDate));
}

export interface GratuityResult {
  eligible: boolean;
  /** Completed years of service, with a part-year over six months rounded up. */
  years: number;
  /** Whole years and months, for the basis line on the statement. */
  servedYears: number;
  servedMonths: number;
  amount: number;
  /** Set when the statutory ceiling bit, so the statement can say so. */
  cappedFrom: number | null;
}

/**
 * Gratuity, on the Payment of Gratuity Act shape: `daysPerYear / divisor ×
 * last drawn monthly pay × completed years`, past a minimum service, under a
 * ceiling. Every one of those four numbers is configurable, because the Act's
 * figures have moved before and a rate change should be a settings edit.
 *
 * A part-year over six months counts as a whole one — that is the Act's rule,
 * and rounding it down would quietly underpay everyone who left in the second
 * half of their year.
 */
export function gratuityFor(
  joinDate: string,
  lastWorkingDate: string,
  monthlyPay: number,
  config: GratuityConfig,
): GratuityResult {
  const { servedYears, servedMonths } = completedService(joinDate, lastWorkingDate);
  const totalMonths = servedYears * 12 + servedMonths;
  // Six months and one day rounds up; exactly six does not. `> 6` rather than
  // `>= 6` is the difference, and it is the side the Act comes down on.
  const years = servedYears + (servedMonths > 6 ? 1 : 0);

  const eligible =
    config.enabled && monthlyPay > 0 && totalMonths >= config.minYears * 12 && years > 0;
  if (!eligible) {
    return { eligible: false, years, servedYears, servedMonths, amount: 0, cappedFrom: null };
  }

  const raw = round2((config.daysPerYear / config.divisor) * monthlyPay * years);
  const capped = config.cap > 0 && raw > config.cap;
  return {
    eligible: true,
    years,
    servedYears,
    servedMonths,
    amount: capped ? config.cap : raw,
    cappedFrom: capped ? raw : null,
  };
}

/**
 * Whole years and leftover months between two dates, inclusive of the last day.
 *
 * Inclusive because the last working day is a day worked — somebody who joined
 * on 1 January and leaves on 31 December served a year, not a year less a day.
 */
export function completedService(
  joinDate: string,
  lastWorkingDate: string,
): { servedYears: number; servedMonths: number } {
  if (lastWorkingDate < joinDate) return { servedYears: 0, servedMonths: 0 };

  // Measured to the day *after* the last working day, because that day was
  // worked: joining on 1 January and leaving on 31 December is a year served,
  // not a year less a day. Comparing against the last working day itself is an
  // off-by-one that costs somebody a month of gratuity.
  const dayAfter = addDays(lastWorkingDate, 1);

  let months = 0;
  // Walked in months rather than dividing days by 30.44: the latter drifts,
  // and drift near the five-year eligibility line is the difference between a
  // leaver being paid gratuity and not.
  while (addMonths(joinDate, months + 1) <= dayAfter) months++;

  return { servedYears: Math.floor(months / 12), servedMonths: months % 12 };
}

export interface TotalLine {
  kind: 'EARNING' | 'DEDUCTION';
  amount: number;
}

export interface SettlementTotals {
  totalEarnings: number;
  totalDeductions: number;
  netPayable: number;
}

/**
 * The three figures at the bottom of the statement.
 *
 * `netPayable` is allowed to be negative and is not clamped, unlike a payslip's
 * — a leaver whose notice recovery exceeds what they are owed genuinely owes
 * the company money, and hiding that behind a zero would mean the statement
 * disagreed with its own lines.
 */
export function settlementTotals(lines: TotalLine[]): SettlementTotals {
  const totalEarnings = round2(
    lines.filter((l) => l.kind === 'EARNING').reduce((sum, l) => sum + l.amount, 0),
  );
  const totalDeductions = round2(
    lines.filter((l) => l.kind === 'DEDUCTION').reduce((sum, l) => sum + l.amount, 0),
  );
  return { totalEarnings, totalDeductions, netPayable: round2(totalEarnings - totalDeductions) };
}
