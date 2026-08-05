import { addDays, weekdayOf } from '../../common/utils/calendar';

/**
 * The remote-work cap. Pure — no Prisma, no clock, everything passed in, the
 * way `leave.util.ts` and `lifecycle.rules.ts` are.
 *
 * This is the part somebody argues with. "You are over your two days" is a
 * refusal that has to be reproducible, and a function with no dependencies can
 * be reproduced in a test.
 */

/**
 * The first day of the week a date falls in, as a date key.
 *
 * Deliberately **not** ISO weeks. `weekStartsOn` is already an organization
 * setting, and a company whose week starts on Sunday would otherwise be told
 * its Sunday and Monday belong to different weeks — which is not what anybody
 * there means by "two days a week".
 */
export function weekKeyOf(dateKey: string, weekStartsOn: number): string {
  const offset = (weekdayOf(dateKey) - weekStartsOn + 7) % 7;
  return addDays(dateKey, -offset);
}

/** Their own allowance, or the company's. Null means the company's. */
export function effectiveWeeklyCap(
  employee: { remoteDaysPerWeek: number | null },
  defaults: { maxDaysPerWeek: number },
): number {
  return employee.remoteDaysPerWeek ?? defaults.maxDaysPerWeek;
}

export interface CapBreach {
  /** First day of the week that would be exceeded. */
  weekKey: string;
  /** Remote days that week would end up with. */
  would: number;
  cap: number;
}

/**
 * Which weeks a request would push past the cap, and by how much.
 *
 * Takes the days already approved so the answer accounts for what is booked —
 * asking for a Wednesday when Tuesday and Thursday are already agreed is the
 * case this exists for, and a check that only looked at the request would wave
 * it through.
 *
 * **Zero means zero days, not "no limit".** The gratuity ceiling uses zero as
 * a no-limit sentinel and this deliberately does not, because
 * `effectiveWeeklyCap` can return a real zero — "this person never works
 * remotely" is an ordinary arrangement. Two meanings for one value would have
 * handed exactly those people unlimited remote days. A company with no limit
 * sets seven, which is every day there is.
 *
 * Days appearing in both lists are counted once: an amended request is
 * re-checked against its own approved days, and double-counting them would
 * refuse an edit that changes nothing.
 */
export function capBreaches(
  requested: string[],
  alreadyApproved: string[],
  cap: number,
  weekStartsOn: number,
): CapBreach[] {
  const byWeek = new Map<string, Set<string>>();
  for (const dateKey of [...alreadyApproved, ...requested]) {
    const week = weekKeyOf(dateKey, weekStartsOn);
    const days = byWeek.get(week) ?? new Set<string>();
    days.add(dateKey);
    byWeek.set(week, days);
  }

  // Only weeks the request actually touches. A week already over its cap from
  // before is somebody else's problem to explain, not a reason to refuse a
  // request that does not add to it.
  const touched = new Set(requested.map((d) => weekKeyOf(d, weekStartsOn)));

  return [...byWeek.entries()]
    .filter(([week, days]) => touched.has(week) && days.size > cap)
    .map(([weekKey, days]) => ({ weekKey, would: days.size, cap }))
    .sort((a, b) => a.weekKey.localeCompare(b.weekKey));
}
