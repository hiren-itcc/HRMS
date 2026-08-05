import { toDate } from '../../common/utils/calendar';
import {
  earliestLastWorkingDate,
  effectiveNoticeDays,
  effectiveProbationEnd,
  type LifecycleFields,
  probationEndFor,
  probationStateOf,
} from './lifecycle.rules';

const DEFAULTS = { defaultNoticeDays: 30, defaultProbationMonths: 3 };
const TODAY = '2026-08-05';

function employee(over: Partial<LifecycleFields> = {}): LifecycleFields {
  return {
    joinDate: toDate('2026-06-01'),
    probationMonths: null,
    probationEndDate: toDate('2026-09-01'),
    probationExtendedTo: null,
    confirmedOn: null,
    noticePeriodDays: null,
    ...over,
  };
}

describe('probationEndFor', () => {
  it('uses the org default when the employee has no override', () => {
    expect(probationEndFor('2026-08-05', null, DEFAULTS)).toBe('2026-11-05');
  });

  it('prefers the per-employee override', () => {
    expect(probationEndFor('2026-08-05', 6, DEFAULTS)).toBe('2027-02-05');
  });

  it('clamps a month-end join date instead of overshooting', () => {
    expect(probationEndFor('2026-01-31', 3, DEFAULTS)).toBe('2026-04-30');
  });

  it('returns null for zero months, so "no probation" is a real answer', () => {
    expect(probationEndFor('2026-08-05', 0, DEFAULTS)).toBeNull();
    expect(
      probationEndFor('2026-08-05', null, { ...DEFAULTS, defaultProbationMonths: 0 }),
    ).toBeNull();
  });
});

describe('effectiveProbationEnd', () => {
  it('is the stored end when there is no extension', () => {
    expect(effectiveProbationEnd(employee())).toBe('2026-09-01');
  });

  it('is superseded by an extension', () => {
    expect(effectiveProbationEnd(employee({ probationExtendedTo: toDate('2026-12-01') }))).toBe(
      '2026-12-01',
    );
  });
});

describe('probationStateOf', () => {
  it('is PROBATION with days remaining while it is still running', () => {
    const view = probationStateOf(employee(), TODAY);
    expect(view.state).toBe('PROBATION');
    expect(view.endDate).toBe('2026-09-01');
    expect(view.daysRemaining).toBe(27);
    expect(view.isOverdue).toBe(false);
  });

  it('is EXTENDED once an extension exists, and keeps the original date', () => {
    const view = probationStateOf(employee({ probationExtendedTo: toDate('2026-12-01') }), TODAY);
    expect(view.state).toBe('EXTENDED');
    expect(view.endDate).toBe('2026-12-01');
    expect(view.originalEndDate).toBe('2026-09-01');
  });

  it('is CONFIRMED once confirmedOn is set, whatever the dates say', () => {
    const view = probationStateOf(
      employee({ probationEndDate: toDate('2026-01-01'), confirmedOn: toDate('2026-07-01') }),
      TODAY,
    );
    expect(view.state).toBe('CONFIRMED');
    expect(view.isOverdue).toBe(false);
  });

  it('is NONE when nobody was ever put on probation', () => {
    const view = probationStateOf(employee({ probationEndDate: null }), TODAY);
    expect(view.state).toBe('NONE');
    expect(view.endDate).toBeNull();
    expect(view.daysRemaining).toBeNull();
  });

  it('is not overdue on the end date itself — that is the last day of probation', () => {
    const view = probationStateOf(employee({ probationEndDate: toDate(TODAY) }), TODAY);
    expect(view.daysRemaining).toBe(0);
    expect(view.isOverdue).toBe(false);
  });

  it('is overdue the day after, and reports how far past', () => {
    const view = probationStateOf(employee({ probationEndDate: toDate('2026-07-31') }), TODAY);
    expect(view.isOverdue).toBe(true);
    expect(view.daysRemaining).toBe(-5);
  });

  it('an extension pushes an overdue probation back into range', () => {
    const view = probationStateOf(
      employee({
        probationEndDate: toDate('2026-07-31'),
        probationExtendedTo: toDate('2026-10-31'),
      }),
      TODAY,
    );
    expect(view.state).toBe('EXTENDED');
    expect(view.isOverdue).toBe(false);
  });
});

describe('notice period', () => {
  it('falls back to the org default and prefers an override', () => {
    expect(effectiveNoticeDays({ noticePeriodDays: null }, DEFAULTS)).toBe(30);
    expect(effectiveNoticeDays({ noticePeriodDays: 90 }, DEFAULTS)).toBe(90);
  });

  it('honours a zero-day override rather than treating it as unset', () => {
    expect(effectiveNoticeDays({ noticePeriodDays: 0 }, DEFAULTS)).toBe(0);
  });

  it('counts calendar days forward from the day it is filed', () => {
    expect(earliestLastWorkingDate('2026-08-05', 30)).toBe('2026-09-04');
    expect(earliestLastWorkingDate('2026-08-05', 0)).toBe('2026-08-05');
  });
});
