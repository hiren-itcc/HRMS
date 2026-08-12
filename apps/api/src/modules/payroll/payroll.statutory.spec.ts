import { defaultSettings } from '@hrms/shared';
import {
  computeStatutory,
  employeeStateInsurance,
  employerPfSplit,
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
  /*
   * The only test here that asserts the *default* rather than the behaviour.
   *
   * Everything below builds its own slabs, deliberately: when these tests took
   * their bands from whatever `defaultSettings()` happened to ship, changing
   * the state read as the slab logic breaking. Boundary handling is not a
   * property of Gujarat.
   */
  it('ships the Gujarat default — nil to 12,000, then 200', () => {
    expect(professionalTax(12_000, config())).toBe(0);
    expect(professionalTax(12_001, config())).toBe(200);
    expect(professionalTax(18_000, config())).toBe(200);
  });

  it('includes the slab boundary in the lower band', () => {
    const cfg = config();
    cfg.professionalTax.slabs = [
      { upTo: 15_000, amount: 0 },
      { upTo: 20_000, amount: 150 },
      { upTo: Number.MAX_SAFE_INTEGER, amount: 200 },
    ];
    expect(professionalTax(15_000, cfg)).toBe(0);
    expect(professionalTax(15_001, cfg)).toBe(150);
    expect(professionalTax(20_000, cfg)).toBe(150);
    expect(professionalTax(20_001, cfg)).toBe(200);
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
    // threshold and above Gujarat's single PT threshold of 12,000. Three
    // different bases in one assertion, which is the point of it.
    expect(computeStatutory({ basic: 10_000, gross: 20_000, config: config() })).toEqual({
      employeePf: 1200,
      employerPf: 1200,
      employeeEsi: 150,
      employerEsi: 650,
      professionalTax: 200,
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

/**
 * The employer's share split for a return.
 *
 * A payslip shows one EMPLOYER_PF line and should — nobody wants their pay
 * split into two numbers that add up to the one they were told. An ECR file
 * needs both halves, and EPFO recomputes them from the wage columns beside
 * them, so a split that does not reconcile is a rejected return.
 */
describe('employerPfSplit', () => {
  it('splits the ordinary case into pension and remainder', () => {
    const { eps, epf } = employerPfSplit(15_000, config());
    // 8.33% of 15,000, and whatever is left of the 12% employer share.
    expect(eps).toBe(1249.5);
    expect(epf).toBe(550.5);
  });

  /* The two halves must add back to the single figure on the payslip, or the
     return and the payslip it came from disagree by a rupee. */
  it.each([6_000, 12_000, 15_000, 25_000, 90_000])('reconciles at basic %s', (basic) => {
    const cfg = config();
    const { eps, epf } = employerPfSplit(basic, cfg);
    expect(round2(eps + epf)).toBe(providentFund(basic, cfg).employer);
  });

  /*
   * The one worth being careful about. `applyCeiling` is the organization's
   * choice and may be off; the pension ceiling is the government's and is not.
   * A generous employer contributing PF on full basic still cannot put more
   * than the statutory wage into the pension scheme.
   */
  it('keeps the pension at the statutory ceiling even when PF is not capped', () => {
    const cfg = config();
    cfg.pf.applyCeiling = false;
    const { eps, epf, epsWage } = employerPfSplit(90_000, cfg);

    expect(epsWage).toBe(15_000);
    expect(eps).toBe(1249.5);
    // Everything above the pension ceiling falls to the provident-fund half.
    expect(round2(eps + epf)).toBe(providentFund(90_000, cfg).employer);
    expect(epf).toBeGreaterThan(9_000);
  });

  it('never returns a negative remainder, however the rates are set', () => {
    const cfg = config();
    cfg.pf.employerRate = 5;
    const { eps, epf } = employerPfSplit(15_000, cfg);
    expect(epf).toBe(0);
    expect(eps).toBe(providentFund(15_000, cfg).employer);
  });

  it('is nothing at all when the scheme is off or there is no basic', () => {
    const cfg = config();
    cfg.pf.enabled = false;
    expect(employerPfSplit(15_000, cfg)).toEqual({ eps: 0, epf: 0, epsWage: 0 });
    expect(employerPfSplit(0, config())).toEqual({ eps: 0, epf: 0, epsWage: 0 });
  });
});
