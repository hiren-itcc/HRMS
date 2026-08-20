import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { financialYearOf } from './tds-period';

describe('financialYearOf', () => {
  // The Indian financial year runs April to March, so January belongs to the
  // year that started the previous April. Getting this wrong projects tax
  // against the wrong year's slabs.
  it.each([
    ['2026-04', '2026-27'],
    ['2026-12', '2026-27'],
    ['2027-01', '2026-27'],
    ['2027-03', '2026-27'],
    ['2027-04', '2027-28'],
  ])('maps %s to %s', (month, expected) => {
    expect(financialYearOf(month)).toBe(expected);
  });

  it('refuses a month key it cannot parse', () => {
    expect(() => financialYearOf('2026')).toThrow(/month key/i);
    expect(() => financialYearOf('2026-13')).toThrow(/calendar month/i);
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
