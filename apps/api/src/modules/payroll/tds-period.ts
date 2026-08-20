/**
 * Financial-year arithmetic for the income-tax projection.
 *
 * No Prisma and no clock, the same rule `payroll.statutory.ts` follows. "Which
 * financial year is it now" is a question for the caller; everything here is a
 * pure function of a month key, so a projection recomputed in December for an
 * April month produces the same answer it did in July.
 *
 * The Indian financial year runs April to March. A month key is `YYYY-MM`,
 * matching `PayrollRun.month`; a financial year is `YYYY-YY`, e.g. `2026-27`.
 */

function parseMonth(month: string): { year: number; month: number } {
  const match = /^(\d{4})-(\d{2})$/.exec(month);
  if (!match) throw new Error(`Not a YYYY-MM month key: ${month}`);
  const year = Number(match[1]);
  const monthNumber = Number(match[2]);
  if (monthNumber < 1 || monthNumber > 12) {
    throw new Error(`Not a calendar month: ${month}`);
  }
  return { year, month: monthNumber };
}

export function financialYearOf(month: string): string {
  const { year, month: monthNumber } = parseMonth(month);
  const startYear = monthNumber >= 4 ? year : year - 1;
  return `${startYear}-${String((startYear + 1) % 100).padStart(2, '0')}`;
}
