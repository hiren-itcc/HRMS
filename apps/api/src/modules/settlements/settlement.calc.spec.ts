import { defaultSettings } from '@hrms/shared';
import {
  completedService,
  type EncashableBalance,
  encashmentLines,
  gratuityFor,
  noticeShortfallDays,
  perDayRate,
  settlementTotals,
} from './settlement.calc';

const GRATUITY = defaultSettings().settlement.gratuity;

describe('perDayRate', () => {
  it('divides by 26 on the statutory basis', () => {
    expect(perDayRate(52_000, '2026-09', 'DAYS_26')).toBe(2000);
  });

  it('divides by 30 on a calendar-day contract', () => {
    expect(perDayRate(60_000, '2026-09', 'DAYS_30')).toBe(2000);
  });

  /* The only basis that needs to know which month it is. */
  it('divides by the days that month actually had', () => {
    expect(perDayRate(31_000, '2026-01', 'CALENDAR_MONTH')).toBe(1000);
    expect(perDayRate(28_000, '2026-02', 'CALENDAR_MONTH')).toBe(1000);
    expect(perDayRate(29_000, '2028-02', 'CALENDAR_MONTH')).toBe(1000); // leap year
  });

  it('rounds to paise', () => {
    expect(perDayRate(50_000, '2026-09', 'DAYS_26')).toBe(1923.08);
  });
});

describe('encashmentLines', () => {
  const balance = (over: Partial<EncashableBalance>): EncashableBalance => ({
    leaveTypeId: 'lt1',
    code: 'EL',
    name: 'Earned leave',
    encashable: true,
    availableDays: 10,
    ...over,
  });

  it('prices each encashable balance at the day rate', () => {
    expect(encashmentLines([balance({ availableDays: 12.5 })], 2000)).toEqual([
      { leaveTypeId: 'lt1', code: 'EL', name: 'Earned leave', days: 12.5, amount: 25_000 },
    ]);
  });

  it('produces one line per type, not one lumped line', () => {
    const lines = encashmentLines(
      [balance({ leaveTypeId: 'a', code: 'EL' }), balance({ leaveTypeId: 'b', code: 'CL' })],
      1000,
    );
    expect(lines.map((l) => l.code)).toEqual(['EL', 'CL']);
  });

  it('skips types nobody marked encashable', () => {
    expect(encashmentLines([balance({ encashable: false })], 2000)).toEqual([]);
  });

  /*
   * A zero line is noise on a document somebody reads once, and a negative
   * balance is leave taken but not accrued — a deduction payroll already made.
   */
  it('skips empty and negative balances rather than printing them', () => {
    expect(encashmentLines([balance({ availableDays: 0 })], 2000)).toEqual([]);
    expect(encashmentLines([balance({ availableDays: -3 })], 2000)).toEqual([]);
  });
});

describe('noticeShortfallDays', () => {
  it('counts the days they left early', () => {
    expect(noticeShortfallDays('2026-09-16', '2026-10-04')).toBe(18);
  });

  it('is zero when they served their notice, and never negative', () => {
    expect(noticeShortfallDays('2026-10-04', '2026-10-04')).toBe(0);
    expect(noticeShortfallDays('2026-11-01', '2026-10-04')).toBe(0);
  });

  /*
   * The asymmetry that matters. A company ending somebody's employment owes
   * them notice; it does not recover it. A null earliest date is how a
   * termination, a contract ending or a retirement says there was no
   * resignation behind this exit.
   */
  it('is zero for an exit the employee did not choose', () => {
    expect(noticeShortfallDays('2026-09-16', null)).toBe(0);
  });
});

describe('completedService', () => {
  it('counts a full year inclusive of the last working day', () => {
    // Joined 1 Jan, left 31 Dec — a year served, not a year less a day.
    expect(completedService('2025-01-01', '2025-12-31')).toEqual({
      servedYears: 1,
      servedMonths: 0,
    });
  });

  it('counts whole years and leftover months', () => {
    expect(completedService('2020-04-01', '2026-09-30')).toEqual({
      servedYears: 6,
      servedMonths: 6,
    });
  });

  it('is zero when the exit predates the join', () => {
    expect(completedService('2026-01-01', '2025-12-01')).toEqual({
      servedYears: 0,
      servedMonths: 0,
    });
  });

  /* Month arithmetic, not days ÷ 30.44 — drift near the eligibility line is
     the difference between being paid gratuity and not. */
  it('does not drift across a leap year', () => {
    expect(completedService('2024-02-29', '2029-02-28').servedYears).toBe(5);
  });
});

describe('gratuityFor', () => {
  it('is 15/26 of a month per year of service', () => {
    // 15/26 × 52,000 × 6 = 180,000
    const result = gratuityFor('2020-08-01', '2026-07-31', 52_000, GRATUITY);
    expect(result.eligible).toBe(true);
    expect(result.years).toBe(6);
    expect(result.amount).toBe(180_000);
  });

  it('pays nothing below the minimum service', () => {
    const result = gratuityFor('2023-01-01', '2026-09-30', 52_000, GRATUITY);
    expect(result.eligible).toBe(false);
    expect(result.amount).toBe(0);
  });

  /*
   * The Act rounds a part-year over six months up. Rounding it down would
   * quietly underpay everyone who left in the second half of their year.
   */
  it('rounds a part-year over six months up, and exactly six down', () => {
    expect(gratuityFor('2019-01-01', '2026-08-31', 52_000, GRATUITY).years).toBe(8);
    // 1 Jan 2019 → 30 Jun 2026 is 7 years and exactly 6 months.
    expect(gratuityFor('2019-01-01', '2026-06-30', 52_000, GRATUITY).years).toBe(7);
  });

  it('applies the statutory ceiling and says where it came from', () => {
    const result = gratuityFor('1996-01-01', '2026-09-30', 500_000, GRATUITY);
    expect(result.amount).toBe(2_000_000);
    expect(result.cappedFrom).toBeGreaterThan(2_000_000);
  });

  it('has no ceiling when the cap is zero', () => {
    const result = gratuityFor('1996-01-01', '2026-09-30', 500_000, { ...GRATUITY, cap: 0 });
    expect(result.amount).toBeGreaterThan(2_000_000);
    expect(result.cappedFrom).toBeNull();
  });

  it('pays nothing when the organization has gratuity switched off', () => {
    const result = gratuityFor('2010-01-01', '2026-09-30', 52_000, {
      ...GRATUITY,
      enabled: false,
    });
    expect(result.eligible).toBe(false);
    expect(result.amount).toBe(0);
  });

  it('pays nothing when no salary could be resolved', () => {
    expect(gratuityFor('2010-01-01', '2026-09-30', 0, GRATUITY).eligible).toBe(false);
  });
});

describe('settlementTotals', () => {
  it('nets deductions against earnings', () => {
    expect(
      settlementTotals([
        { kind: 'EARNING', amount: 30_000 },
        { kind: 'EARNING', amount: 67_300 },
        { kind: 'DEDUCTION', amount: 12_000 },
      ]),
    ).toEqual({ totalEarnings: 97_300, totalDeductions: 12_000, netPayable: 85_300 });
  });

  /*
   * Deliberately not clamped, unlike a payslip's net. Somebody whose notice
   * recovery exceeds what they are owed genuinely owes the company, and a zero
   * would make the total disagree with the lines above it.
   */
  it('lets the net go negative when they owe more than they are owed', () => {
    expect(
      settlementTotals([
        { kind: 'EARNING', amount: 5_000 },
        { kind: 'DEDUCTION', amount: 43_200 },
      ]).netPayable,
    ).toBe(-38_200);
  });

  it('is zero for an empty settlement', () => {
    expect(settlementTotals([])).toEqual({
      totalEarnings: 0,
      totalDeductions: 0,
      netPayable: 0,
    });
  });
});
