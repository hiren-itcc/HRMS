import {
  dateKeyInTz,
  daysInMonth,
  deriveDayStatus,
  halfDayThresholdMinutes,
  instantFromLocal,
  isLateArrival,
  rollUpSessions,
  shiftDurationMinutes,
  statusForWorkedMinutes,
  timeInTz,
  weekdayOf,
  workedMinutesBetween,
} from './attendance.util';

const GENERAL = { startTime: '09:00', endTime: '18:00', graceMinutes: 15 };

describe('timezone helpers', () => {
  it('resolves the local calendar date, not the UTC one', () => {
    // 2026-08-01 20:30 UTC is already 2026-08-02 in Kolkata (+5:30)
    const instant = new Date('2026-08-01T20:30:00.000Z');
    expect(dateKeyInTz(instant, 'UTC')).toBe('2026-08-01');
    expect(dateKeyInTz(instant, 'Asia/Kolkata')).toBe('2026-08-02');
  });

  it('formats wall-clock time in the target zone', () => {
    const instant = new Date('2026-08-01T03:45:00.000Z');
    expect(timeInTz(instant, 'UTC')).toBe('03:45');
    expect(timeInTz(instant, 'Asia/Kolkata')).toBe('09:15');
  });
});

describe('instantFromLocal', () => {
  it('converts a local wall clock to the right UTC instant (ahead of UTC)', () => {
    expect(instantFromLocal('2026-08-01', '09:00', 'Asia/Kolkata').toISOString()).toBe(
      '2026-08-01T03:30:00.000Z',
    );
  });

  it('converts for a zone behind UTC, honouring DST', () => {
    // August = EDT (UTC-4)
    expect(instantFromLocal('2026-08-01', '09:00', 'America/New_York').toISOString()).toBe(
      '2026-08-01T13:00:00.000Z',
    );
    // January = EST (UTC-5)
    expect(instantFromLocal('2026-01-15', '09:00', 'America/New_York').toISOString()).toBe(
      '2026-01-15T14:00:00.000Z',
    );
  });

  it('round-trips with dateKeyInTz/timeInTz', () => {
    const instant = instantFromLocal('2026-08-01', '23:45', 'Asia/Kolkata');
    expect(dateKeyInTz(instant, 'Asia/Kolkata')).toBe('2026-08-01');
    expect(timeInTz(instant, 'Asia/Kolkata')).toBe('23:45');
  });

  it('handles midnight without rendering 24:00', () => {
    const instant = instantFromLocal('2026-08-01', '00:00', 'Asia/Kolkata');
    expect(timeInTz(instant, 'Asia/Kolkata')).toBe('00:00');
  });
});

describe('isLateArrival', () => {
  it('is not late inside the grace window', () => {
    // 09:15 Kolkata = exactly start + grace
    expect(isLateArrival(new Date('2026-08-01T03:45:00.000Z'), 'Asia/Kolkata', GENERAL)).toBe(
      false,
    );
  });

  it('is late one minute past the grace window', () => {
    expect(isLateArrival(new Date('2026-08-01T03:46:00.000Z'), 'Asia/Kolkata', GENERAL)).toBe(true);
  });

  it('is never late without an assigned shift', () => {
    expect(isLateArrival(new Date('2026-08-01T18:00:00.000Z'), 'Asia/Kolkata', null)).toBe(false);
  });
});

describe('shift duration & half day', () => {
  it('measures a normal shift', () => {
    expect(shiftDurationMinutes(GENERAL)).toBe(540);
    expect(halfDayThresholdMinutes(GENERAL)).toBe(270);
  });

  it('measures an overnight shift across midnight', () => {
    expect(shiftDurationMinutes({ startTime: '22:00', endTime: '06:00', graceMinutes: 0 })).toBe(
      480,
    );
  });

  it('classifies worked minutes around the threshold', () => {
    expect(statusForWorkedMinutes(269, GENERAL)).toBe('HALF_DAY');
    expect(statusForWorkedMinutes(270, GENERAL)).toBe('PRESENT');
  });

  it('never returns negative worked minutes', () => {
    const t = new Date('2026-08-01T10:00:00.000Z');
    expect(workedMinutesBetween(t, new Date('2026-08-01T09:00:00.000Z'))).toBe(0);
    expect(workedMinutesBetween(t, new Date('2026-08-01T12:30:00.000Z'))).toBe(150);
  });
});

describe('rollUpSessions', () => {
  const on = (hhmm: string) => new Date(`2026-08-05T${hhmm}:00.000Z`);
  const session = (from: string, to: string | null) => ({
    checkIn: on(from),
    checkOut: to ? on(to) : null,
  });

  it('has nothing to report for a day with no sessions', () => {
    const roll = rollUpSessions([], GENERAL);
    expect(roll.checkIn).toBeNull();
    expect(roll.checkOut).toBeNull();
    expect(roll.workMinutes).toBeNull();
    expect(roll.openSession).toBeNull();
  });

  it('spans the first check-in to the last check-out', () => {
    const roll = rollUpSessions([session('09:00', '13:00'), session('14:00', '18:00')], GENERAL);
    expect(roll.checkIn).toEqual(on('09:00'));
    expect(roll.checkOut).toEqual(on('18:00'));
  });

  it('sums the sessions rather than the span, so the lunch gap is not paid', () => {
    const roll = rollUpSessions([session('09:00', '13:00'), session('14:00', '18:00')], GENERAL);
    expect(roll.workMinutes).toBe(8 * 60);
  });

  it('orders sessions by check-in however they arrive', () => {
    const roll = rollUpSessions([session('14:00', '18:00'), session('09:00', '13:00')], GENERAL);
    expect(roll.checkIn).toEqual(on('09:00'));
    expect(roll.sessions[0]?.checkIn).toEqual(on('09:00'));
  });

  it('leaves check-out null while a session is open, so "still in" stays a null check', () => {
    const roll = rollUpSessions([session('09:00', '13:00'), session('14:00', null)], GENERAL);
    expect(roll.checkOut).toBeNull();
    expect(roll.openSession?.checkIn).toEqual(on('14:00'));
  });

  it('counts only closed sessions — the running one is banked when it ends', () => {
    const roll = rollUpSessions([session('09:00', '13:00'), session('14:00', null)], GENERAL);
    expect(roll.workMinutes).toBe(4 * 60);
  });

  it('does not judge a day still in progress', () => {
    // The three-second mis-tap that used to freeze a whole day at HALF_DAY.
    const roll = rollUpSessions([session('09:00', '09:00'), session('09:01', null)], GENERAL);
    expect(roll.workedStatus).toBe('PRESENT');
  });

  it('calls a finished short day a half day', () => {
    const roll = rollUpSessions([session('09:00', '11:00')], GENERAL);
    expect(roll.workedStatus).toBe('HALF_DAY');
  });

  it('adds split sittings up to a full day', () => {
    // Neither half clears the 270-minute threshold on its own.
    const roll = rollUpSessions([session('09:00', '13:00'), session('14:00', '19:00')], GENERAL);
    expect(roll.workedStatus).toBe('PRESENT');
  });
});

describe('deriveDayStatus', () => {
  const todayKey = '2026-08-05'; // Wednesday

  it('uses the record status when one exists', () => {
    expect(
      deriveDayStatus({
        dateKey: '2026-08-03',
        todayKey,
        record: { status: 'HALF_DAY' },
        isHoliday: false,
      }),
    ).toBe('HALF_DAY');
  });

  it('marks a past unmarked workday absent', () => {
    expect(
      deriveDayStatus({ dateKey: '2026-08-03', todayKey, record: null, isHoliday: false }),
    ).toBe('ABSENT');
  });

  it('marks today unmarked rather than absent', () => {
    expect(deriveDayStatus({ dateKey: todayKey, todayKey, record: null, isHoliday: false })).toBe(
      'NOT_MARKED',
    );
  });

  it('never marks future days', () => {
    expect(
      deriveDayStatus({ dateKey: '2026-08-20', todayKey, record: null, isHoliday: false }),
    ).toBe('FUTURE');
  });

  it('prefers holiday over weekend and absent', () => {
    expect(
      deriveDayStatus({ dateKey: '2026-08-03', todayKey, record: null, isHoliday: true }),
    ).toBe('HOLIDAY');
  });

  it('shows approved leave, including leave still in the future', () => {
    expect(
      deriveDayStatus({
        dateKey: '2026-08-20',
        todayKey,
        record: null,
        isHoliday: false,
        isOnLeave: true,
      }),
    ).toBe('ON_LEAVE');
    expect(
      deriveDayStatus({
        dateKey: '2026-08-03',
        todayKey,
        record: null,
        isHoliday: false,
        isOnLeave: true,
      }),
    ).toBe('ON_LEAVE');
  });

  it('keeps holidays and weekends ahead of leave inside a leave range', () => {
    expect(
      deriveDayStatus({
        dateKey: '2026-08-08', // Saturday
        todayKey,
        record: null,
        isHoliday: false,
        isOnLeave: true,
      }),
    ).toBe('WEEK_OFF');
    expect(
      deriveDayStatus({
        dateKey: '2026-08-06',
        todayKey,
        record: null,
        isHoliday: true,
        isOnLeave: true,
      }),
    ).toBe('HOLIDAY');
  });

  it('never marks days before joining as absent', () => {
    expect(
      deriveDayStatus({
        dateKey: '2026-08-03',
        todayKey,
        record: null,
        isHoliday: false,
        employment: { joinDate: '2026-08-04', exitDate: null },
      }),
    ).toBe('NOT_EMPLOYED');
  });

  it('never marks days after leaving as absent', () => {
    expect(
      deriveDayStatus({
        dateKey: '2026-08-04',
        todayKey,
        record: null,
        isHoliday: false,
        employment: { joinDate: '2026-01-01', exitDate: '2026-08-03' },
      }),
    ).toBe('NOT_EMPLOYED');
  });

  it('still counts absences inside the employment window', () => {
    expect(
      deriveDayStatus({
        dateKey: '2026-08-03',
        todayKey,
        record: null,
        isHoliday: false,
        employment: { joinDate: '2026-08-01', exitDate: null },
      }),
    ).toBe('ABSENT');
  });

  it('shows an existing record even outside the employment window', () => {
    expect(
      deriveDayStatus({
        dateKey: '2026-07-30',
        todayKey,
        record: { status: 'PRESENT' },
        isHoliday: false,
        employment: { joinDate: '2026-08-01', exitDate: null },
      }),
    ).toBe('PRESENT');
  });

  it('marks weekends as week off', () => {
    // 2026-08-01 is a Saturday, 2026-08-02 a Sunday
    expect(weekdayOf('2026-08-01')).toBe(6);
    expect(
      deriveDayStatus({ dateKey: '2026-08-02', todayKey, record: null, isHoliday: false }),
    ).toBe('WEEK_OFF');
  });
});

describe('daysInMonth', () => {
  it('handles 31, 30 and leap-February months', () => {
    expect(daysInMonth('2026-08')).toHaveLength(31);
    expect(daysInMonth('2026-09')).toHaveLength(30);
    expect(daysInMonth('2026-02')).toHaveLength(28);
    expect(daysInMonth('2028-02')).toHaveLength(29);
    expect(daysInMonth('2026-08')[0]).toBe('2026-08-01');
  });
});
