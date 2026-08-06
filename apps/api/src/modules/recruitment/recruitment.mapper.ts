/**
 * Money out of this module is a number, not a Decimal.
 *
 * Prisma's `Decimal` serializes to JSON as a *string* — `"120000"` — because
 * that is the only lossless thing it can do. Every other money-carrying module
 * here converts before the wire (`payroll.mapper.ts`'s `toMoney`), and the web
 * side accordingly types salary as `number` and hands it straight to
 * `Intl.NumberFormat`. A string arriving where a number is declared does not
 * fail loudly; it formats as `NaN` or silently concatenates.
 *
 * These live here rather than being borrowed from payroll because that mapper
 * is payroll's own and returns `0` for a missing value, which is right for a
 * payslip line and wrong for an unset salary band — an opening with no band
 * advertised is not an opening that pays nothing.
 */

/** Two places, or null. Null and undefined both mean "not set", never zero. */
export function money(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

/** For the columns the schema makes required, where null cannot occur. */
function requiredMoney(value: unknown): number {
  return money(value) ?? 0;
}

/*
 * The generics keep whatever the caller `include`d — a mapped opening is still
 * an opening with its department and its counts, just with the band in a type
 * the receiver can do arithmetic on.
 */

export function mapOpening<T extends { minMonthlyCtc: unknown; maxMonthlyCtc: unknown }>(row: T) {
  return {
    ...row,
    minMonthlyCtc: money(row.minMonthlyCtc),
    maxMonthlyCtc: money(row.maxMonthlyCtc),
  };
}

export function mapCandidate<T extends { expectedMonthlyCtc: unknown }>(row: T) {
  return { ...row, expectedMonthlyCtc: money(row.expectedMonthlyCtc) };
}

export function mapOffer<T extends { monthlyCtc: unknown }>(row: T) {
  return { ...row, monthlyCtc: requiredMoney(row.monthlyCtc) };
}

/** An offer that may not exist — a candidate at the screening stage has none. */
export function mapMaybeOffer<T extends { monthlyCtc: unknown }>(row: T | null) {
  return row === null ? null : mapOffer(row);
}
