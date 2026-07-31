import { availableDays, calculateLeaveDays, canEmployeeCancel, round1 } from './leave.util';

const noHolidays = new Set<string>();

describe('calculateLeaveDays', () => {
  it('counts a plain weekday range', () => {
    // Mon 2026-08-03 → Wed 2026-08-05
    const result = calculateLeaveDays('2026-08-03', '2026-08-05', noHolidays);
    expect(result.days).toBe(3);
    expect(result.workingDays).toHaveLength(3);
    expect(result.skipped).toHaveLength(0);
  });

  it('never charges for weekends inside the range', () => {
    // Fri 2026-08-07 → Mon 2026-08-10 spans Sat+Sun
    const result = calculateLeaveDays('2026-08-07', '2026-08-10', noHolidays);
    expect(result.days).toBe(2);
    expect(result.skipped).toEqual(['2026-08-08', '2026-08-09']);
  });

  it('never charges for holidays inside the range', () => {
    const result = calculateLeaveDays('2026-08-03', '2026-08-05', new Set(['2026-08-04']));
    expect(result.days).toBe(2);
    expect(result.skipped).toEqual(['2026-08-04']);
  });

  it('charges half a day for a single-day half request', () => {
    expect(calculateLeaveDays('2026-08-03', '2026-08-03', noHolidays, 'FIRST_HALF').days).toBe(0.5);
  });

  it('ignores the half-day flag on multi-day ranges', () => {
    expect(calculateLeaveDays('2026-08-03', '2026-08-05', noHolidays, 'FIRST_HALF').days).toBe(3);
  });

  it('charges nothing for a weekend-only request', () => {
    const result = calculateLeaveDays('2026-08-08', '2026-08-09', noHolidays);
    expect(result.days).toBe(0);
    expect(result.workingDays).toHaveLength(0);
  });

  it('charges nothing for a half day taken on a holiday', () => {
    const result = calculateLeaveDays(
      '2026-08-03',
      '2026-08-03',
      new Set(['2026-08-03']),
      'SECOND_HALF',
    );
    expect(result.days).toBe(0);
  });
});

describe('availableDays', () => {
  it('adds carry-forward and subtracts what is used', () => {
    expect(availableDays({ allocated: 12, carriedOver: 3, used: 4.5 })).toBe(10.5);
  });

  it('keeps decimals clean after repeated half days', () => {
    expect(availableDays({ allocated: 12, carriedOver: 0, used: 0.1 + 0.2 })).toBe(11.7);
    expect(round1(0.1 + 0.2)).toBe(0.3);
  });

  it('can go negative when HR grants leave beyond the allocation', () => {
    expect(availableDays({ allocated: 1, carriedOver: 0, used: 2 })).toBe(-1);
  });
});

describe('canEmployeeCancel', () => {
  const today = '2026-08-05';

  it('always allows withdrawing a pending request', () => {
    expect(canEmployeeCancel({ status: 'PENDING', startDate: '2026-08-01' }, today)).toBe(true);
  });

  it('allows cancelling approved leave that has not started', () => {
    expect(canEmployeeCancel({ status: 'APPROVED', startDate: '2026-08-06' }, today)).toBe(true);
  });

  it('blocks cancelling approved leave already under way', () => {
    expect(canEmployeeCancel({ status: 'APPROVED', startDate: today }, today)).toBe(false);
    expect(canEmployeeCancel({ status: 'APPROVED', startDate: '2026-08-01' }, today)).toBe(false);
  });

  it('blocks re-cancelling a rejected or cancelled request', () => {
    expect(canEmployeeCancel({ status: 'REJECTED', startDate: '2026-09-01' }, today)).toBe(false);
    expect(canEmployeeCancel({ status: 'CANCELLED', startDate: '2026-09-01' }, today)).toBe(false);
  });
});
