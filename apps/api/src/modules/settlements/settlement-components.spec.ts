import { DEFAULT_PAY_COMPONENTS } from '@hrms/shared';
import { SettlementLineSource } from '../../generated/prisma/enums';

/**
 * Every computed settlement line names a pay component that actually exists.
 *
 * Nothing reads these today — a settlement carries its own figures rather than
 * pushing lines into a payroll run. The guard is here for the day that changes:
 * adding a fourth computed source without adding its component would fail at
 * whatever maps them, months after the enum was widened. It fails here instead.
 *
 * Deliberately checks codes, not names. `bootstrap.ts` upserts with `update: {}`
 * and the migration is `ON CONFLICT DO NOTHING`, so an organization that renamed
 * "Gratuity" keeps its label — asserting on names would call that drift.
 */
describe('settlement pay components', () => {
  const codes = new Set(DEFAULT_PAY_COMPONENTS.map((c) => c.code));

  const computedSources = Object.values(SettlementLineSource).filter(
    // MANUAL is HR's own line — a retention bonus, a laptop nobody returned.
    // It has no component by design.
    (source) => source !== SettlementLineSource.MANUAL,
  );

  it.each(computedSources)('%s has a pay component in the catalogue', (source) => {
    expect(codes.has(source)).toBe(true);
  });

  it('files each one on the side of the statement it belongs on', () => {
    const kindOf = (code: string) => DEFAULT_PAY_COMPONENTS.find((c) => c.code === code)?.kind;

    expect(kindOf('LEAVE_ENCASHMENT')).toBe('EARNING');
    expect(kindOf('GRATUITY')).toBe('EARNING');
    expect(kindOf('NOTICE_RECOVERY')).toBe('DEDUCTION');
  });

  it('leaves the migration to seed them, not the statutory engine', () => {
    for (const code of computedSources) {
      expect(DEFAULT_PAY_COMPONENTS.find((c) => c.code === code)?.isStatutory).toBe(false);
    }
  });
});
