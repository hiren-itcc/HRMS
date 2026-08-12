import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { NonFiniteAmount, reconcile } from './tds-reconcile';

describe('reconcile', () => {
  it('balances when every month has a challan matching its payslips', () => {
    const result = reconcile([
      { month: '2026-07', payslipTds: 12_500, challanTds: 12_500 },
      { month: '2026-08', payslipTds: 12_500, challanTds: 12_500 },
      { month: '2026-09', payslipTds: 13_000, challanTds: 13_000 },
    ]);
    expect(result.balanced).toBe(true);
    expect(result.differences).toEqual([]);
    expect(result.missingChallans).toEqual([]);
  });

  it('reports a month whose challan is short, and by how much', () => {
    const result = reconcile([
      { month: '2026-07', payslipTds: 12_500, challanTds: 12_000 },
      { month: '2026-08', payslipTds: 12_500, challanTds: 12_500 },
      { month: '2026-09', payslipTds: 13_000, challanTds: 13_000 },
    ]);
    expect(result.balanced).toBe(false);
    expect(result.differences).toEqual([
      { month: '2026-07', payslipTds: 12_500, challanTds: 12_000, difference: -500 },
    ]);
  });

  it('signs an over-deposit positively, so the direction is readable', () => {
    // Deposited more than was deducted. Still a mismatch, and still refuses —
    // but an operator needs to know which way it went.
    const result = reconcile([{ month: '2026-07', payslipTds: 12_000, challanTds: 12_500 }]);
    expect(result.differences[0]?.difference).toBe(500);
  });

  it('separates a missing challan from a wrong one', () => {
    // These are different problems with different fixes: one is "record the
    // deposit", the other is "the deposit and the payroll disagree".
    const result = reconcile([
      { month: '2026-07', payslipTds: 12_500, challanTds: null },
      { month: '2026-08', payslipTds: 12_500, challanTds: 9_000 },
    ]);
    expect(result.missingChallans).toEqual(['2026-07']);
    expect(result.differences.map((d) => d.month)).toEqual(['2026-08']);
    expect(result.balanced).toBe(false);
  });

  it('does not want a challan for a month that deducted nothing', () => {
    // No TDS deducted means nothing to deposit. Demanding a nil challan would
    // block a quarter for a company that simply had no liability that month.
    const result = reconcile([
      { month: '2026-07', payslipTds: 0, challanTds: null },
      { month: '2026-08', payslipTds: 12_500, challanTds: 12_500 },
      { month: '2026-09', payslipTds: 0, challanTds: null },
    ]);
    expect(result.balanced).toBe(true);
    expect(result.missingChallans).toEqual([]);
  });

  it('tolerates rounding to the paisa but not to the rupee', () => {
    // Payslip TDS is summed from Decimal(14,2) columns, so a half-paisa drift
    // is arithmetic and a rupee is a mistake.
    expect(
      reconcile([{ month: '2026-07', payslipTds: 12_500.004, challanTds: 12_500 }]).balanced,
    ).toBe(true);
    expect(reconcile([{ month: '2026-07', payslipTds: 12_501, challanTds: 12_500 }]).balanced).toBe(
      false,
    );
  });

  // A NaN payslip figure means an upstream Decimal-to-number conversion broke,
  // not that payroll deducted "not a number". `NaN > TOLERANCE` and
  // `Math.abs(NaN) > TOLERANCE` are both false, so this can slip past every
  // check silently and come out the other end reported as balanced — the one
  // outcome that must never happen for a bad input. It must not be reported
  // as balanced.
  it('refuses to call it balanced when payslipTds is NaN', () => {
    expect(() =>
      reconcile([{ month: '2026-07', payslipTds: Number.NaN, challanTds: 12_500 }]),
    ).toThrow(NonFiniteAmount);
  });

  // Same failure mode on the other input: a challan amount that failed to
  // parse into a number must not be silently treated as a matching deposit.
  it('refuses to call it balanced when challanTds is NaN', () => {
    expect(() =>
      reconcile([{ month: '2026-07', payslipTds: 12_500, challanTds: Number.NaN }]),
    ).toThrow(NonFiniteAmount);
  });
});

describe('purity', () => {
  it('has no clock and no database', () => {
    const source = readFileSync(join(__dirname, 'tds-reconcile.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');
    expect(source).not.toMatch(/new Date\(|Date\.now|prisma|PrismaService/);
  });
});
