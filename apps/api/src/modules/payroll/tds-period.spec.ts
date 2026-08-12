import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  financialYearOf,
  isFinancialYear,
  monthsIn,
  quarterOf,
  type TdsQuarterCode,
} from './tds-period';

describe('financialYearOf', () => {
  // The Indian financial year runs April to March, so January belongs to the
  // year that started the previous April. Getting this wrong files a return
  // against the wrong year, which is a correction statement.
  it.each([
    ['2026-04', '2026-27'],
    ['2026-12', '2026-27'],
    ['2027-01', '2026-27'],
    ['2027-03', '2026-27'],
    ['2027-04', '2027-28'],
  ])('maps %s to %s', (month, expected) => {
    expect(financialYearOf(month)).toBe(expected);
  });
});

describe('quarterOf', () => {
  it.each([
    ['2026-04', 'Q1'],
    ['2026-06', 'Q1'],
    ['2026-07', 'Q2'],
    ['2026-09', 'Q2'],
    ['2026-10', 'Q3'],
    ['2026-12', 'Q3'],
    ['2027-01', 'Q4'],
    ['2027-03', 'Q4'],
  ])('puts %s in %s', (month, expected) => {
    expect(quarterOf(month)).toBe(expected);
  });
});

describe('monthsIn', () => {
  it.each([
    ['Q1', ['2026-04', '2026-05', '2026-06']],
    ['Q2', ['2026-07', '2026-08', '2026-09']],
    ['Q3', ['2026-10', '2026-11', '2026-12']],
    ['Q4', ['2027-01', '2027-02', '2027-03']],
  ])('expands 2026-27 %s', (quarter, expected) => {
    expect(monthsIn('2026-27', quarter as TdsQuarterCode)).toEqual(expected);
  });

  it('round-trips against quarterOf and financialYearOf', () => {
    for (const quarter of ['Q1', 'Q2', 'Q3', 'Q4'] as TdsQuarterCode[]) {
      for (const month of monthsIn('2026-27', quarter)) {
        expect(quarterOf(month)).toBe(quarter);
        expect(financialYearOf(month)).toBe('2026-27');
      }
    }
  });

  it('refuses a financial year it cannot parse', () => {
    expect(() => monthsIn('2026', 'Q1')).toThrow(/financial year/i);
  });
});

describe('isFinancialYear', () => {
  it.each([
    ['2026-27', true],
    ['2026-28', false], // not consecutive
    ['2026', false],
    ['26-27', false],
  ])('%s -> %s', (value, expected) => {
    expect(isFinancialYear(value)).toBe(expected);
  });
});

describe('purity', () => {
  // The same guard helpdesk.rules.spec.ts uses. Comments are stripped first,
  // because the header explains that there is no clock in here and would
  // otherwise match its own rule.
  it('has no clock and no database', () => {
    const source = readFileSync(join(__dirname, 'tds-period.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');
    expect(source).not.toMatch(/new Date\(|Date\.now|prisma|PrismaService/);
  });
});
