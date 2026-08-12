import { describe, expect, it } from 'vitest';
import { financialYearOf } from '@/features/payroll/tds-api';

/**
 * The same table as `apps/api/src/modules/payroll/tds-period.spec.ts`.
 *
 * This helper exists twice on purpose — see the note on it — and two copies
 * held together by a comment is how the brand mark rotted. These cases must
 * stay identical to the API's; if you change one table, change both.
 */
describe('financialYearOf', () => {
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
