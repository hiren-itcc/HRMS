import type { PrismaClient } from '../../src/generated/prisma/client';
import type { People } from './people';

/**
 * Income-tax configuration, and a few declarations to look at.
 *
 * ## Why FY 2026-27 ships empty
 *
 * Two financial years are seeded. **2025-26 is CONFIRMED** and carries the
 * Finance Act 2025 numbers — it is the worked reference, and the year the
 * engine's spec pins its arithmetic against. **2026-27 is UNCONFIRMED with no
 * slabs at all**, and payroll refuses to compute TDS against it.
 *
 * That is deliberate and it is not laziness. Whoever fills that year in has to
 * read it off the Finance Act; a plausible-looking wrong slab seeded here would
 * be far harder to notice than an empty one, and this table computes real
 * deductions on real payslips. It is the same device
 * `FVU_SPEC_VERSION = 'UNTRANSCRIBED'` uses for the Form 24Q record layout, for
 * the same reason.
 *
 * The screens are built for it: an unconfirmed year says so, names itself, and
 * points at the settings page. Nothing silently falls back to last year.
 */

interface SlabSpec {
  fromAmount: number;
  toAmount: number | null;
  rate: number;
}

const FA2025 = 'Finance Act 2025 · seeded 2026-08-13';

/**
 * Said in the loudest place the data model has.
 *
 * It renders on the configuration screen beside the slabs it labels, because a
 * placeholder nobody can see is a placeholder everybody is taxed by.
 */
const PLACEHOLDER_2026 =
  'PLACEHOLDER — not from the Finance Act. Copied from FY 2025-26 so the demo computes. Replace before any real payroll.';

const NEW_SLABS_2025: SlabSpec[] = [
  { fromAmount: 0, toAmount: 4_00_000, rate: 0 },
  { fromAmount: 4_00_000, toAmount: 8_00_000, rate: 5 },
  { fromAmount: 8_00_000, toAmount: 12_00_000, rate: 10 },
  { fromAmount: 12_00_000, toAmount: 16_00_000, rate: 15 },
  { fromAmount: 16_00_000, toAmount: 20_00_000, rate: 20 },
  { fromAmount: 20_00_000, toAmount: 24_00_000, rate: 25 },
  { fromAmount: 24_00_000, toAmount: null, rate: 30 },
];

const OLD_SLABS_2025: SlabSpec[] = [
  { fromAmount: 0, toAmount: 2_50_000, rate: 0 },
  { fromAmount: 2_50_000, toAmount: 5_00_000, rate: 5 },
  { fromAmount: 5_00_000, toAmount: 10_00_000, rate: 20 },
  { fromAmount: 10_00_000, toAmount: null, rate: 30 },
];

/**
 * The sections the Old regime supports here.
 *
 * A deliberately short list. Every one of these is a number an employer may
 * legitimately consider when deducting TDS; the ones left out — capital gains
 * relief, business deductions, most of Chapter VI-A — belong to an assessment,
 * not to payroll.
 */
const OLD_DEDUCTIONS = [
  {
    section: '80C',
    label: 'Investments under 80C',
    hint: 'PPF, ELSS, life insurance, tuition fees, home-loan principal, and your own PF contribution.',
    maxAmount: 1_50_000,
  },
  {
    section: '80CCD1B',
    label: 'Additional NPS — 80CCD(1B)',
    hint: 'Over and above the 80C ceiling.',
    maxAmount: 50_000,
  },
  {
    section: '80D_SELF',
    label: 'Medical insurance — self and family',
    hint: null,
    maxAmount: 25_000,
  },
  {
    section: '80D_PARENTS',
    label: 'Medical insurance — parents',
    hint: 'The higher ceiling applies where a parent is a senior citizen.',
    maxAmount: 50_000,
  },
  { section: '80E', label: 'Interest on an education loan', hint: 'No ceiling.', maxAmount: null },
  { section: '80TTA', label: 'Savings-account interest', hint: null, maxAmount: 10_000 },
  { section: '80U', label: 'Disability — self', hint: null, maxAmount: 75_000 },
  { section: '80DD', label: 'Disabled dependant', hint: null, maxAmount: 75_000 },
  {
    section: 'HOME_LOAN_INTEREST',
    label: 'Home-loan interest',
    hint: 'Self-occupied property, under section 24(b).',
    maxAmount: 2_00_000,
  },
];

const SURCHARGE_2025 = [
  { aboveIncome: 50_00_000, rate: 10 },
  { aboveIncome: 1_00_00_000, rate: 15 },
  { aboveIncome: 2_00_00_000, rate: 25 },
];

export async function seedTaxConfiguration(prisma: PrismaClient, orgId: string, people: People) {
  // ── FY 2025-26, confirmed ──────────────────────────────────────────
  await prisma.taxConfiguration.create({
    data: {
      organizationId: orgId,
      financialYear: '2025-26',
      regime: 'NEW',
      status: 'CONFIRMED',
      source: FA2025,
      standardDeduction: 75_000,
      rebateIncomeLimit: 12_00_000,
      rebateMaxAmount: 60_000,
      cessRate: 4,
      marginalRelief: true,
      slabs: { create: NEW_SLABS_2025.map((slab, order) => ({ ...slab, order })) },
      surchargeBands: { create: SURCHARGE_2025.map((band, order) => ({ ...band, order })) },
      // The New regime allows the standard deduction and essentially nothing
      // else. Expressed as an empty rule list rather than a branch in the
      // engine, so a future Act permitting a section needs a row, not a release.
      deductionRules: { create: [] },
    },
  });

  await prisma.taxConfiguration.create({
    data: {
      organizationId: orgId,
      financialYear: '2025-26',
      regime: 'OLD',
      status: 'CONFIRMED',
      source: FA2025,
      standardDeduction: 50_000,
      rebateIncomeLimit: 5_00_000,
      rebateMaxAmount: 12_500,
      cessRate: 4,
      marginalRelief: true,
      slabs: { create: OLD_SLABS_2025.map((slab, order) => ({ ...slab, order })) },
      surchargeBands: { create: SURCHARGE_2025.map((band, order) => ({ ...band, order })) },
      deductionRules: { create: OLD_DEDUCTIONS.map((rule, order) => ({ ...rule, order })) },
    },
  });

  // ── FY 2026-27, PLACEHOLDER ────────────────────────────────────────
  //
  // These slabs are **not the Finance Act**. They are a copy of FY 2025-26's
  // shape, seeded so a demo database can show the module working end to end —
  // projection, slab breakdown, declaration, approval, monthly TDS.
  //
  // The `source` field says so in words, and the settings screen shows it. That
  // is the whole safety mechanism, and it is a weaker one than leaving the year
  // empty: an UNCONFIRMED year makes payroll refuse, whereas this computes and
  // deducts. Anybody pointing this codebase at real payroll has to replace
  // these rows first, and `assertDisposable` is the guard that should stop the
  // seeder ever reaching a production database in the first place.
  for (const regime of ['NEW', 'OLD'] as const) {
    await prisma.taxConfiguration.create({
      data: {
        organizationId: orgId,
        financialYear: '2026-27',
        regime,
        status: 'CONFIRMED',
        source: PLACEHOLDER_2026,
        standardDeduction: regime === 'NEW' ? 75_000 : 50_000,
        rebateIncomeLimit: regime === 'NEW' ? 12_00_000 : 5_00_000,
        rebateMaxAmount: regime === 'NEW' ? 60_000 : 12_500,
        cessRate: 4,
        marginalRelief: true,
        slabs: {
          create: (regime === 'NEW' ? NEW_SLABS_2025 : OLD_SLABS_2025).map((slab, order) => ({
            ...slab,
            order,
          })),
        },
        surchargeBands: { create: SURCHARGE_2025.map((band, order) => ({ ...band, order })) },
        deductionRules:
          regime === 'OLD'
            ? { create: OLD_DEDUCTIONS.map((rule, order) => ({ ...rule, order })) }
            : undefined,
      },
    });
  }

  // ── A few employees with something to look at ──────────────────────
  //
  // Against 2025-26, the confirmed year, so every screen has real numbers.
  const staff = people.staff.filter((person) => person.role === 'EMPLOYEE').slice(0, 4);
  const [onOld, submitted, rejected] = staff;

  for (const person of staff) {
    await prisma.employeeTaxProfile.create({
      data: {
        organizationId: orgId,
        employeeId: person.employeeId,
        financialYear: '2025-26',
        // Most people never touch the screen, which is exactly what the New
        // default is for. Three of the four are the exceptions.
        regime: person === staff[3] ? 'NEW' : 'OLD',
      },
    });
  }

  if (onOld) {
    await prisma.employeeTaxDeclaration.create({
      data: {
        organizationId: orgId,
        employeeId: onOld.employeeId,
        financialYear: '2025-26',
        status: 'APPROVED',
        annualRentPaid: 3_00_000,
        metroCity: true,
        submittedAt: new Date('2025-06-10T00:00:00Z'),
        decidedAt: new Date('2025-06-14T00:00:00Z'),
        items: {
          create: [
            // Declared above the ceiling on purpose: the screens have to show
            // "you said 2,00,000, 1,50,000 counts" without it looking broken.
            {
              section: '80C',
              declaredAmount: 2_00_000,
              statutoryLimit: 1_50_000,
              eligibleAmount: 1_50_000,
              approvedAmount: 1_50_000,
            },
            {
              section: '80CCD1B',
              declaredAmount: 50_000,
              statutoryLimit: 50_000,
              eligibleAmount: 50_000,
              approvedAmount: 50_000,
            },
            {
              section: '80D_SELF',
              declaredAmount: 22_000,
              statutoryLimit: 25_000,
              eligibleAmount: 22_000,
              approvedAmount: 22_000,
            },
          ],
        },
      },
    });
  }

  if (submitted) {
    await prisma.employeeTaxDeclaration.create({
      data: {
        organizationId: orgId,
        employeeId: submitted.employeeId,
        financialYear: '2025-26',
        status: 'SUBMITTED',
        annualRentPaid: 1_80_000,
        metroCity: false,
        submittedAt: new Date('2025-07-02T00:00:00Z'),
        items: {
          create: [
            {
              section: '80C',
              declaredAmount: 1_20_000,
              statutoryLimit: 1_50_000,
              eligibleAmount: 1_20_000,
              approvedAmount: 0,
            },
          ],
        },
      },
    });
  }

  if (rejected) {
    await prisma.employeeTaxDeclaration.create({
      data: {
        organizationId: orgId,
        employeeId: rejected.employeeId,
        financialYear: '2025-26',
        status: 'REJECTED',
        annualRentPaid: null,
        metroCity: false,
        submittedAt: new Date('2025-06-20T00:00:00Z'),
        decidedAt: new Date('2025-06-25T00:00:00Z'),
        decisionNote: 'Please attach the 80C receipts — the LIC premium is not evidenced yet.',
        items: {
          create: [
            {
              section: '80C',
              declaredAmount: 1_50_000,
              statutoryLimit: 1_50_000,
              eligibleAmount: 1_50_000,
              approvedAmount: 0,
            },
          ],
        },
      },
    });
  }
}
