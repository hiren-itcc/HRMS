/**
 * Financial-year and quarter arithmetic for TDS returns.
 *
 * No Prisma and no clock, the same rule `payroll.statutory.ts` follows. "Which
 * quarter is it now" is a question for the caller; everything here is a pure
 * function of a month key, so a return regenerated in December for Q1 produces
 * the same answer it did in July.
 *
 * The Indian financial year runs April to March. A month key is `YYYY-MM`,
 * matching `PayrollRun.month`; a financial year is `YYYY-YY`, e.g. `2026-27`.
 */

export type TdsQuarterCode = 'Q1' | 'Q2' | 'Q3' | 'Q4';

/** Quarter -> the months it covers, as offsets from April. */
const QUARTER_OFFSETS: Record<TdsQuarterCode, number[]> = {
  Q1: [0, 1, 2], // Apr May Jun
  Q2: [3, 4, 5], // Jul Aug Sep
  Q3: [6, 7, 8], // Oct Nov Dec
  Q4: [9, 10, 11], // Jan Feb Mar
};

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

/** `2026-27` is a financial year; `2026-28` and `2026` are not. */
export function isFinancialYear(value: string): boolean {
  const match = /^(\d{4})-(\d{2})$/.exec(value);
  if (!match) return false;
  const start = Number(match[1]);
  // The second half is the last two digits of start + 1, so 2026-27 and,
  // at the century boundary, 2099-00.
  return Number(match[2]) === (start + 1) % 100;
}

export function financialYearOf(month: string): string {
  const { year, month: monthNumber } = parseMonth(month);
  const startYear = monthNumber >= 4 ? year : year - 1;
  return `${startYear}-${String((startYear + 1) % 100).padStart(2, '0')}`;
}

export function quarterOf(month: string): TdsQuarterCode {
  const { month: monthNumber } = parseMonth(month);
  // Months since April, 0-11.
  const offset = (monthNumber - 4 + 12) % 12;
  const found = (Object.keys(QUARTER_OFFSETS) as TdsQuarterCode[]).find((quarter) =>
    QUARTER_OFFSETS[quarter].includes(offset),
  );
  // Unreachable: offset is always 0-11 and the table covers all twelve.
  if (!found) throw new Error(`No quarter covers ${month}`);
  return found;
}

/** The three month keys a quarter covers, ascending. */
export function monthsIn(financialYear: string, quarter: TdsQuarterCode): string[] {
  if (!isFinancialYear(financialYear)) {
    throw new Error(`Not a financial year: ${financialYear}. Expected a form like 2026-27.`);
  }
  const startYear = Number(financialYear.slice(0, 4));
  return QUARTER_OFFSETS[quarter].map((offset) => {
    const absolute = 3 + offset; // April is calendar month 4, offset 0.
    const year = startYear + Math.floor(absolute / 12);
    const month = (absolute % 12) + 1;
    return `${year}-${String(month).padStart(2, '0')}`;
  });
}
