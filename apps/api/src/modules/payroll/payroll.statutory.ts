import type { OrgSettings } from '@hrms/shared';

/**
 * Statutory deductions — PF, ESI and Professional Tax.
 *
 * Pure and rule-driven: every rate, ceiling and slab arrives from org
 * settings rather than being written here, because these numbers change by
 * budget and by state, and a rate change should be an edit rather than a
 * release.
 *
 * TDS is not computed. Real TDS needs annual income projection, a regime
 * choice and investment proofs; it is entered per employee instead.
 */

export type PayrollConfig = OrgSettings['payroll'];

/** Money is rounded to paise at every step so totals cannot drift. */
export function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export interface StatutoryInput {
  /** Basic for the period, already prorated. PF is levied on this. */
  basic: number;
  /** Gross earnings for the period. ESI and PT are levied on this. */
  gross: number;
  config: PayrollConfig;
}

export interface StatutoryResult {
  employeePf: number;
  employerPf: number;
  employeeEsi: number;
  employerEsi: number;
  professionalTax: number;
}

/**
 * PF is levied on Basic, capped at the statutory wage ceiling.
 *
 * The cap is the part worth being careful with: contributions are on
 * `min(basic, ceiling)`, not on basic with the result capped — those differ
 * whenever the rate is not 100%. An organization that contributes on full
 * basic turns `applyCeiling` off.
 */
/**
 * The wage PF is actually levied on — basic, or the ceiling, whichever is less.
 *
 * Exported and used by `providentFund` below rather than inlined, because the
 * contribution report needs the same number and got it wrong by computing its
 * own: it printed the full BASIC line as "PF wages" while the deduction was
 * taken on the capped wage. On screen that is a mismatch nobody checks. In an
 * ECR file, where EPFO recomputes contributions from the wage column, it is a
 * rejected return.
 *
 * One definition, two callers, so they cannot drift again.
 */
export function pfWage(basic: number, config: PayrollConfig): number {
  const pf = config.pf;
  if (!pf.enabled || basic <= 0) return 0;
  return pf.applyCeiling ? Math.min(basic, pf.wageCeiling) : basic;
}

export function providentFund(
  basic: number,
  config: PayrollConfig,
): {
  employee: number;
  employer: number;
} {
  const pf = config.pf;
  if (!pf.enabled || basic <= 0) return { employee: 0, employer: 0 };
  const wage = pfWage(basic, config);
  return {
    employee: round2((wage * pf.employeeRate) / 100),
    employer: round2((wage * pf.employerRate) / 100),
  };
}

/**
 * The employer's share, split the way a return has to report it.
 *
 * A payslip shows one `EMPLOYER_PF` line, and that is right — nobody wants
 * their pay split into two numbers that add to the one they were told. An ECR
 * file cannot be built from it, though: EPFO wants the pension component and
 * the provident-fund remainder separately, and recomputes both from the wage
 * columns beside them.
 *
 * **Two ceilings, and they are not the same one.** `pfWage` follows the
 * organization's `applyCeiling`, so a generous employer may contribute PF on
 * full basic. The pension ceiling is the government's and always applies: that
 * employer still cannot put more than the statutory wage into the pension
 * scheme. Collapsing the two is the mistake this function exists to prevent.
 *
 * The remainder is `employer − eps` rather than 3.67% of anything, so the two
 * halves always add back to the single figure on the payslip. Deriving it from
 * a rate instead would let rounding put a rupee between the return and the
 * payslip it came from.
 */
export function employerPfSplit(
  basic: number,
  config: PayrollConfig,
): { eps: number; epf: number; epsWage: number } {
  const pf = config.pf;
  if (!pf.enabled || basic <= 0) return { eps: 0, epf: 0, epsWage: 0 };

  const epsWage = Math.min(basic, pf.epsWageCeiling);
  const eps = round2((epsWage * pf.epsRate) / 100);
  const { employer } = providentFund(basic, config);

  /*
   * Never negative. If somebody sets an employer rate below the pension rate,
   * the pension takes what there is and the remainder is nothing — a negative
   * EPF share is not a thing a return can carry, and it would be rejected on
   * upload rather than merely being odd.
   */
  const eligible = Math.min(eps, employer);
  return { eps: eligible, epf: round2(employer - eligible), epsWage };
}

/**
 * ESI applies only while gross is at or below the threshold.
 *
 * It is a cliff, not a taper: someone earning a rupee over the threshold
 * pays nothing rather than a reduced amount.
 */
export function employeeStateInsurance(
  gross: number,
  config: PayrollConfig,
): {
  employee: number;
  employer: number;
} {
  const esi = config.esi;
  if (!esi.enabled || gross <= 0 || gross > esi.wageThreshold) {
    return { employee: 0, employer: 0 };
  }
  return {
    employee: round2((gross * esi.employeeRate) / 100),
    employer: round2((gross * esi.employerRate) / 100),
  };
}

/**
 * Professional tax — a flat amount from the first slab the gross fits in.
 *
 * Slabs are read in ascending `upTo` order regardless of how they were
 * stored, so a mis-ordered configuration cannot quietly charge the wrong
 * band. A gross above every slab pays the highest one.
 */
export function professionalTax(gross: number, config: PayrollConfig): number {
  const pt = config.professionalTax;
  if (!pt.enabled || gross <= 0 || pt.slabs.length === 0) return 0;
  const slabs = [...pt.slabs].sort((a, b) => a.upTo - b.upTo);
  const match = slabs.find((slab) => gross <= slab.upTo);
  return round2(match ? match.amount : (slabs[slabs.length - 1]?.amount ?? 0));
}

export function computeStatutory({ basic, gross, config }: StatutoryInput): StatutoryResult {
  const pf = providentFund(basic, config);
  const esi = employeeStateInsurance(gross, config);
  return {
    employeePf: pf.employee,
    employerPf: pf.employer,
    employeeEsi: esi.employee,
    employerEsi: esi.employer,
    professionalTax: professionalTax(gross, config),
  };
}
