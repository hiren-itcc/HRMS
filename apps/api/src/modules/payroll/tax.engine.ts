/**
 * The income-tax engine.
 *
 * Pure, like `payroll.calc.ts` and `tds-period.ts` — no
 * Prisma, no clock, no settings lookup, no HTTP. Everything it needs arrives as
 * an argument, and the same input always produces the same answer. That is what
 * makes "why was ₹15,000 deducted in December" a question with an answer.
 *
 * ## Money is integer paise in here
 *
 * Every amount crossing this module's boundary is rupees as `number`, and every
 * amount *inside* it is **integer paise**. `payroll.calc.ts` rounds a handful of
 * multiplications with `round2` and that is fine for one payslip line, but tax
 * chains far more operations on one figure — accumulate across slabs, subtract a
 * rebate, add surcharge, apply marginal relief, add cess, subtract tax already
 * deducted, then divide by remaining months. Binary floats drift over a chain
 * that long, and the drift lands on somebody's payslip.
 *
 * Integer paise rather than a Decimal library because it needs no dependency,
 * every intermediate is exact, and salary-scale amounts are nowhere near
 * `Number.MAX_SAFE_INTEGER` — ₹90 crore is 9e11 paise against a ceiling of 9e15.
 *
 * ## What is deliberately not here
 *
 * No previous-employer income, no perquisites, no house-property loss beyond a
 * configured interest cap, no capital gains, no other-sources income. This
 * projects salary and applies the deductions an employer is allowed to consider
 * for TDS. It is not an ITR.
 */

// ── Units ─────────────────────────────────────────────────────────────

/** Rupees (possibly fractional) to exact paise. */
export function toPaise(rupees: number): number {
  return Math.round(rupees * 100);
}

/** Paise back to rupees, to two places. */
export function toRupees(paise: number): number {
  return Math.round(paise) / 100;
}

/** A percentage of a paise amount, rounded to the nearest paisa. */
function percentOf(paise: number, rate: number): number {
  return Math.round((paise * rate) / 100);
}

// ── Inputs ────────────────────────────────────────────────────────────

export type TaxRegimeCode = 'NEW' | 'OLD';

export interface SlabRule {
  fromAmount: number;
  /** Null is the open-ended top band. */
  toAmount: number | null;
  rate: number;
}

export interface SurchargeBand {
  aboveIncome: number;
  rate: number;
}

export interface DeductionRule {
  section: string;
  /** Null means the section has no ceiling of its own. */
  maxAmount: number | null;
}

export interface TaxConfig {
  financialYear: string;
  regime: TaxRegimeCode;
  /** UNCONFIRMED means nobody has entered this year's Finance Act numbers. */
  confirmed: boolean;
  standardDeduction: number;
  rebateIncomeLimit: number | null;
  rebateMaxAmount: number | null;
  cessRate: number;
  marginalRelief: boolean;
  slabs: SlabRule[];
  surchargeBands: SurchargeBand[];
  deductionRules: DeductionRule[];
}

/** One approved declaration line, in rupees. */
export interface ApprovedDeduction {
  section: string;
  approvedAmount: number;
}

/**
 * Thrown when a financial year has no confirmed configuration.
 *
 * An exception rather than a zero, because zero tax is a legitimate answer and
 * "we have no idea what the slabs are" must never be mistaken for one.
 */
export class TaxConfigurationMissing extends Error {
  constructor(financialYear: string, regime: TaxRegimeCode) {
    super(
      `Income tax rules for ${financialYear} (${regime} regime) have not been confirmed yet, so TDS cannot be calculated. Somebody has to record this year's slabs, standard deduction, rebate and cess from the Finance Act before payroll can deduct against them — see prisma/seed/tax.ts. There is no editing screen for this yet, deliberately: it is a once-a-year act that needs the Act in hand.`,
    );
    this.name = 'TaxConfigurationMissing';
  }
}

// ── The financial year ────────────────────────────────────────────────

/**
 * How many payroll months are left in the financial year, counting this one.
 *
 * April is 12 and March is 1. This is the single most important number in the
 * module: dividing by a fixed 12, or by a fixed 6, is the classic way a
 * mid-year joiner or a December declaration ends up under-deducted and the
 * shortfall lands on somebody in March.
 *
 * `month` is `yyyy-MM`. The answer never depends on the clock — a run
 * recalculated in June for April still says 12.
 */
export function calculateRemainingPayrollMonths(month: string): number {
  const match = /^(\d{4})-(\d{2})$/.exec(month);
  if (!match) throw new Error(`Not a YYYY-MM month key: ${month}`);
  const monthNumber = Number(match[2]);
  if (monthNumber < 1 || monthNumber > 12) {
    throw new Error(`Not a calendar month: ${month}`);
  }
  // Months since April, 0-11. April -> 0 -> 12 remaining; March -> 11 -> 1.
  return 12 - ((monthNumber - 4 + 12) % 12);
}

/**
 * The payroll months this person will actually be paid for, from `month` to the
 * end of the financial year, excluding any after they leave.
 *
 * A joiner's earlier months are not "months with no salary" — they are months
 * this employer owes nothing for, and projecting twelve months of pay for
 * somebody who started in October is how a projection doubles a tax bill.
 */
export function payrollMonthsRemaining(
  month: string,
  options: { joinMonth?: string | null; exitMonth?: string | null } = {},
): string[] {
  const remaining = calculateRemainingPayrollMonths(month);
  const match = /^(\d{4})-(\d{2})$/.exec(month) as RegExpExecArray;
  let year = Number(match[1]);
  let monthNumber = Number(match[2]);

  const months: string[] = [];
  for (let index = 0; index < remaining; index += 1) {
    const key = `${year}-${String(monthNumber).padStart(2, '0')}`;
    const beforeJoin = options.joinMonth ? key < options.joinMonth : false;
    const afterExit = options.exitMonth ? key > options.exitMonth : false;
    if (!beforeJoin && !afterExit) months.push(key);
    monthNumber += 1;
    if (monthNumber > 12) {
      monthNumber = 1;
      year += 1;
    }
  }
  return months;
}

// ── Projection ────────────────────────────────────────────────────────

export interface MonthlyEarning {
  month: string;
  /** Gross pay that counts as salary income for the year. */
  taxableGross: number;
}

/**
 * What this person will earn from this employer over the financial year.
 *
 * `earned` is what already happened — read from payslips, never re-derived, so
 * a projection made in December agrees with the payslips December was paid on.
 * `projectedMonthly` is applied to the months still to come, which is what makes
 * a salary revision change the future without rewriting the past.
 */
export function calculateProjectedIncome(input: {
  earned: MonthlyEarning[];
  projectedMonthly: number;
  remainingMonths: string[];
}): number {
  const earnedPaise = input.earned.reduce((sum, row) => sum + toPaise(row.taxableGross), 0);
  const futurePaise = toPaise(input.projectedMonthly) * input.remainingMonths.length;
  return toRupees(earnedPaise + futurePaise);
}

/**
 * The HRA exemption: the least of three figures, per s.10(13A) and Rule 2A.
 *
 * Computed rather than declared. An employee asked for "your HRA exemption"
 * types the HRA they receive, which is almost never the exempt amount, and the
 * error is invisible until an assessment.
 *
 * Returns 0 when any input is missing — no rent, no HRA in the structure, or no
 * basic to compute the 10% floor against.
 */
export function calculateHraExemption(input: {
  annualBasic: number;
  annualHraReceived: number;
  annualRentPaid: number;
  metroCity: boolean;
}): number {
  const basic = toPaise(Math.max(input.annualBasic, 0));
  const received = toPaise(Math.max(input.annualHraReceived, 0));
  const rent = toPaise(Math.max(input.annualRentPaid, 0));
  if (received === 0 || rent === 0 || basic === 0) return 0;

  const cityShare = percentOf(basic, input.metroCity ? 50 : 40);
  const rentOverTenPercent = Math.max(rent - percentOf(basic, 10), 0);
  return toRupees(Math.min(received, cityShare, rentOverTenPercent));
}

/**
 * One declared amount, capped by its section's configured limit.
 *
 * Declaring ₹2,00,000 against a ₹1,50,000 section is not an error to reject —
 * people genuinely invest more than they can claim. It is capped, and both
 * figures are kept so the screen can say why they differ.
 */
export function calculateEligibleDeduction(declared: number, limit: number | null): number {
  const amount = Math.max(declared, 0);
  if (limit === null) return amount;
  return Math.min(amount, Math.max(limit, 0));
}

/**
 * Taxable income, after the standard deduction and whatever the regime allows.
 *
 * Under NEW only the standard deduction applies: the configuration simply
 * carries no deduction rules, so approved declarations find no matching section
 * and contribute nothing. That is enforced by data rather than by an `if`,
 * which is what lets a future Finance Act allow a section under NEW without
 * touching this function.
 *
 * Never negative — a deduction larger than the income is a zero bill, not a
 * refund this employer can give.
 */
export function calculateTaxableIncome(input: {
  projectedIncome: number;
  exemptions: number;
  approvedDeductions: ApprovedDeduction[];
  config: TaxConfig;
}): number {
  const allowed = new Map(input.config.deductionRules.map((rule) => [rule.section, rule]));

  const gross = toPaise(input.projectedIncome);
  const exempt = toPaise(Math.max(input.exemptions, 0));
  const standard = toPaise(Math.max(input.config.standardDeduction, 0));

  let deductions = 0;
  for (const item of input.approvedDeductions) {
    const rule = allowed.get(item.section);
    if (!rule) continue;
    deductions += toPaise(calculateEligibleDeduction(item.approvedAmount, rule.maxAmount));
  }

  return toRupees(Math.max(gross - exempt - standard - deductions, 0));
}

// ── The tax itself ────────────────────────────────────────────────────

export interface SlabTax {
  fromAmount: number;
  toAmount: number | null;
  rate: number;
  /** Income falling inside this band. */
  taxableInBand: number;
  tax: number;
}

/**
 * Tax accumulated band by band, never income times one rate.
 *
 * Returned per band as well as in total, because "which slab am I in" is the
 * question every employee asks and a single figure cannot answer it.
 */
export function calculateTaxBySlabs(
  taxableIncome: number,
  slabs: SlabRule[],
): { slabs: SlabTax[]; tax: number } {
  const income = toPaise(Math.max(taxableIncome, 0));
  const ordered = [...slabs].sort((a, b) => a.fromAmount - b.fromAmount);

  const breakdown: SlabTax[] = [];
  let total = 0;

  for (const slab of ordered) {
    const from = toPaise(slab.fromAmount);
    const to = slab.toAmount === null ? Number.POSITIVE_INFINITY : toPaise(slab.toAmount);
    if (income <= from) break;

    const inBand = Math.min(income, to) - from;
    const bandTax = percentOf(inBand, slab.rate);
    total += bandTax;
    breakdown.push({
      fromAmount: slab.fromAmount,
      toAmount: slab.toAmount,
      rate: slab.rate,
      taxableInBand: toRupees(inBand),
      tax: toRupees(bandTax),
    });
  }

  return { slabs: breakdown, tax: toRupees(total) };
}

/**
 * s.87A rebate — a cliff, not a taper.
 *
 * One rupee of taxable income over the limit removes the whole rebate. That is
 * what the section says, and softening it here would under-deduct for everybody
 * just above the line.
 */
export function calculateRebate(input: {
  taxableIncome: number;
  taxBeforeRebate: number;
  config: TaxConfig;
}): number {
  const { rebateIncomeLimit, rebateMaxAmount } = input.config;
  if (rebateIncomeLimit === null || rebateMaxAmount === null) return 0;
  if (input.taxableIncome > rebateIncomeLimit) return 0;
  return toRupees(Math.min(toPaise(input.taxBeforeRebate), toPaise(rebateMaxAmount)));
}

/**
 * Surcharge, with marginal relief.
 *
 * Surcharge is a cliff too, and an aggressive one: crossing ₹50 lakh by ₹100
 * can add far more than ₹100 of tax. Marginal relief caps the extra tax at the
 * extra income, which is why it exists and why it is on by default.
 */
export function calculateSurcharge(input: {
  taxableIncome: number;
  taxAfterRebate: number;
  config: TaxConfig;
}): number {
  const bands = [...input.config.surchargeBands].sort((a, b) => a.aboveIncome - b.aboveIncome);
  const income = toPaise(input.taxableIncome);

  let applicable: SurchargeBand | null = null;
  for (const band of bands) {
    if (income > toPaise(band.aboveIncome)) applicable = band;
  }
  if (!applicable) return 0;

  const tax = toPaise(input.taxAfterRebate);
  let surcharge = percentOf(tax, applicable.rate);
  if (!input.config.marginalRelief) return toRupees(surcharge);

  // Relief: tax-plus-surcharge may not exceed the tax at the threshold plus
  // every rupee earned above it.
  const threshold = toPaise(applicable.aboveIncome);
  const excessIncome = income - threshold;
  const atThreshold = calculateTaxBySlabs(applicable.aboveIncome, input.config.slabs);
  const rebateAtThreshold = calculateRebate({
    taxableIncome: applicable.aboveIncome,
    taxBeforeRebate: atThreshold.tax,
    config: input.config,
  });
  const taxAtThreshold = toPaise(atThreshold.tax) - toPaise(rebateAtThreshold);

  const ceiling = taxAtThreshold + excessIncome;
  if (tax + surcharge > ceiling) surcharge = Math.max(ceiling - tax, 0);
  return toRupees(surcharge);
}

/** Health and Education Cess, on tax plus surcharge. */
export function calculateCess(input: {
  taxAfterRebate: number;
  surcharge: number;
  config: TaxConfig;
}): number {
  const base = toPaise(input.taxAfterRebate) + toPaise(input.surcharge);
  return toRupees(percentOf(Math.max(base, 0), input.config.cessRate));
}

export interface AnnualTax {
  projectedAnnualIncome: number;
  exemptions: number;
  deductions: number;
  standardDeduction: number;
  projectedTaxableIncome: number;
  slabs: SlabTax[];
  incomeTax: number;
  rebate: number;
  surcharge: number;
  cess: number;
  annualTaxLiability: number;
}

/**
 * The whole annual figure, in the statutory order: slabs, rebate, surcharge,
 * cess. The order is not stylistic — cess is charged on tax *after* rebate and
 * *including* surcharge, so any other sequence produces a different number.
 */
export function calculateAnnualTax(input: {
  projectedIncome: number;
  exemptions: number;
  approvedDeductions: ApprovedDeduction[];
  config: TaxConfig;
}): AnnualTax {
  if (!input.config.confirmed) {
    throw new TaxConfigurationMissing(input.config.financialYear, input.config.regime);
  }

  const allowed = new Map(input.config.deductionRules.map((rule) => [rule.section, rule]));
  let deductionsPaise = 0;
  for (const item of input.approvedDeductions) {
    const rule = allowed.get(item.section);
    if (!rule) continue;
    deductionsPaise += toPaise(calculateEligibleDeduction(item.approvedAmount, rule.maxAmount));
  }

  const taxableIncome = calculateTaxableIncome({
    projectedIncome: input.projectedIncome,
    exemptions: input.exemptions,
    approvedDeductions: input.approvedDeductions,
    config: input.config,
  });

  const { slabs, tax: incomeTax } = calculateTaxBySlabs(taxableIncome, input.config.slabs);
  const rebate = calculateRebate({
    taxableIncome,
    taxBeforeRebate: incomeTax,
    config: input.config,
  });
  const afterRebate = toRupees(toPaise(incomeTax) - toPaise(rebate));
  const surcharge = calculateSurcharge({
    taxableIncome,
    taxAfterRebate: afterRebate,
    config: input.config,
  });
  const cess = calculateCess({ taxAfterRebate: afterRebate, surcharge, config: input.config });

  const liability = toPaise(afterRebate) + toPaise(surcharge) + toPaise(cess);

  return {
    projectedAnnualIncome: input.projectedIncome,
    exemptions: Math.max(input.exemptions, 0),
    deductions: toRupees(deductionsPaise),
    standardDeduction: Math.max(input.config.standardDeduction, 0),
    projectedTaxableIncome: taxableIncome,
    slabs,
    incomeTax,
    rebate,
    surcharge,
    cess,
    annualTaxLiability: toRupees(Math.max(liability, 0)),
  };
}

// ── Monthly TDS ───────────────────────────────────────────────────────

/**
 * What is still owed for the year.
 *
 * Never negative. Over-deduction — an approved declaration arriving in
 * December, say — leaves nothing further to take rather than a refund: an
 * employer cannot hand tax back through payroll, and the excess is settled on
 * assessment.
 */
export function calculateRemainingTax(annualTaxLiability: number, alreadyDeducted: number): number {
  return toRupees(Math.max(toPaise(annualTaxLiability) - toPaise(alreadyDeducted), 0));
}

export interface MonthlyTds {
  annualTaxLiability: number;
  alreadyDeducted: number;
  remainingTax: number;
  remainingMonths: number;
  /** What this month should deduct, before any override or salary clamp. */
  monthlyTds: number;
}

/**
 * Remaining tax spread over the payroll months that are actually left.
 *
 * **Not** annual ÷ 12, and **not** a fixed six months. The divisor is the
 * number of payslips this person still has coming in the financial year, which
 * is 12 in April, 6 in October and 1 in March — and 6 for somebody who joined
 * in October whatever month it is now.
 *
 * March takes the rounding. Spreading remaining tax across n months and
 * rounding each to the paisa leaves a few paise adrift over a year; the last
 * payroll month absorbs it, so the twelve deductions sum to the liability
 * exactly rather than ending a rupee short.
 */
export function calculateMonthlyTds(input: {
  annualTaxLiability: number;
  alreadyDeducted: number;
  remainingMonths: number;
}): MonthlyTds {
  const remainingTax = calculateRemainingTax(input.annualTaxLiability, input.alreadyDeducted);
  const months = Math.max(Math.floor(input.remainingMonths), 0);

  if (months === 0 || remainingTax === 0) {
    return {
      annualTaxLiability: input.annualTaxLiability,
      alreadyDeducted: input.alreadyDeducted,
      remainingTax,
      remainingMonths: months,
      monthlyTds: 0,
    };
  }

  const remainingPaise = toPaise(remainingTax);
  const monthlyPaise = months === 1 ? remainingPaise : Math.floor(remainingPaise / months);

  return {
    annualTaxLiability: input.annualTaxLiability,
    alreadyDeducted: input.alreadyDeducted,
    remainingTax,
    remainingMonths: months,
    monthlyTds: toRupees(monthlyPaise),
  };
}
