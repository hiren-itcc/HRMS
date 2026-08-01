/**
 * Decimal → number at the API edge.
 *
 * Prisma serialises Decimal as a string, which would reach the browser as
 * `"24000"` and quietly break every arithmetic and every chart. Converting
 * here, once, keeps the rest of the module in numbers.
 */

/** Money carries two decimal places; anything else is a rounding artefact. */
export function toMoney(value: unknown): number {
  return Math.round((Number(value ?? 0) + Number.EPSILON) * 100) / 100;
}

/** Day counts carry two places so a half day survives. */
export function toDays(value: unknown): number {
  return Math.round((Number(value ?? 0) + Number.EPSILON) * 100) / 100;
}

export function toDateKey(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  return value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);
}

/**
 * An account number never leaves the API in full.
 *
 * The payslip and the bank report both need enough to identify the account
 * without being a leak if a payslip is forwarded or a report is emailed.
 */
export function maskAccount(accountNumber: string | null | undefined): string | null {
  if (!accountNumber) return null;
  const trimmed = accountNumber.trim();
  if (trimmed.length <= 4) return '••••';
  return `••••${trimmed.slice(-4)}`;
}
