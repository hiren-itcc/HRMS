import { defaultSettings } from '@hrms/shared';
import {
  computeStatutory,
  employeeStateInsurance,
  pfWage,
  professionalTax,
  providentFund,
  round2,
} from './payroll.statutory';

const config = () => defaultSettings().payroll;

describe('providentFund', () => {
  it('contributes 12% of basic below the wage ceiling', () => {
    expect(providentFund(10_000, config())).toEqual({ employee: 1200, employer: 1200 });
  });

  it('caps the contribution wage at the ceiling, not the contribution', () => {
    // 12% of the 15,000 ceiling, not 12% of 40,000 then capped — those differ
    // for every rate that is not 100%.
    expect(providentFund(40_000, config())).toEqual({ employee: 1800, employer: 1800 });
  });

  it('contributes exactly at the ceiling boundary', () => {
    expect(providentFund(15_000, config()).employee).toBe(1800);
  });

  it('contributes on full basic when the ceiling is turned off', () => {
    const cfg = config();
    cfg.pf.applyCeiling = false;
    expect(providentFund(40_000, cfg).employee).toBe(4800);
  });

  it('is nil when disabled or when there is no basic', () => {
    const off = config();
    off.pf.enabled = false;
    expect(providentFund(40_000, off)).toEqual({ employee: 0, employer: 0 });
    expect(providentFund(0, config())).toEqual({ employee: 0, employer: 0 });
  });
});

describe('employeeStateInsurance', () => {
  it('applies below the threshold', () => {
    expect(employeeStateInsurance(20_000, config())).toEqual({ employee: 150, employer: 650 });
  });

  it('applies at the threshold itself', () => {
    expect(employeeStateInsurance(21_000, config()).employee).toBe(157.5);
  });

  it('is a cliff, not a taper — a rupee over pays nothing', () => {
    expect(employeeStateInsurance(21_001, config())).toEqual({ employee: 0, employer: 0 });
  });

  it('is nil when disabled', () => {
    const off = config();
    off.esi.enabled = false;
    expect(employeeStateInsurance(10_000, off)).toEqual({ employee: 0, employer: 0 });
  });
});

describe('professionalTax', () => {
  it('charges nothing in the lowest slab', () => {
    expect(professionalTax(12_000, config())).toBe(0);
  });

  it('charges the slab the gross falls in', () => {
    expect(professionalTax(18_000, config())).toBe(150);
  });

  it('includes the slab boundary in the lower band', () => {
    expect(professionalTax(15_000, config())).toBe(0);
    expect(professionalTax(15_001, config())).toBe(150);
    expect(professionalTax(20_000, config())).toBe(150);
    expect(professionalTax(20_001, config())).toBe(200);
  });

  it('charges the highest slab above every band', () => {
    const cfg = config();
    cfg.professionalTax.slabs = [
      { upTo: 15_000, amount: 0 },
      { upTo: 20_000, amount: 150 },
    ];
    expect(professionalTax(99_000, cfg)).toBe(150);
  });

  it('reads slabs in ascending order however they were stored', () => {
    const cfg = config();
    cfg.professionalTax.slabs = [
      { upTo: 20_000, amount: 150 },
      { upTo: 15_000, amount: 0 },
    ];
    expect(professionalTax(12_000, cfg)).toBe(0);
  });

  it('is nil when disabled or unconfigured', () => {
    const off = config();
    off.professionalTax.enabled = false;
    expect(professionalTax(30_000, off)).toBe(0);
    const empty = config();
    empty.professionalTax.slabs = [];
    expect(professionalTax(30_000, empty)).toBe(0);
  });
});

describe('computeStatutory', () => {
  it('levies PF on basic and ESI/PT on gross', () => {
    // Basic 10,000 within the PF ceiling; gross 20,000 within the ESI
    // threshold and in the middle PT band.
    expect(computeStatutory({ basic: 10_000, gross: 20_000, config: config() })).toEqual({
      employeePf: 1200,
      employerPf: 1200,
      employeeEsi: 150,
      employerEsi: 650,
      professionalTax: 150,
    });
  });

  it('drops ESI but keeps PF for a higher earner', () => {
    const result = computeStatutory({ basic: 50_000, gross: 100_000, config: config() });
    expect(result.employeeEsi).toBe(0);
    expect(result.employeePf).toBe(1800);
    expect(result.professionalTax).toBe(200);
  });
});

describe('round2', () => {
  it('rounds to paise', () => {
    expect(round2(1.005)).toBe(1.01);
    expect(round2(157.5)).toBe(157.5);
    expect(round2(0.1 + 0.2)).toBe(0.3);
  });
});

/**
 * The wage the contribution is levied on, which the PF contribution report used
 * to get wrong by computing its own answer.
 *
 * It printed the full BASIC line as "PF wages" beside a deduction taken on the
 * capped wage — 22 of 26 rows on a seeded month, where the report claimed
 * ₹154,000 of wages against ₹1,800 deducted. The deduction was right. On a
 * screen that is a mismatch nobody checks; in an ECR file, where EPFO
 * recomputes contributions from the wage column, it is a rejected return.
 *
 * `providentFund` now levies through this function, so the reconciliation below
 * is what stops the two drifting apart again.
 */
describe('pfWage', () => {
  it('is basic below the ceiling and the ceiling above it', () => {
    expect(pfWage(10_000, config())).toBe(10_000);
    expect(pfWage(40_000, config())).toBe(15_000);
    expect(pfWage(15_000, config())).toBe(15_000);
  });

  it('is full basic when the ceiling is turned off', () => {
    const cfg = config();
    cfg.pf.applyCeiling = false;
    expect(pfWage(40_000, cfg)).toBe(40_000);
  });

  it('is zero when the scheme is off, or there is no basic to levy on', () => {
    const cfg = config();
    cfg.pf.enabled = false;
    expect(pfWage(40_000, cfg)).toBe(0);
    expect(pfWage(0, config())).toBe(0);
  });

  /*
   * The reconciliation itself. Whatever the report prints as the wage, the
   * employee rate applied to it has to equal what was actually deducted —
   * which is precisely the property an ECR upload is validated on.
   */
  it.each([8_000, 15_000, 20_000, 40_000, 154_000])(
    'reconciles: rate x reported wage equals the deduction, at basic %s',
    (basic) => {
      const cfg = config();
      const wage = pfWage(basic, cfg);
      const { employee, employer } = providentFund(basic, cfg);
      expect(round2((wage * cfg.pf.employeeRate) / 100)).toBe(employee);
      expect(round2((wage * cfg.pf.employerRate) / 100)).toBe(employer);
    },
  );
});
