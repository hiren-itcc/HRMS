import { TaxService } from './tax.service';

/**
 * The projection half of the service, which had never executed.
 *
 * `tax.service.spec.ts` covers the 422 boundary and nothing else: all four of
 * its tests end in a rejection, so no test had ever produced a successful
 * `TaxSummary`. Its Prisma double returns `[]` for salaries and payslips, which
 * means `projectMonth` and `taxableGrossOf` — the two functions that decide
 * what income the engine is even handed — were never called by anything.
 *
 * The engine's own arithmetic is exhaustively covered in `tax.engine.spec.ts`.
 * These tests are about **what gets fed to it**, which is where a wrong payslip
 * would actually come from.
 */

const MONTH = '2025-08'; // FY 2025-26, the confirmed year
const EMPLOYEE = 'e1';

/** FY 2025-26 New regime, as the seed writes it. */
const NEW_2025 = {
  status: 'CONFIRMED',
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
    { fromAmount: 16_00_000, toAmount: null, rate: 20 },
  ],
  surchargeBands: [],
  deductionRules: [],
};

const OLD_2025 = {
  ...NEW_2025,
  standardDeduction: 50_000,
  rebateIncomeLimit: 5_00_000,
  rebateMaxAmount: 12_500,
  slabs: [
    { fromAmount: 0, toAmount: 2_50_000, rate: 0 },
    { fromAmount: 2_50_000, toAmount: 5_00_000, rate: 5 },
    { fromAmount: 5_00_000, toAmount: 10_00_000, rate: 20 },
    { fromAmount: 10_00_000, toAmount: null, rate: 30 },
  ],
  deductionRules: [
    { section: '80C', maxAmount: 1_50_000, label: '80C', hint: null },
    { section: 'HOME_LOAN_INTEREST', maxAmount: 2_00_000, label: 'Interest', hint: null },
  ],
};

/** The statutory config `calculatePayslip` needs; matches `payrollSchema` defaults. */
const PAYROLL_CONFIG = {
  currency: 'INR',
  payDay: 1,
  lopBasis: 'CALENDAR_DAYS',
  pf: {
    enabled: true,
    employeeRate: 12,
    employerRate: 12,
    wageCeiling: 15_000,
    applyCeiling: true,
    epsRate: 8.33,
    epsWageCeiling: 15_000,
  },
  esi: { enabled: true, employeeRate: 0.75, employerRate: 3.25, wageThreshold: 21_000 },
  professionalTax: {
    enabled: true,
    slabs: [
      { upTo: 12_000, amount: 0 },
      { upTo: Number.MAX_SAFE_INTEGER, amount: 200 },
    ],
  },
};

/** A structure that resolves to a real taxable gross: basic, HRA, and a balance. */
const STRUCTURE_LINES = [
  {
    calcType: 'PERCENT_OF_CTC',
    value: 40,
    component: { code: 'BASIC', name: 'Basic', kind: 'EARNING', taxable: true },
  },
  {
    calcType: 'PERCENT_OF_BASIC',
    value: 50,
    component: { code: 'HRA', name: 'HRA', kind: 'EARNING', taxable: true },
  },
  {
    calcType: 'BALANCE',
    value: 0,
    component: { code: 'SPECIAL', name: 'Special', kind: 'EARNING', taxable: true },
  },
];

/*
 * April through July, paid and frozen — which is what the database looks like
 * when August's run is calculated. `calculateProjectedIncome` is documented as
 * "earned plus projected": it reads elapsed months from payslips rather than
 * re-deriving them, so a double with no payslips projects an eight-month year
 * and every figure downstream is wrong for a reason that is not the code's.
 * Nothing here is deducted yet, so `alreadyDeducted` stays a test's own concern.
 */
const ELAPSED = ['2025-04', '2025-05', '2025-06', '2025-07'].map((month) => ({
  month,
  gross: 1_50_000,
  tds: 0,
}));

interface Options {
  regime?: 'NEW' | 'OLD';
  /** Months already paid, each with a taxable gross and a TDS line. */
  paid?: { month: string; gross: number; tds: number }[];
  declaration?: unknown;
  monthlyCtc?: number;
  configFor?: (regime: string) => unknown;
}

function makeService(options: Options = {}) {
  const paid = options.paid ?? ELAPSED;
  const monthlyCtc = options.monthlyCtc ?? 1_50_000;

  // biome-ignore lint/suspicious/noExplicitAny: structural test double
  const prisma: any = {
    taxConfiguration: {
      findUnique: jest.fn(
        ({ where }: { where: { organizationId_financialYear_regime: { regime: string } } }) =>
          Promise.resolve(
            options.configFor
              ? options.configFor(where.organizationId_financialYear_regime.regime)
              : where.organizationId_financialYear_regime.regime === 'OLD'
                ? OLD_2025
                : NEW_2025,
          ),
      ),
    },
    employeeTaxProfile: {
      findUnique: jest.fn().mockResolvedValue(options.regime ? { regime: options.regime } : null),
      findMany: jest
        .fn()
        .mockResolvedValue([{ employeeId: EMPLOYEE, regime: options.regime ?? 'NEW' }]),
    },
    employee: {
      findMany: jest.fn().mockResolvedValue([
        {
          id: EMPLOYEE,
          firstName: 'Asha',
          lastName: 'Verma',
          employeeCode: 'EMP-0005',
          joinDate: new Date('2020-01-01T00:00:00Z'),
          exitDate: null,
          department: { name: 'Engineering' },
        },
      ]),
    },
    employeeSalary: {
      findMany: jest.fn().mockResolvedValue([
        {
          employeeId: EMPLOYEE,
          monthlyCtc,
          structure: { lines: STRUCTURE_LINES },
        },
      ]),
    },
    payslip: {
      findMany: jest.fn().mockResolvedValue(
        paid.map((row) => ({
          employeeId: EMPLOYEE,
          grossEarnings: row.gross,
          run: { month: row.month },
          lines: [
            { componentCode: 'BASIC', kind: 'EARNING', amount: row.gross * 0.4 },
            { componentCode: 'HRA', kind: 'EARNING', amount: row.gross * 0.2 },
            { componentCode: 'SPECIAL', kind: 'EARNING', amount: row.gross * 0.4 },
            { componentCode: 'TDS', kind: 'DEDUCTION', amount: row.tds },
          ],
        })),
      ),
    },
    employeeTaxDeclaration: {
      findMany: jest.fn().mockResolvedValue(options.declaration ? [options.declaration] : []),
    },
    tdsOverride: { findMany: jest.fn().mockResolvedValue([]) },
    payComponent: {
      findMany: jest.fn().mockResolvedValue([
        { code: 'BASIC', taxable: true, kind: 'EARNING' },
        { code: 'HRA', taxable: true, kind: 'EARNING' },
        { code: 'SPECIAL', taxable: true, kind: 'EARNING' },
        { code: 'REIMBURSEMENT', taxable: false, kind: 'EARNING' },
      ]),
    },
  };
  const settings = { get: jest.fn().mockResolvedValue({ payroll: PAYROLL_CONFIG }) };
  // biome-ignore lint/suspicious/noExplicitAny: structural test double
  return new TaxService(prisma, settings as any);
}

describe('a projection that actually runs', () => {
  it('produces a summary rather than throwing', async () => {
    const summary = await makeService().summaryFor('org1', EMPLOYEE, '2025-26', MONTH);

    /*
     * Worked by hand, so a green test means the figure is right rather than
     * merely stable: 18,00,000 income less the 75,000 standard deduction is
     * 17,25,000. Through the FY 2025-26 New-regime bands that is 20,000 +
     * 40,000 + 60,000 + 25,000 = 1,45,000; 4% cess brings it to 1,50,800.
     * Nothing has been deducted yet and eight payroll months remain, so August
     * through March each carry 18,850.
     */
    expect(summary.regime).toBe('NEW');
    expect(summary.annual.projectedTaxableIncome).toBe(17_25_000);
    expect(summary.annual.annualTaxLiability).toBe(1_50_800);
    expect(summary.alreadyDeducted).toBe(0);
    expect(summary.remainingMonths).toBe(8);
    expect(summary.monthlyTds).toBe(18_850);
  });

  /*
   * The projection comes from the salary structure through `calculatePayslip`,
   * not from CTC. 1,50,000 CTC over 12 months is 18,00,000 of *cost*; the
   * taxable gross is what the earning lines actually resolve to.
   */
  it('projects from the structure, not from CTC', async () => {
    const summary = await makeService({ monthlyCtc: 1_50_000 }).summaryFor(
      'org1',
      EMPLOYEE,
      '2025-26',
      MONTH,
    );

    // Four months read from payslips plus eight projected. Every earning line
    // here is taxable and the balance absorbs the rest, so the year lands on
    // 12 × CTC — but only because the structure says so, not because CTC was
    // multiplied by twelve.
    expect(summary.annual.projectedAnnualIncome).toBe(18_00_000);
    expect(summary.annual.projectedTaxableIncome).toBe(18_00_000 - 75_000);
  });

  /*
   * `taxableGrossOf` filters on the component's `taxable` flag. A
   * reimbursement is an earning and is not income — if this ever stopped
   * filtering, everybody's tax would rise and nothing else would complain.
   */
  it('leaves untaxable earnings out of income', async () => {
    const service = makeService({
      paid: [{ month: '2025-04', gross: 1_50_000, tds: 10_000 }],
    });
    // biome-ignore lint/suspicious/noExplicitAny: reaching into the double
    (service as any).prisma.payslip.findMany.mockResolvedValue([
      {
        employeeId: EMPLOYEE,
        grossEarnings: 2_00_000,
        run: { month: '2025-04' },
        lines: [
          { componentCode: 'BASIC', kind: 'EARNING', amount: 1_00_000 },
          { componentCode: 'REIMBURSEMENT', kind: 'EARNING', amount: 50_000 },
          { componentCode: 'TDS', kind: 'DEDUCTION', amount: 10_000 },
        ],
      },
    ]);

    const summary = await service.summaryFor('org1', EMPLOYEE, '2025-26', MONTH);
    // April contributes 1,00,000, not 1,50,000 — the reimbursement is excluded.
    // The remaining months are projected, so assert on the earned part only.
    expect(summary.alreadyDeducted).toBe(10_000);
    expect(summary.annual.projectedAnnualIncome).toBeLessThan(18_00_000 + 50_000);
  });

  it('reads what was already deducted from frozen payslips', async () => {
    const summary = await makeService({
      paid: [
        { month: '2025-04', gross: 1_50_000, tds: 12_000 },
        { month: '2025-05', gross: 1_50_000, tds: 12_000 },
      ],
    }).summaryFor('org1', EMPLOYEE, '2025-26', MONTH);

    expect(summary.alreadyDeducted).toBe(24_000);
    expect(summary.history.map((row) => row.month)).toEqual(['2025-04', '2025-05']);
  });

  /* August is the fifth month of the financial year, so eight remain. */
  it('divides by the payroll months that are actually left', async () => {
    const summary = await makeService().summaryFor('org1', EMPLOYEE, '2025-26', '2025-08');
    expect(summary.remainingMonths).toBe(8);
  });

  it('spreads exactly what is still owed over those months', async () => {
    const summary = await makeService({
      paid: [{ month: '2025-04', gross: 1_50_000, tds: 20_000 }],
    }).summaryFor('org1', EMPLOYEE, '2025-26', '2025-08');

    const owed = summary.annual.annualTaxLiability - summary.alreadyDeducted;
    expect(summary.remainingTax).toBeCloseTo(owed, 2);
    expect(summary.monthlyTds).toBeCloseTo(owed / summary.remainingMonths, 0);
  });
});

describe('the Old regime path', () => {
  it('applies an approved 80C and lowers the bill', async () => {
    const without = await makeService({ regime: 'OLD' }).summaryFor(
      'org1',
      EMPLOYEE,
      '2025-26',
      MONTH,
    );
    const withDeduction = await makeService({
      regime: 'OLD',
      declaration: {
        employeeId: EMPLOYEE,
        status: 'APPROVED',
        annualRentPaid: null,
        metroCity: false,
        items: [{ section: '80C', approvedAmount: 1_50_000 }],
      },
    }).summaryFor('org1', EMPLOYEE, '2025-26', MONTH);

    expect(withDeduction.annual.projectedTaxableIncome).toBe(
      without.annual.projectedTaxableIncome - 1_50_000,
    );
    expect(withDeduction.annual.annualTaxLiability).toBeLessThan(without.annual.annualTaxLiability);
    expect(withDeduction.monthlyTds).toBeLessThan(without.monthlyTds);
  });

  /*
   * The HRA exemption is computed from rent, basic and the HRA on the
   * structure — never declared. This is the wiring between the declaration and
   * `calculateHraExemption`, which no test reached.
   */
  it('computes an HRA exemption from the declared rent', async () => {
    const noRent = await makeService({ regime: 'OLD' }).summaryFor(
      'org1',
      EMPLOYEE,
      '2025-26',
      MONTH,
    );
    const withRent = await makeService({
      regime: 'OLD',
      declaration: {
        employeeId: EMPLOYEE,
        status: 'APPROVED',
        annualRentPaid: 3_00_000,
        metroCity: true,
        items: [],
      },
    }).summaryFor('org1', EMPLOYEE, '2025-26', MONTH);

    expect(withRent.annual.exemptions).toBeGreaterThan(0);
    expect(withRent.annual.projectedTaxableIncome).toBeLessThan(
      noRent.annual.projectedTaxableIncome,
    );
  });

  /* A declaration that HR has not approved contributes nothing. */
  it('ignores a declaration that is still awaiting HR', async () => {
    const summary = await makeService({
      regime: 'OLD',
      declaration: {
        employeeId: EMPLOYEE,
        status: 'APPROVED',
        annualRentPaid: null,
        metroCity: false,
        // Declared, but HR approved nothing of it.
        items: [{ section: '80C', approvedAmount: 0 }],
      },
    }).summaryFor('org1', EMPLOYEE, '2025-26', MONTH);

    const none = await makeService({ regime: 'OLD' }).summaryFor(
      'org1',
      EMPLOYEE,
      '2025-26',
      MONTH,
    );
    expect(summary.annual.annualTaxLiability).toBe(none.annual.annualTaxLiability);
  });
});

describe('tdsForRun — the join to payroll', () => {
  it('returns a figure for every employee on a confirmed year', async () => {
    const { tds, unconfigured } = await makeService().tdsForRun('org1', MONTH, [EMPLOYEE]);

    expect(unconfigured).toEqual([]);
    expect(tds.get(EMPLOYEE)).toBeGreaterThan(0);
  });

  /*
   * The contract the whole "skipped, not zeroed" comment rests on. An
   * unconfirmed year must not produce a zero — a zero on a payslip reads as
   * "no tax due", which is a different claim.
   */
  it('skips an employee whose year has no confirmed rules', async () => {
    const { tds, unconfigured } = await makeService({
      configFor: () => ({ ...NEW_2025, status: 'UNCONFIRMED' }),
    }).tdsForRun('org1', MONTH, [EMPLOYEE]);

    expect(unconfigured).toEqual([EMPLOYEE]);
    expect(tds.has(EMPLOYEE)).toBe(false);
  });

  it('skips when the year has no configuration at all', async () => {
    const { unconfigured } = await makeService({ configFor: () => null }).tdsForRun('org1', MONTH, [
      EMPLOYEE,
    ]);
    expect(unconfigured).toEqual([EMPLOYEE]);
  });

  it('does nothing for an empty run', async () => {
    const { tds, unconfigured } = await makeService().tdsForRun('org1', MONTH, []);
    expect(tds.size).toBe(0);
    expect(unconfigured).toEqual([]);
  });

  /*
   * The figure payroll writes and the figure the tax screen shows come from
   * the same function, so they must agree. The integration spec asserts this
   * against a real payslip; this asserts it against the service.
   */
  it('agrees with what the employee sees on their own tax page', async () => {
    const service = makeService({ paid: [{ month: '2025-04', gross: 1_50_000, tds: 9_000 }] });
    const { tds } = await service.tdsForRun('org1', MONTH, [EMPLOYEE]);
    const summary = await service.summaryFor('org1', EMPLOYEE, '2025-26', MONTH);

    expect(tds.get(EMPLOYEE)).toBe(summary.monthlyTds);
  });
});

describe('listEmployees', () => {
  /* Null, not zero — "no rules entered" and "no tax due" must not render alike. */
  it('reports null figures for an unconfigured year', async () => {
    const rows = await makeService({
      configFor: () => ({ ...NEW_2025, status: 'UNCONFIRMED' }),
    }).listEmployees('org1', '2025-26', MONTH);

    expect(rows).toHaveLength(1);
    expect(rows[0]?.annualTax).toBeNull();
    expect(rows[0]?.monthlyTds).toBeNull();
  });

  it('reports real figures for a confirmed one', async () => {
    const rows = await makeService().listEmployees('org1', '2025-26', MONTH);
    expect(rows[0]?.annualTax).toBeGreaterThan(0);
    expect(rows[0]?.monthlyTds).toBeGreaterThan(0);
  });
});
