/**
 * Pure reporting maths — no Prisma, no I/O, fully unit-testable.
 */

/** Month key (YYYY-MM) for a date, used to bucket joiners and leavers. */
export function monthKeyOf(date: Date): string {
  return date.toISOString().slice(0, 7);
}

/** Inclusive list of YYYY-MM keys spanning two dates. */
export function monthKeysBetween(fromKey: string, toKey: string, maxMonths = 36): string[] {
  const keys: string[] = [];
  const [fy = '1970', fm = '01'] = fromKey.split('-');
  const cursor = new Date(Date.UTC(Number(fy), Number(fm) - 1, 1));
  const end = `${toKey.slice(0, 7)}`;
  while (keys.length < maxMonths) {
    const key = monthKeyOf(cursor);
    keys.push(key);
    if (key >= end) break;
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  return keys;
}

/**
 * Attrition rate as a percentage of the average headcount over the period —
 * the standard HR definition. Returns 0 rather than Infinity/NaN when there
 * was nobody to lose.
 */
export function attritionRate(exits: number, headcountStart: number, headcountEnd: number): number {
  const average = (headcountStart + headcountEnd) / 2;
  if (average <= 0) return 0;
  return Math.round((exits / average) * 1000) / 10;
}

export const TENURE_BUCKETS = [
  { label: '< 6 months', maxMonths: 6 },
  { label: '6–12 months', maxMonths: 12 },
  { label: '1–2 years', maxMonths: 24 },
  { label: '2–5 years', maxMonths: 60 },
  { label: '5+ years', maxMonths: Number.POSITIVE_INFINITY },
] as const;

/** Whole months between two dates (partial months do not count). */
export function tenureMonths(joinDate: Date, asOf: Date): number {
  let months =
    (asOf.getUTCFullYear() - joinDate.getUTCFullYear()) * 12 +
    (asOf.getUTCMonth() - joinDate.getUTCMonth());
  if (asOf.getUTCDate() < joinDate.getUTCDate()) months -= 1;
  return Math.max(0, months);
}

export function tenureBucket(months: number): string {
  const bucket = TENURE_BUCKETS.find((b) => months < b.maxMonths);
  return bucket?.label ?? TENURE_BUCKETS[TENURE_BUCKETS.length - 1].label;
}

/** Percentage helper that never divides by zero. */
export function percentage(part: number, whole: number): number {
  if (whole <= 0) return 0;
  return Math.round((part / whole) * 1000) / 10;
}
