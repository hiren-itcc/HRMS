import { readFileSync } from 'node:fs';
import {
  type ApprovedDeduction,
  calculateAnnualTax,
  calculateCess,
  calculateEligibleDeduction,
  calculateHraExemption,
  calculateMonthlyTds,
  calculateProjectedIncome,
  calculateRebate,
  calculateRemainingPayrollMonths,
  calculateRemainingTax,
  calculateSurcharge,
  calculateTaxableIncome,
  calculateTaxBySlabs,
  payrollMonthsRemaining,
  type TaxConfig,
  TaxConfigurationMissing,
  toPaise,
  toRupees,
} from './tax.engine';

/**
 * The tax engine, exhaustively.
 *
 * These fixtures are the FY 2025-26 rules and they are **test data, not the
 * product's tax table** — the shipped configuration lives in rows, and
 * `tax-config.seed.ts` is where the real numbers are. Pinning them here means a
 * change to the engine's arithmetic fails loudly against a worked example,
 * without the spec becoming a second place the law is asserted.
 *
 * Every expected figure below was computed by hand slab by slab and is shown in
 * the comment beside it, so a failure says which step moved.
 */

const NEW_2025: TaxConfig = {
  financialYear: '2025-26',
  regime: 'NEW',
  confirmed: true,
  standardDeduction: 75_000,
  rebateIncomeLimit: 12_00_000,
  rebateMaxAmount: 60_000,
  cessRate: 4,
  marginalRelief: true,
  slabs: [
    { fromAmount: 0, toAmount: 4_00_000, rate: 0 },
    { fromAmount: 4_00_000, toAmount: 8_00_000, rate: 5 },
    { fromAmount: 8_00_000, toAmount: 12_00_000, rate: 10 },
    { fromAmount: 12_00_000, toAmount: 16_00_000, rate: 15 },
    { fromAmount: 16_00_000, toAmount: 20_00_000, rate: 20 },
    { fromAmount: 20_00_000, toAmount: 24_00_000, rate: 25 },
    { fromAmount: 24_00_000, toAmount: null, rate: 30 },
  ],
  surchargeBands: [
    { aboveIncome: 50_00_000, rate: 10 },
    { aboveIncome: 1_00_00_000, rate: 15 },
    { aboveIncome: 2_00_00_000, rate: 25 },
  ],
  // The New regime allows the standard deduction and essentially nothing else.
  // That is expressed as an empty rule list rather than an `if`, so a future
  // Finance Act permitting a section needs a row and not a code change.
  deductionRules: [],
};

const OLD_2025: TaxConfig = {
  financialYear: '2025-26',
  regime: 'OLD',
  confirmed: true,
  standardDeduction: 50_000,
  rebateIncomeLimit: 5_00_000,
  rebateMaxAmount: 12_500,
  cessRate: 4,
  marginalRelief: true,
  slabs: [
    { fromAmount: 0, toAmount: 2_50_000, rate: 0 },
    { fromAmount: 2_50_000, toAmount: 5_00_000, rate: 5 },
    { fromAmount: 5_00_000, toAmount: 10_00_000, rate: 20 },
    { fromAmount: 10_00_000, toAmount: null, rate: 30 },
  ],
  surchargeBands: [
    { aboveIncome: 50_00_000, rate: 10 },
    { aboveIncome: 1_00_00_000, rate: 15 },
  ],
  deductionRules: [
    { section: '80C', maxAmount: 1_50_000 },
    { section: '80CCD1B', maxAmount: 50_000 },
    { section: '80D_SELF', maxAmount: 25_000 },
    { section: '80D_PARENTS', maxAmount: 50_000 },
    { section: '80E', maxAmount: null },
    { section: '80TTA', maxAmount: 10_000 },
    { section: 'HOME_LOAN_INTEREST', maxAmount: 2_00_000 },
  ],
};

const UNCONFIRMED: TaxConfig = { ...NEW_2025, financialYear: '2026-27', confirmed: false };

// ── Units ─────────────────────────────────────────────────────────────

describe('money is exact', () => {
  /*
   * The reason the engine works in integer paise. 0.1 + 0.2 is the famous case,
   * but the one that actually bites is a rate applied to a rate applied to a
   * division — which is exactly the tax → surcharge → cess → ÷ months chain.
   */
  it('does not drift over the chain a plain float would', () => {
    expect(toPaise(0.1) + toPaise(0.2)).toBe(30);
    expect(toRupees(toPaise(0.1) + toPaise(0.2))).toBe(0.3);
    expect(0.1 + 0.2).not.toBe(0.3);
  });

  it('round-trips rupees through paise', () => {
    for (const amount of [0, 0.01, 1, 1234.56, 99_99_999.99]) {
      expect(toRupees(toPaise(amount))).toBe(amount);
    }
  });
});

// ── Remaining payroll months ──────────────────────────────────────────

describe('remaining payroll months', () => {
  /*
   * The single most important number in the module. A fixed 12, or the "next
   * six months" rule some payroll products use, under-deducts a mid-year
   * joiner and dumps the shortfall on them in March.
   */
  it.each([
    ['2026-04', 12],
    ['2026-05', 11],
    ['2026-06', 10],
    ['2026-07', 9],
    ['2026-08', 8],
    ['2026-09', 7],
    ['2026-10', 6],
    ['2026-11', 5],
    ['2026-12', 4],
    ['2027-01', 3],
    ['2027-02', 2],
    ['2027-03', 1],
  ])('%s has %i payroll months left', (month, expected) => {
    expect(calculateRemainingPayrollMonths(month)).toBe(expected);
  });

  it('does not read the clock — the answer depends only on the month key', () => {
    expect(calculateRemainingPayrollMonths('2019-10')).toBe(6);
    expect(calculateRemainingPayrollMonths('2099-10')).toBe(6);
  });

  it('refuses a key that is not a month', () => {
    expect(() => calculateRemainingPayrollMonths('2026-13')).toThrow('Not a calendar month');
    expect(() => calculateRemainingPayrollMonths('April')).toThrow('Not a YYYY-MM');
  });
});

describe('which months this person is actually paid for', () => {
  it('lists the rest of the year from April', () => {
    const months = payrollMonthsRemaining('2026-04');
    expect(months).toHaveLength(12);
    expect(months[0]).toBe('2026-04');
    expect(months[11]).toBe('2027-03');
  });

  it('rolls into the next calendar year across January', () => {
    expect(payrollMonthsRemaining('2026-12')).toEqual(['2026-12', '2027-01', '2027-02', '2027-03']);
  });

  /*
   * A joiner's earlier months are not months with no salary — they are months
   * this employer owes nothing for. Projecting twelve months of pay for
   * somebody who started in October is how a projection doubles a tax bill.
   */
  it('excludes months before somebody joined', () => {
    const months = payrollMonthsRemaining('2026-04', { joinMonth: '2026-10' });
    expect(months).toHaveLength(6);
    expect(months[0]).toBe('2026-10');
  });

  it('excludes months after somebody leaves', () => {
    const months = payrollMonthsRemaining('2026-04', { exitMonth: '2026-09' });
    expect(months).toEqual(['2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09']);
  });

  it('is empty when they left before the month being run', () => {
    expect(payrollMonthsRemaining('2026-10', { exitMonth: '2026-08' })).toEqual([]);
  });
});

// ── Projection ────────────────────────────────────────────────────────

describe('projected income', () => {
  /*
   * Earned months are read from payslips and never re-derived, which is what
   * makes a December projection agree with the payslips December was paid on.
   */
  it('adds what was actually earned to what is still to come', () => {
    const projected = calculateProjectedIncome({
      earned: [
        { month: '2026-04', taxableGross: 1_00_000 },
        { month: '2026-05', taxableGross: 1_00_000 },
      ],
      projectedMonthly: 1_30_000,
      remainingMonths: payrollMonthsRemaining('2026-06'),
    });
    // 2 × 1,00,000 earned + 10 × 1,30,000 projected
    expect(projected).toBe(15_00_000);
  });

  it('projects only the months a mid-year joiner will be paid for', () => {
    const projected = calculateProjectedIncome({
      earned: [],
      projectedMonthly: 1_00_000,
      remainingMonths: payrollMonthsRemaining('2026-10', { joinMonth: '2026-10' }),
    });
    expect(projected).toBe(6_00_000);
  });
});

describe('HRA exemption', () => {
  /*
   * Computed, never declared. Asked for "your HRA exemption" an employee types
   * the HRA they receive, which is almost never the exempt amount.
   */
  it('takes the least of the three statutory figures', () => {
    // received 2,40,000 · 50% of basic 3,00,000 · rent − 10% basic 1,80,000
    expect(
      calculateHraExemption({
        annualBasic: 6_00_000,
        annualHraReceived: 2_40_000,
        annualRentPaid: 2_40_000,
        metroCity: true,
      }),
    ).toBe(1_80_000);
  });

  it('uses 40% outside a metro', () => {
    // received 3,00,000 · 40% of basic 2,40,000 · rent − 10% basic 3,40,000
    expect(
      calculateHraExemption({
        annualBasic: 6_00_000,
        annualHraReceived: 3_00_000,
        annualRentPaid: 4_00_000,
        metroCity: false,
      }),
    ).toBe(2_40_000);
  });

  it('is nothing when no rent was paid, whatever the structure says', () => {
    expect(
      calculateHraExemption({
        annualBasic: 6_00_000,
        annualHraReceived: 2_40_000,
        annualRentPaid: 0,
        metroCity: true,
      }),
    ).toBe(0);
  });

  it('is nothing when the structure carries no HRA', () => {
    expect(
      calculateHraExemption({
        annualBasic: 6_00_000,
        annualHraReceived: 0,
        annualRentPaid: 3_00_000,
        metroCity: true,
      }),
    ).toBe(0);
  });

  /* Rent below 10% of basic exempts nothing — the third figure goes negative. */
  it('never returns a negative exemption', () => {
    expect(
      calculateHraExemption({
        annualBasic: 6_00_000,
        annualHraReceived: 2_40_000,
        annualRentPaid: 12_000,
        metroCity: true,
      }),
    ).toBe(0);
  });
});

describe('eligible deduction', () => {
  /*
   * Declaring more than the section allows is not an error to reject. People
   * genuinely invest above the cap; the system caps and keeps both figures.
   */
  it('caps a declaration at the section limit', () => {
    expect(calculateEligibleDeduction(2_00_000, 1_50_000)).toBe(1_50_000);
  });

  it('leaves a declaration under the limit alone', () => {
    expect(calculateEligibleDeduction(90_000, 1_50_000)).toBe(90_000);
  });

  it('does not cap a section that has no ceiling', () => {
    expect(calculateEligibleDeduction(7_00_000, null)).toBe(7_00_000);
  });

  it('floors a negative declaration at zero', () => {
    expect(calculateEligibleDeduction(-5000, 1_50_000)).toBe(0);
  });
});

// ── Taxable income ────────────────────────────────────────────────────

describe('taxable income', () => {
  it('subtracts the standard deduction under the New regime', () => {
    expect(
      calculateTaxableIncome({
        projectedIncome: 18_00_000,
        exemptions: 0,
        approvedDeductions: [],
        config: NEW_2025,
      }),
    ).toBe(17_25_000);
  });

  /*
   * Enforced by data, not by a branch: the New configuration carries no
   * deduction rules, so an approved 80C finds no matching section.
   */
  it('ignores an approved 80C under the New regime', () => {
    expect(
      calculateTaxableIncome({
        projectedIncome: 18_00_000,
        exemptions: 0,
        approvedDeductions: [{ section: '80C', approvedAmount: 1_50_000 }],
        config: NEW_2025,
      }),
    ).toBe(17_25_000);
  });

  it('applies approved deductions under the Old regime', () => {
    const deductions: ApprovedDeduction[] = [
      { section: '80C', approvedAmount: 1_50_000 },
      { section: '80CCD1B', approvedAmount: 50_000 },
      { section: '80D_SELF', approvedAmount: 25_000 },
    ];
    // 18,00,000 − 50,000 standard − 2,25,000
    expect(
      calculateTaxableIncome({
        projectedIncome: 18_00_000,
        exemptions: 0,
        approvedDeductions: deductions,
        config: OLD_2025,
      }),
    ).toBe(15_25_000);
  });

  it('caps each section as it goes, even if HR approved more', () => {
    expect(
      calculateTaxableIncome({
        projectedIncome: 18_00_000,
        exemptions: 0,
        approvedDeductions: [{ section: '80C', approvedAmount: 5_00_000 }],
        config: OLD_2025,
      }),
    ).toBe(16_00_000); // capped at 1,50,000, not 5,00,000
  });

  it('subtracts exemptions such as HRA before deductions', () => {
    expect(
      calculateTaxableIncome({
        projectedIncome: 18_00_000,
        exemptions: 1_80_000,
        approvedDeductions: [],
        config: OLD_2025,
      }),
    ).toBe(15_70_000);
  });

  /* A bill cannot be negative — an employer has no refund to give. */
  it('floors at zero rather than going negative', () => {
    expect(
      calculateTaxableIncome({
        projectedIncome: 1_00_000,
        exemptions: 0,
        approvedDeductions: [{ section: '80C', approvedAmount: 1_50_000 }],
        config: OLD_2025,
      }),
    ).toBe(0);
  });

  it('ignores a section this configuration does not support', () => {
    expect(
      calculateTaxableIncome({
        projectedIncome: 18_00_000,
        exemptions: 0,
        approvedDeductions: [{ section: '80CCF_OBSOLETE', approvedAmount: 20_000 }],
        config: OLD_2025,
      }),
    ).toBe(17_50_000);
  });
});

// ── The slabs ─────────────────────────────────────────────────────────

describe('progressive slabs', () => {
  it('charges nothing below the first threshold', () => {
    expect(calculateTaxBySlabs(3_50_000, NEW_2025.slabs).tax).toBe(0);
  });

  it('charges band by band, not income times one rate', () => {
    // 0–4L nil · 4–8L @5% = 20,000 · 8–10L @10% = 20,000
    const result = calculateTaxBySlabs(10_00_000, NEW_2025.slabs);
    expect(result.tax).toBe(40_000);
    expect(result.slabs.map((s) => s.tax)).toEqual([0, 20_000, 20_000]);
  });

  it('reaches the open-ended top band', () => {
    // nil + 20,000 + 40,000 + 60,000 + 80,000 + 1,00,000 + 6L@30% = 1,80,000
    expect(calculateTaxBySlabs(30_00_000, NEW_2025.slabs).tax).toBe(4_80_000);
  });

  it('reports which bands were used, because "what slab am I in" needs an answer', () => {
    const result = calculateTaxBySlabs(9_00_000, OLD_2025.slabs);
    expect(result.slabs).toHaveLength(3);
    expect(result.slabs[2]).toMatchObject({ rate: 20, taxableInBand: 4_00_000, tax: 80_000 });
  });

  it('is zero at exactly the first threshold', () => {
    expect(calculateTaxBySlabs(4_00_000, NEW_2025.slabs).tax).toBe(0);
  });

  it('sorts slabs it is handed out of order', () => {
    const shuffled = [...NEW_2025.slabs].reverse();
    expect(calculateTaxBySlabs(10_00_000, shuffled).tax).toBe(40_000);
  });
});

// ── Rebate, surcharge, cess ───────────────────────────────────────────

describe('the s.87A rebate', () => {
  it('wipes out the tax for a New-regime income at the limit', () => {
    const tax = calculateTaxBySlabs(12_00_000, NEW_2025.slabs).tax; // 60,000
    expect(
      calculateRebate({ taxableIncome: 12_00_000, taxBeforeRebate: tax, config: NEW_2025 }),
    ).toBe(60_000);
  });

  /*
   * A cliff, not a taper. One rupee over removes the whole rebate — that is
   * what the section says, and softening it would under-deduct everybody just
   * above the line.
   */
  it('disappears entirely one rupee over the limit', () => {
    const tax = calculateTaxBySlabs(12_00_001, NEW_2025.slabs).tax;
    expect(
      calculateRebate({ taxableIncome: 12_00_001, taxBeforeRebate: tax, config: NEW_2025 }),
    ).toBe(0);
  });

  it('never exceeds the tax it is rebating', () => {
    // Old regime, taxable 3,00,000 → tax 2,500, rebate capped at the tax
    const tax = calculateTaxBySlabs(3_00_000, OLD_2025.slabs).tax;
    expect(
      calculateRebate({ taxableIncome: 3_00_000, taxBeforeRebate: tax, config: OLD_2025 }),
    ).toBe(2_500);
  });

  it('is nothing when the regime configures no rebate', () => {
    const noRebate: TaxConfig = { ...OLD_2025, rebateIncomeLimit: null, rebateMaxAmount: null };
    expect(
      calculateRebate({ taxableIncome: 3_00_000, taxBeforeRebate: 2_500, config: noRebate }),
    ).toBe(0);
  });
});

describe('surcharge', () => {
  it('is nothing below the first band', () => {
    expect(
      calculateSurcharge({ taxableIncome: 30_00_000, taxAfterRebate: 4_80_000, config: NEW_2025 }),
    ).toBe(0);
  });

  /*
   * Marginal relief is the whole reason this is not a plain percentage.
   * Crossing 50 lakh by 10,000 would otherwise add 1,31,550 of surcharge to a
   * 10,000 rise in income.
   */
  it('caps the extra tax at the extra income just over a threshold', () => {
    const taxable = 50_10_000;
    const tax = calculateTaxBySlabs(taxable, OLD_2025.slabs).tax; // 13,15,500
    expect(tax).toBe(13_15_500);
    // Tax at exactly 50,00,000 is 13,12,500; ceiling = that + 10,000 excess.
    // Surcharge is squeezed to 7,000 rather than 1,31,550.
    expect(
      calculateSurcharge({ taxableIncome: taxable, taxAfterRebate: tax, config: OLD_2025 }),
    ).toBe(7_000);
  });

  it('charges the full rate once well past the threshold', () => {
    const taxable = 80_00_000;
    const tax = calculateTaxBySlabs(taxable, OLD_2025.slabs).tax;
    expect(
      calculateSurcharge({ taxableIncome: taxable, taxAfterRebate: tax, config: OLD_2025 }),
    ).toBe(Math.round(tax * 0.1 * 100) / 100);
  });

  it('picks the highest band the income clears', () => {
    const taxable = 1_50_00_000;
    const tax = calculateTaxBySlabs(taxable, OLD_2025.slabs).tax;
    expect(
      calculateSurcharge({ taxableIncome: taxable, taxAfterRebate: tax, config: OLD_2025 }),
    ).toBe(Math.round(tax * 0.15 * 100) / 100);
  });

  it('can be switched off by configuration', () => {
    const noRelief: TaxConfig = { ...OLD_2025, marginalRelief: false };
    const taxable = 50_10_000;
    const tax = calculateTaxBySlabs(taxable, OLD_2025.slabs).tax;
    expect(
      calculateSurcharge({ taxableIncome: taxable, taxAfterRebate: tax, config: noRelief }),
    ).toBe(1_31_550);
  });
});

describe('cess', () => {
  it('is charged on tax plus surcharge', () => {
    expect(calculateCess({ taxAfterRebate: 1_00_000, surcharge: 10_000, config: NEW_2025 })).toBe(
      4_400,
    );
  });

  it('is nothing when there is no tax', () => {
    expect(calculateCess({ taxAfterRebate: 0, surcharge: 0, config: NEW_2025 })).toBe(0);
  });

  it('follows the configured rate rather than a hardcoded 4%', () => {
    const config: TaxConfig = { ...NEW_2025, cessRate: 5 };
    expect(calculateCess({ taxAfterRebate: 1_00_000, surcharge: 0, config })).toBe(5_000);
  });
});

// ── The annual figure ─────────────────────────────────────────────────

describe('annual tax', () => {
  /*
   * The gate the whole "do not guess a slab" decision rests on. An exception
   * rather than zero, because zero tax is a legitimate answer and must never be
   * confused with having no idea what the rules are.
   */
  it('refuses a financial year nobody has confirmed', () => {
    expect(() =>
      calculateAnnualTax({
        projectedIncome: 18_00_000,
        exemptions: 0,
        approvedDeductions: [],
        config: UNCONFIRMED,
      }),
    ).toThrow(TaxConfigurationMissing);
  });

  it('names the year and the screen in the refusal', () => {
    expect(() =>
      calculateAnnualTax({
        projectedIncome: 18_00_000,
        exemptions: 0,
        approvedDeductions: [],
        config: UNCONFIRMED,
      }),
    ).toThrow(/2026-27.*NEW/s);
  });

  it('is nothing for an income under the threshold', () => {
    const result = calculateAnnualTax({
      projectedIncome: 4_00_000,
      exemptions: 0,
      approvedDeductions: [],
      config: NEW_2025,
    });
    expect(result.annualTaxLiability).toBe(0);
  });

  /* Rebate territory: 10,00,000 taxable produces 40,000 tax and 40,000 rebate. */
  it('is nothing where the rebate covers the whole bill', () => {
    const result = calculateAnnualTax({
      projectedIncome: 10_75_000,
      exemptions: 0,
      approvedDeductions: [],
      config: NEW_2025,
    });
    expect(result.projectedTaxableIncome).toBe(10_00_000);
    expect(result.incomeTax).toBe(40_000);
    expect(result.rebate).toBe(40_000);
    expect(result.cess).toBe(0);
    expect(result.annualTaxLiability).toBe(0);
  });

  it('applies slabs, then cess, in that order', () => {
    // 15,75,000 − 75,000 standard = 15,00,000 taxable
    // nil + 20,000 + 40,000 + 45,000 = 1,05,000; no rebate; cess 4% = 4,200
    const result = calculateAnnualTax({
      projectedIncome: 15_75_000,
      exemptions: 0,
      approvedDeductions: [],
      config: NEW_2025,
    });
    expect(result.projectedTaxableIncome).toBe(15_00_000);
    expect(result.incomeTax).toBe(1_05_000);
    expect(result.rebate).toBe(0);
    expect(result.cess).toBe(4_200);
    expect(result.annualTaxLiability).toBe(1_09_200);
  });

  it('works the Old regime end to end', () => {
    // 12,75,000 − 50,000 standard − 1,50,000 (80C) − 75,000 HRA = 10,00,000
    // nil + 12,500 + 1,00,000 = 1,12,500; no rebate; cess 4% = 4,500
    const result = calculateAnnualTax({
      projectedIncome: 12_75_000,
      exemptions: 75_000,
      approvedDeductions: [{ section: '80C', approvedAmount: 1_50_000 }],
      config: OLD_2025,
    });
    expect(result.projectedTaxableIncome).toBe(10_00_000);
    expect(result.incomeTax).toBe(1_12_500);
    expect(result.annualTaxLiability).toBe(1_17_000);
  });

  it('carries the full marginal-relief chain into the liability', () => {
    // taxable 50,10,000 → tax 13,15,500 · surcharge relieved to 7,000
    // cess 4% of 13,22,500 = 52,900
    const result = calculateAnnualTax({
      projectedIncome: 50_60_000,
      exemptions: 0,
      approvedDeductions: [],
      config: OLD_2025,
    });
    expect(result.projectedTaxableIncome).toBe(50_10_000);
    expect(result.surcharge).toBe(7_000);
    expect(result.cess).toBe(52_900);
    expect(result.annualTaxLiability).toBe(13_75_400);
  });

  it('reports every component so the figure can be explained, not just quoted', () => {
    const result = calculateAnnualTax({
      projectedIncome: 15_75_000,
      exemptions: 0,
      approvedDeductions: [],
      config: NEW_2025,
    });
    expect(result).toMatchObject({
      projectedAnnualIncome: 15_75_000,
      standardDeduction: 75_000,
      deductions: 0,
      exemptions: 0,
    });
    expect(result.slabs.length).toBeGreaterThan(0);
  });
});

// ── Monthly TDS ───────────────────────────────────────────────────────

describe('remaining tax', () => {
  it('is the year less what has already gone', () => {
    expect(calculateRemainingTax(1_20_000, 30_000)).toBe(90_000);
  });

  /*
   * Over-deduction leaves nothing further to take rather than a refund: an
   * employer cannot hand tax back through payroll, and the excess is settled on
   * assessment.
   */
  it('is never negative when more was deducted than is owed', () => {
    expect(calculateRemainingTax(50_000, 80_000)).toBe(0);
  });
});

describe('monthly TDS', () => {
  it('divides by the months actually left, not by twelve', () => {
    // The worked example from the brief.
    expect(
      calculateMonthlyTds({
        annualTaxLiability: 1_20_000,
        alreadyDeducted: 30_000,
        remainingMonths: 6,
      }),
    ).toMatchObject({ remainingTax: 90_000, monthlyTds: 15_000 });
  });

  it('spreads over twelve in April', () => {
    expect(
      calculateMonthlyTds({
        annualTaxLiability: 1_20_000,
        alreadyDeducted: 0,
        remainingMonths: calculateRemainingPayrollMonths('2026-04'),
      }).monthlyTds,
    ).toBe(10_000);
  });

  it('spreads over eleven in May, having taken April', () => {
    expect(
      calculateMonthlyTds({
        annualTaxLiability: 1_20_000,
        alreadyDeducted: 10_000,
        remainingMonths: calculateRemainingPayrollMonths('2026-05'),
      }).monthlyTds,
    ).toBe(10_000);
  });

  /* An approved declaration in December: the same rule, a smaller divisor. */
  it('re-spreads a reduced liability over what is left', () => {
    expect(
      calculateMonthlyTds({
        annualTaxLiability: 85_000,
        alreadyDeducted: 30_000,
        remainingMonths: calculateRemainingPayrollMonths('2026-09'),
      }),
    ).toMatchObject({ remainingTax: 55_000, remainingMonths: 7, monthlyTds: 7_857.14 });
  });

  it('takes the whole remainder in March', () => {
    expect(
      calculateMonthlyTds({
        annualTaxLiability: 1_20_000,
        alreadyDeducted: 1_10_000,
        remainingMonths: 1,
      }).monthlyTds,
    ).toBe(10_000);
  });

  it('deducts nothing once the year is fully paid', () => {
    expect(
      calculateMonthlyTds({
        annualTaxLiability: 1_20_000,
        alreadyDeducted: 1_20_000,
        remainingMonths: 3,
      }).monthlyTds,
    ).toBe(0);
  });

  it('deducts nothing when there are no payroll months left', () => {
    expect(
      calculateMonthlyTds({ annualTaxLiability: 1_20_000, alreadyDeducted: 0, remainingMonths: 0 })
        .monthlyTds,
    ).toBe(0);
  });

  /*
   * The rounding invariant. Twelve deductions each rounded to the paisa would
   * otherwise finish a few paise short of the liability, so March absorbs the
   * remainder and the year sums exactly.
   */
  it('sums to the liability exactly over a full year', () => {
    const liability = 1_00_000.05;
    let deducted = 0;
    for (const month of payrollMonthsRemaining('2026-04')) {
      const { monthlyTds } = calculateMonthlyTds({
        annualTaxLiability: liability,
        alreadyDeducted: deducted,
        remainingMonths: calculateRemainingPayrollMonths(month),
      });
      deducted = toRupees(toPaise(deducted) + toPaise(monthlyTds));
    }
    expect(deducted).toBe(liability);
  });

  it('sums exactly for a mid-year joiner too', () => {
    const liability = 87_654.32;
    let deducted = 0;
    for (const month of payrollMonthsRemaining('2026-10', { joinMonth: '2026-10' })) {
      const { monthlyTds } = calculateMonthlyTds({
        annualTaxLiability: liability,
        alreadyDeducted: deducted,
        remainingMonths: calculateRemainingPayrollMonths(month),
      });
      deducted = toRupees(toPaise(deducted) + toPaise(monthlyTds));
    }
    expect(deducted).toBe(liability);
  });
});

// ── Whole-year walkthroughs ───────────────────────────────────────────

describe('a year, month by month', () => {
  /**
   * Runs a financial year and returns what was deducted each month, given a
   * liability that may change part-way through.
   */
  function runYear(liabilityFor: (month: string) => number, months: string[]): number[] {
    let deducted = 0;
    const taken: number[] = [];
    for (const month of months) {
      const { monthlyTds } = calculateMonthlyTds({
        annualTaxLiability: liabilityFor(month),
        alreadyDeducted: deducted,
        remainingMonths: calculateRemainingPayrollMonths(month),
      });
      taken.push(monthlyTds);
      deducted = toRupees(toPaise(deducted) + toPaise(monthlyTds));
    }
    return taken;
  }

  it('is level across the year when nothing changes', () => {
    const taken = runYear(() => 1_20_000, payrollMonthsRemaining('2026-04'));
    expect(taken).toEqual(Array(12).fill(10_000));
  });

  /*
   * A salary revision in October. The past is untouched — the first six months
   * still took 10,000 — and only the remaining six absorb the increase.
   */
  it('changes only the future when salary is revised mid-year', () => {
    const months = payrollMonthsRemaining('2026-04');
    const taken = runYear((month) => (month >= '2026-10' ? 1_80_000 : 1_20_000), months);

    expect(taken.slice(0, 6)).toEqual(Array(6).fill(10_000));
    // 1,80,000 − 60,000 already taken = 1,20,000 over the remaining 6 months
    expect(taken.slice(6)).toEqual(Array(6).fill(20_000));
    expect(taken.reduce((sum, value) => toRupees(toPaise(sum) + toPaise(value)), 0)).toBe(1_80_000);
  });

  /*
   * A declaration approved in December cuts the bill. Nothing is refunded —
   * the already-deducted 90,000 stands — and the last four months simply take
   * less.
   */
  it('lowers only the remaining months when a declaration is approved', () => {
    const months = payrollMonthsRemaining('2026-04');
    const taken = runYear((month) => (month >= '2026-12' ? 1_00_000 : 1_20_000), months);

    expect(taken.slice(0, 8)).toEqual(Array(8).fill(10_000));
    // 1,00,000 − 80,000 = 20,000 over the last 4 months
    expect(taken.slice(8)).toEqual(Array(4).fill(5_000));
  });

  /*
   * A declaration approved so late that more has already been taken than is
   * owed. The remaining months take nothing; the excess is not refunded here.
   */
  it('stops deducting rather than refunding when the bill drops below what was taken', () => {
    const months = payrollMonthsRemaining('2026-04');
    const taken = runYear((month) => (month >= '2027-01' ? 50_000 : 1_20_000), months);

    expect(taken.slice(0, 9)).toEqual(Array(9).fill(10_000));
    expect(taken.slice(9)).toEqual([0, 0, 0]);
  });

  it('spreads a joiner over six months without back-charging April', () => {
    const months = payrollMonthsRemaining('2026-10', { joinMonth: '2026-10' });
    const taken = runYear(() => 60_000, months);
    expect(taken).toEqual(Array(6).fill(10_000));
  });

  it('takes everything in the last month for a March joiner', () => {
    const months = payrollMonthsRemaining('2027-03', { joinMonth: '2027-03' });
    expect(months).toEqual(['2027-03']);
    expect(runYear(() => 8_000, months)).toEqual([8_000]);
  });
});

// ── Purity ────────────────────────────────────────────────────────────

describe('purity', () => {
  /*
   * The same guard `tds-period.ts` carries. A clock or a
   * Prisma call in here would make a December recalculation of April disagree
   * with the payslip April was paid on.
   */
  it('has no clock and no database', () => {
    const source = readFileSync(`${__dirname}/tax.engine.ts`, 'utf8');
    expect(source).not.toMatch(/new Date\(|Date\.now|PrismaService|prisma\./);
  });

  it('returns the same answer twice for the same input', () => {
    const input = {
      projectedIncome: 18_00_000,
      exemptions: 1_80_000,
      approvedDeductions: [{ section: '80C', approvedAmount: 1_50_000 }],
      config: OLD_2025,
    };
    expect(calculateAnnualTax(input)).toEqual(calculateAnnualTax(input));
  });
});
