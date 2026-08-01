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
export function providentFund(
  basic: number,
  config: PayrollConfig,
): {
  employee: number;
  employer: number;
} {
  const pf = config.pf;
  if (!pf.enabled || basic <= 0) return { employee: 0, employer: 0 };
  const wage = pf.applyCeiling ? Math.min(basic, pf.wageCeiling) : basic;
  return {
    employee: round2((wage * pf.employeeRate) / 100),
    employer: round2((wage * pf.employerRate) / 100),
  };
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
