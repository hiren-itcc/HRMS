import { capBreaches, effectiveWeeklyCap, weekKeyOf } from './wfh.rules';

/** 2026-08-10 is a Monday. */
const MON = '2026-08-10';
const TUE = '2026-08-11';
const WED = '2026-08-12';
const THU = '2026-08-13';
const FRI = '2026-08-14';
const SUN = '2026-08-09';
/** The Monday of the following week. */
const NEXT_MON = '2026-08-17';

describe('weekKeyOf', () => {
  it('gives the Monday of the week when the week starts on Monday', () => {
    for (const day of [MON, TUE, WED, THU, FRI]) {
      expect(weekKeyOf(day, 1)).toBe(MON);
    }
  });

  it('starts a new week on the next Monday', () => {
    expect(weekKeyOf(NEXT_MON, 1)).toBe(NEXT_MON);
  });

  /*
   * Deliberately not ISO. A company whose week starts on Sunday would
   * otherwise be told its Sunday and Monday belong to different weeks, which
   * is not what anybody there means by "two days a week".
   */
  it('follows the organization week, not the ISO one', () => {
    // Sunday 9 Aug starts the week that Monday 10 Aug belongs to.
    expect(weekKeyOf(SUN, 0)).toBe(SUN);
    expect(weekKeyOf(MON, 0)).toBe(SUN);
    // With a Monday start, that Sunday belongs to the week before.
    expect(weekKeyOf(SUN, 1)).toBe('2026-08-03');
  });

  it('handles a week that spans a month boundary', () => {
    // 1 Sep 2026 is a Tuesday; its Monday is in August.
    expect(weekKeyOf('2026-09-01', 1)).toBe('2026-08-31');
  });
});

describe('effectiveWeeklyCap', () => {
  it('uses the company default when they have no allowance of their own', () => {
    expect(effectiveWeeklyCap({ remoteDaysPerWeek: null }, { maxDaysPerWeek: 2 })).toBe(2);
  });

  it('lets an individual arrangement win', () => {
    expect(effectiveWeeklyCap({ remoteDaysPerWeek: 5 }, { maxDaysPerWeek: 2 })).toBe(5);
  });

  /* Zero is a real allowance — never remote — not "unset". */
  it('treats a zero allowance as theirs, not as missing', () => {
    expect(effectiveWeeklyCap({ remoteDaysPerWeek: 0 }, { maxDaysPerWeek: 2 })).toBe(0);
  });
});

describe('capBreaches', () => {
  it('passes a request inside the cap', () => {
    expect(capBreaches([MON, TUE], [], 2, 1)).toEqual([]);
  });

  it('names the week and the count when a request goes over', () => {
    expect(capBreaches([MON, TUE, WED], [], 2, 1)).toEqual([{ weekKey: MON, would: 3, cap: 2 }]);
  });

  /*
   * The case this exists for. Asking for a Wednesday when Tuesday and Thursday
   * are already agreed is over the cap, and a check that looked only at the
   * request would wave it through.
   */
  it('counts days already approved that week', () => {
    expect(capBreaches([WED], [TUE, THU], 2, 1)).toEqual([{ weekKey: MON, would: 3, cap: 2 }]);
  });

  /*
   * An amended request is re-checked against days it already owns. Counting
   * them twice would refuse an edit that changes nothing.
   */
  it('counts a day appearing in both lists once', () => {
    expect(capBreaches([TUE, THU], [TUE, THU], 2, 1)).toEqual([]);
  });

  it('reports each week a range crosses, separately', () => {
    const breaches = capBreaches([MON, TUE, WED, NEXT_MON], [], 2, 1);
    expect(breaches).toEqual([{ weekKey: MON, would: 3, cap: 2 }]);
  });

  it('reports every offending week when more than one goes over', () => {
    const breaches = capBreaches([MON, TUE, WED, NEXT_MON, '2026-08-18', '2026-08-19'], [], 2, 1);
    expect(breaches.map((b) => b.weekKey)).toEqual([MON, NEXT_MON]);
  });

  /*
   * A week already over from before is somebody else's problem to explain, not
   * a reason to refuse a request that adds nothing to it.
   */
  it('ignores a week already over the cap that the request does not touch', () => {
    expect(capBreaches([NEXT_MON], [MON, TUE, WED], 2, 1)).toEqual([]);
  });

  /*
   * Zero means zero, not "no limit" — unlike the gratuity ceiling, and
   * deliberately so. `effectiveWeeklyCap` returns a real zero for somebody
   * whose arrangement is that they never work remotely, and reading that as
   * unlimited would have handed exactly those people every day of the week.
   */
  it('refuses any remote day at all when the cap is zero', () => {
    expect(capBreaches([MON], [], 0, 1)).toEqual([{ weekKey: MON, would: 1, cap: 0 }]);
  });

  /* No limit is seven, which is every day there is. */
  it('lets a whole week through when the cap is seven', () => {
    expect(capBreaches([MON, TUE, WED, THU, FRI], [], 7, 1)).toEqual([]);
  });
});
