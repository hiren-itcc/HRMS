import { DEFAULT_PAY_COMPONENTS, DEFAULT_SALARY_STRUCTURES, defaultSettings } from '@hrms/shared';
import { calculatePayslip, type StructureLineInput } from './payroll.calc';

/**
 * The structure `bootstrap.ts` seeds, run through the real engine.
 *
 * This exists to pin a claim the bootstrap makes in prose: that an
 * organization gets basic at 50%, HRA at 40% of basic, PF of ₹1,800 and
 * professional tax of ₹200 without configuring anything. PF and PT are the
 * point — they are NOT lines on the structure, they come from the statutory
 * defaults in settings, and this fails if either of those defaults moves.
 */
function seededLines(code: string): StructureLineInput[] {
  const structure = DEFAULT_SALARY_STRUCTURES.find((s) => s.code === code);
  if (!structure) throw new Error(`${code} is missing from DEFAULT_SALARY_STRUCTURES`);

  return structure.lines.map((line) => {
    const component = DEFAULT_PAY_COMPONENTS.find((c) => c.code === line.componentCode);
    if (!component) {
      throw new Error(
        `${line.componentCode} is not in DEFAULT_PAY_COMPONENTS — bootstrap would skip it`,
      );
    }
    return {
      code: component.code,
      name: component.name,
      kind: component.kind,
      calcType: line.calcType,
      value: line.value,
      order: line.order,
    };
  });
}

describe('the seeded Standard structure', () => {
  const result = calculatePayslip({
    month: '2026-06',
    monthlyCtc: 50_000,
    lines: seededLines('STANDARD'),
    config: defaultSettings().payroll,
  });

  const amount = (code: string) => result.lines.find((l) => l.code === code)?.amount;

  it('splits earnings 50 / 40-of-basic / balance', () => {
    expect(amount('BASIC')).toBe(25_000);
    expect(amount('HRA')).toBe(10_000);
    expect(amount('SPECIAL')).toBe(15_000);
  });

  it('allocates the whole CTC — the BALANCE line leaves nothing stranded', () => {
    const earnings = result.lines.filter((l) => l.kind === 'EARNING');
    expect(earnings.reduce((sum, l) => sum + l.amount, 0)).toBe(50_000);
    expect(result.grossEarnings).toBe(50_000);
  });

  /*
   * The reason there is no PF line in the seed. A structure line for PF would
   * be stored and displayed and then ignored, because the engine pushes the
   * statutory amount first and skips any code already present.
   */
  it('deducts ₹1,800 PF from the statutory engine, not from a structure line', () => {
    expect(amount('PF')).toBe(1800); // 12% of the ₹15,000 wage ceiling
    expect(DEFAULT_SALARY_STRUCTURES[0]?.lines.some((l) => l.componentCode === 'PF')).toBe(false);
  });

  it('deducts ₹200 professional tax from the top slab', () => {
    expect(amount('PT')).toBe(200);
    expect(DEFAULT_SALARY_STRUCTURES[0]?.lines.some((l) => l.componentCode === 'PT')).toBe(false);
  });

  it('nets what is left', () => {
    expect(result.totalDeductions).toBe(2000);
    expect(result.netPay).toBe(50_000 - 1800 - 200);
  });
});

describe('the seed and the catalogue cannot drift apart', () => {
  /*
   * bootstrap.ts filters out any line whose component code it cannot resolve,
   * so a typo here would silently produce a structure with fewer lines than
   * intended rather than an error.
   */
  it('names only components that DEFAULT_PAY_COMPONENTS actually ships', () => {
    const codes = new Set(DEFAULT_PAY_COMPONENTS.map((c) => c.code));
    for (const structure of DEFAULT_SALARY_STRUCTURES) {
      for (const line of structure.lines) {
        expect(codes.has(line.componentCode)).toBe(true);
      }
    }
  });

  it('has at most one BALANCE line per structure, as the schema demands', () => {
    for (const structure of DEFAULT_SALARY_STRUCTURES) {
      expect(structure.lines.filter((l) => l.calcType === 'BALANCE').length).toBeLessThanOrEqual(1);
    }
  });
});
