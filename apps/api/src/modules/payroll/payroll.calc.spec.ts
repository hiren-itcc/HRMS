import { defaultSettings } from '@hrms/shared';
import {
  type AdjustmentInput,
  calculatePayslip,
  employedDays,
  periodDays,
  resolveEarnings,
  type StructureLineInput,
} from './payroll.calc';

const config = () => defaultSettings().payroll;

/** A 60,000/month structure: 40% basic, 50% of basic as HRA, rest as special. */
const STRUCTURE: StructureLineInput[] = [
  {
    code: 'BASIC',
    name: 'Basic Salary',
    kind: 'EARNING',
    calcType: 'PERCENT_OF_CTC',
    value: 40,
    order: 1,
  },
  {
    code: 'HRA',
    name: 'House Rent Allowance',
    kind: 'EARNING',
    calcType: 'PERCENT_OF_BASIC',
    value: 50,
    order: 2,
  },
  {
    code: 'CONVEYANCE',
    name: 'Conveyance Allowance',
    kind: 'EARNING',
    calcType: 'FLAT',
    value: 1600,
    order: 3,
  },
  {
    code: 'SPECIAL',
    name: 'Special Allowance',
    kind: 'EARNING',
    calcType: 'BALANCE',
    value: 0,
    order: 4,
  },
];

const base = { month: '2026-06', monthlyCtc: 60_000, lines: STRUCTURE, config: config() };

describe('resolveEarnings', () => {
  it('resolves percentages against CTC and basic, and BALANCE against the rest', () => {
    const amounts = resolveEarnings(STRUCTURE, 60_000);
    expect(amounts.get('BASIC')).toBe(24_000); // 40% of CTC
    expect(amounts.get('HRA')).toBe(12_000); // 50% of basic
    expect(amounts.get('CONVEYANCE')).toBe(1600);
    expect(amounts.get('SPECIAL')).toBe(22_400); // the remainder
  });

  it('makes the earnings sum to CTC exactly', () => {
    const total = [...resolveEarnings(STRUCTURE, 60_000).values()].reduce((a, b) => a + b, 0);
    expect(total).toBe(60_000);
  });

  it('computes basic before the lines that depend on it, whatever the order', () => {
    const shuffled = [...STRUCTURE].reverse();
    expect(resolveEarnings(shuffled, 60_000).get('HRA')).toBe(12_000);
  });

  it('never makes BALANCE negative when the structure over-specifies CTC', () => {
    const greedy: StructureLineInput[] = [
      { code: 'BASIC', name: 'Basic', kind: 'EARNING', calcType: 'FLAT', value: 50_000, order: 1 },
      { code: 'HRA', name: 'HRA', kind: 'EARNING', calcType: 'FLAT', value: 30_000, order: 2 },
      {
        code: 'SPECIAL',
        name: 'Special',
        kind: 'EARNING',
        calcType: 'BALANCE',
        value: 0,
        order: 3,
      },
    ];
    expect(resolveEarnings(greedy, 60_000).get('SPECIAL')).toBe(0);
  });
});

describe('periodDays and employedDays', () => {
  it('counts calendar days by default', () => {
    expect(periodDays('2026-06', config())).toBe(30);
    expect(periodDays('2026-02', config())).toBe(28); // 2026 is not a leap year
    expect(periodDays('2024-02', config())).toBe(29);
  });

  it('counts working days when configured to', () => {
    const cfg = config();
    cfg.lopBasis = 'WORKING_DAYS';
    expect(periodDays('2026-06', cfg)).toBe(22);
  });

  it('pays a joiner from their join date, inclusive', () => {
    // Joined on the 15th of a 30-day month → 16 days (15th through 30th).
    expect(employedDays('2026-06', config(), [0, 6], '2026-06-15')).toBe(16);
  });

  it('pays a leaver up to their exit date, inclusive', () => {
    expect(employedDays('2026-06', config(), [0, 6], null, '2026-06-10')).toBe(10);
  });

  it('pays a full month for someone who joined earlier', () => {
    expect(employedDays('2026-06', config(), [0, 6], '2020-01-01')).toBe(30);
  });

  it('pays nothing for someone who left before the month', () => {
    expect(employedDays('2026-06', config(), [0, 6], null, '2026-05-31')).toBe(0);
  });
});

describe('calculatePayslip — full month', () => {
  const result = calculatePayslip(base);

  it('grosses the full CTC', () => {
    expect(result.grossEarnings).toBe(60_000);
    expect(result.payableDays).toBe(30);
    expect(result.lopDays).toBe(0);
  });

  it('levies PF on basic at the ceiling, and no ESI above the threshold', () => {
    const pf = result.lines.find((l) => l.code === 'PF');
    expect(pf?.amount).toBe(1800); // 12% of the 15,000 ceiling
    expect(result.lines.find((l) => l.code === 'ESI')).toBeUndefined();
  });

  it('charges the top professional tax slab', () => {
    expect(result.lines.find((l) => l.code === 'PT')?.amount).toBe(200);
  });

  it('nets gross minus deductions', () => {
    expect(result.netPay).toBe(result.grossEarnings - result.totalDeductions);
    expect(result.carriedShortfall).toBe(0);
  });

  it('reports employer cost without deducting it from net', () => {
    expect(result.employerContribution).toBe(1800);
    expect(result.netPay).toBe(60_000 - result.totalDeductions);
  });

  it('sums its own lines', () => {
    const earnings = result.lines.filter((l) => l.kind === 'EARNING');
    const deductions = result.lines.filter((l) => l.kind === 'DEDUCTION');
    expect(earnings.reduce((s, l) => s + l.amount, 0)).toBe(result.grossEarnings);
    expect(deductions.reduce((s, l) => s + l.amount, 0)).toBe(result.totalDeductions);
  });
});

describe('calculatePayslip — proration', () => {
  it('halves pay for someone who joined mid-month', () => {
    const result = calculatePayslip({ ...base, joinDate: '2026-06-16' });
    expect(result.payableDays).toBe(15);
    expect(result.grossEarnings).toBe(30_000);
  });

  it('prorates for someone who left mid-month', () => {
    const result = calculatePayslip({ ...base, exitDate: '2026-06-15' });
    expect(result.payableDays).toBe(15);
    expect(result.grossEarnings).toBe(30_000);
  });

  it('deducts loss of pay days', () => {
    const result = calculatePayslip({ ...base, lopDays: 3 });
    expect(result.payableDays).toBe(27);
    expect(result.grossEarnings).toBe(54_000);
  });

  it('combines a mid-month join with loss of pay', () => {
    const result = calculatePayslip({ ...base, joinDate: '2026-06-16', lopDays: 5 });
    expect(result.payableDays).toBe(10);
    expect(result.grossEarnings).toBe(20_000);
  });

  it('caps LOP at the days actually employed', () => {
    // A stale leave record must not push someone into negative attendance.
    const result = calculatePayslip({ ...base, joinDate: '2026-06-16', lopDays: 40 });
    expect(result.lopDays).toBe(15);
    expect(result.payableDays).toBe(0);
    expect(result.grossEarnings).toBe(0);
  });

  it('pays nothing, not a negative, for a whole month of LOP', () => {
    const result = calculatePayslip({ ...base, lopDays: 30 });
    expect(result.grossEarnings).toBe(0);
    expect(result.netPay).toBe(0);
  });
});

describe('calculatePayslip — ESI band', () => {
  it('charges ESI for a low earner', () => {
    const result = calculatePayslip({ ...base, monthlyCtc: 18_000 });
    expect(result.lines.find((l) => l.code === 'ESI')?.amount).toBe(135); // 0.75% of 18,000
    expect(result.employerContribution).toBeGreaterThan(0);
  });

  it('prorating below the threshold brings ESI into play', () => {
    // Full month grosses 60,000 (no ESI); half a month grosses 30,000 — still
    // above. A quarter month is 15,000 and does attract it.
    const result = calculatePayslip({ ...base, lopDays: 22.5 });
    expect(result.grossEarnings).toBe(15_000);
    expect(result.lines.find((l) => l.code === 'ESI')?.amount).toBe(112.5);
  });
});

describe('calculatePayslip — adjustments', () => {
  const bonus: AdjustmentInput = {
    code: 'BONUS',
    name: 'Festival Bonus',
    kind: 'EARNING',
    amount: 10_000,
  };

  it('adds an earning adjustment to gross', () => {
    const result = calculatePayslip({ ...base, adjustments: [bonus] });
    expect(result.grossEarnings).toBe(70_000);
  });

  it('does not prorate an adjustment — a bonus is not earned by the day', () => {
    const result = calculatePayslip({ ...base, lopDays: 15, adjustments: [bonus] });
    expect(result.grossEarnings).toBe(40_000); // 30,000 prorated + 10,000 bonus
  });

  it('takes a deduction adjustment such as a loan EMI', () => {
    const emi: AdjustmentInput = {
      code: 'LOAN',
      name: 'Loan Deduction',
      kind: 'DEDUCTION',
      amount: 5000,
    };
    const result = calculatePayslip({ ...base, adjustments: [emi] });
    expect(result.lines.find((l) => l.code === 'LOAN')?.amount).toBe(5000);
  });
});

describe('calculatePayslip — never a negative salary', () => {
  it('clamps deductions to gross and carries the rest', () => {
    // A heavy LOP month plus a large loan EMI genuinely asks for more than
    // was earned.
    const result = calculatePayslip({
      ...base,
      lopDays: 28,
      adjustments: [{ code: 'LOAN', name: 'Loan Deduction', kind: 'DEDUCTION', amount: 20_000 }],
    });
    expect(result.grossEarnings).toBe(4000);
    expect(result.netPay).toBe(0);
    expect(result.totalDeductions).toBe(4000);
    expect(result.carriedShortfall).toBeGreaterThan(0);
  });

  it('takes statutory deductions before discretionary ones', () => {
    // PF and PT are legal obligations; a loan recovery can wait a month.
    const result = calculatePayslip({
      ...base,
      lopDays: 29,
      adjustments: [{ code: 'LOAN', name: 'Loan Deduction', kind: 'DEDUCTION', amount: 50_000 }],
    });
    const codes = result.lines.filter((l) => l.kind === 'DEDUCTION').map((l) => l.code);
    expect(codes).toContain('PF');
    expect(result.netPay).toBe(0);
  });

  it('reports no shortfall when everything fits', () => {
    expect(calculatePayslip(base).carriedShortfall).toBe(0);
  });
});

describe('calculatePayslip — TDS', () => {
  it('deducts the entered monthly figure verbatim', () => {
    const result = calculatePayslip({ ...base, monthlyTds: 4500 });
    expect(result.lines.find((l) => l.code === 'TDS')?.amount).toBe(4500);
  });

  it('omits the line when no TDS is set', () => {
    expect(calculatePayslip(base).lines.find((l) => l.code === 'TDS')).toBeUndefined();
  });
});

describe('deduction priority when gross runs out', () => {
  const withLoan = (lopDays: number, extra: StructureLineInput[] = []) =>
    calculatePayslip({
      ...base,
      lines: [...STRUCTURE, ...extra],
      lopDays,
      adjustments: [{ code: 'LOAN', name: 'Loan Deduction', kind: 'DEDUCTION', amount: 50_000 }],
    });

  it('pays statutory deductions before a loan recovery', () => {
    const result = withLoan(29);
    const pf = result.lines.find((l) => l.code === 'PF');
    expect(pf?.amount).toBeGreaterThan(0);
  });

  it('does not let a low display order jump the statutory queue', () => {
    // "Other deductions" prints first but must still be taken after PF —
    // display order and payment priority are deliberately different things.
    const result = withLoan(29, [
      {
        code: 'OTHER_DEDUCTION',
        name: 'Other Deductions',
        kind: 'DEDUCTION',
        calcType: 'FLAT',
        value: 40_000,
        order: 1,
      },
    ]);
    const pf = result.lines.find((l) => l.code === 'PF');
    expect(pf?.amount).toBeGreaterThan(0);
    expect(result.netPay).toBe(0);
    expect(result.carriedShortfall).toBeGreaterThan(0);
  });

  it('still prints lines in display order', () => {
    const orders = calculatePayslip(base).lines.map((l) => l.order);
    expect(orders).toEqual([...orders].sort((a, b) => a - b));
  });
});
