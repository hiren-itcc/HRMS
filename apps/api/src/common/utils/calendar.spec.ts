import { isWeekend, leaveYearOf, WEEKEND_DAYS } from './calendar';

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
