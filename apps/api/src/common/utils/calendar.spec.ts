import {
  addDays,
  addMonths,
  daysBetween,
  displayDate,
  isWeekend,
  leaveYearOf,
  WEEKEND_DAYS,
} from './calendar';

// August 2026: 1st is a Saturday, 2nd a Sunday, 3rd a Monday.
const SAT = '2026-08-01';
const SUN = '2026-08-02';
const MON = '2026-08-03';

describe('isWeekend', () => {
  it('defaults to Saturday and Sunday when no policy is passed', () => {
    expect(isWeekend(SAT)).toBe(true);
    expect(isWeekend(SUN)).toBe(true);
    expect(isWeekend(MON)).toBe(false);
  });

  it('treats Saturday as a working day for a six-day week', () => {
    const sixDayWeek = [0];
    expect(isWeekend(SAT, sixDayWeek)).toBe(false);
    expect(isWeekend(SUN, sixDayWeek)).toBe(true);
  });

  it('supports a Friday–Saturday weekend', () => {
    const friSat = [5, 6];
    expect(isWeekend('2026-08-07', friSat)).toBe(true); // Friday
    expect(isWeekend(SAT, friSat)).toBe(true);
    expect(isWeekend(SUN, friSat)).toBe(false);
  });

  it('treats every day as working when no week-off day is configured', () => {
    expect(isWeekend(SAT, [])).toBe(false);
    expect(isWeekend(SUN, [])).toBe(false);
  });

  it('still exports the default constant for callers with no settings', () => {
    expect(WEEKEND_DAYS).toEqual([0, 6]);
  });
});

describe('leaveYearOf', () => {
  it('is the calendar year by default', () => {
    expect(leaveYearOf('2026-01-01')).toBe(2026);
    expect(leaveYearOf('2026-12-31')).toBe(2026);
  });

  it('puts January–March in the previous year for an April start', () => {
    expect(leaveYearOf('2026-03-31', 4)).toBe(2025);
    expect(leaveYearOf('2026-01-15', 4)).toBe(2025);
  });

  it('rolls to the new year on the start month', () => {
    expect(leaveYearOf('2026-04-01', 4)).toBe(2026);
    expect(leaveYearOf('2026-12-31', 4)).toBe(2026);
  });

  it('handles a December start, where only December belongs to the new year', () => {
    expect(leaveYearOf('2026-12-01', 12)).toBe(2026);
    expect(leaveYearOf('2026-11-30', 12)).toBe(2025);
  });
});

describe('addMonths', () => {
  it('keeps the day of the month when the target month is long enough', () => {
    expect(addMonths('2026-08-05', 3)).toBe('2026-11-05');
    expect(addMonths('2026-01-01', 6)).toBe('2026-07-01');
  });

  it('clamps to the last day rather than rolling into the next month', () => {
    // The one that matters: three months of probation from 31 January.
    expect(addMonths('2026-01-31', 3)).toBe('2026-04-30');
    expect(addMonths('2026-08-31', 6)).toBe('2027-02-28');
    expect(addMonths('2028-08-31', 6)).toBe('2029-02-28');
  });

  it('lands on 29 February in a leap year', () => {
    expect(addMonths('2027-11-29', 3)).toBe('2028-02-29');
  });

  it('crosses the year boundary in both directions', () => {
    expect(addMonths('2026-11-15', 3)).toBe('2027-02-15');
    expect(addMonths('2026-02-15', -3)).toBe('2025-11-15');
  });

  it('is a no-op for zero months', () => {
    expect(addMonths('2026-08-05', 0)).toBe('2026-08-05');
  });
});

describe('addDays', () => {
  it('moves forwards and backwards across a month boundary', () => {
    expect(addDays('2026-08-05', 30)).toBe('2026-09-04');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('is a no-op for zero days', () => {
    expect(addDays('2026-08-05', 0)).toBe('2026-08-05');
  });
});

describe('daysBetween', () => {
  it('counts whole days, signed', () => {
    expect(daysBetween('2026-08-05', '2026-09-04')).toBe(30);
    expect(daysBetween('2026-09-04', '2026-08-05')).toBe(-30);
    expect(daysBetween('2026-08-05', '2026-08-05')).toBe(0);
  });
});

describe('displayDate', () => {
  it('renders the way the web does', () => {
    // "Sept", not "Sep" — that is CLDR's short form for en, and the web takes
    // its month names from the same data. Pinned because the point of the
    // helper is that the two agree.
    expect(displayDate('2026-09-30')).toBe('30 Sept 2026');
    expect(displayDate('2026-01-01')).toBe('1 Jan 2026');
  });

  it('does not drift a day on a machine behind UTC', () => {
    expect(displayDate('2026-03-01')).toBe('1 Mar 2026');
  });
});
