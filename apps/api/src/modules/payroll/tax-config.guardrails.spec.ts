import {
  confirmBlockedReason,
  type SlabLike,
  slabProblems,
  surchargeProblems,
  unconfirmBlockedReason,
} from './tax-config.guardrails';

/**
 * The checks between a typo and a wrong payslip.
 *
 * Worth being exhaustive about for a reason the arithmetic specs do not have:
 * `calculateTaxBySlabs` walks whatever table it is handed and accumulates. It
 * cannot tell a deliberate rate table from a mistyped one, so a gap between two
 * bands produces a smaller number and no error anywhere. This module is the
 * only thing standing between that and somebody's pay.
 */

/** The FY 2025-26 New-regime shape: valid, contiguous, open at the top. */
const VALID: SlabLike[] = [
  { fromAmount: 0, toAmount: 4_00_000, rate: 0 },
  { fromAmount: 4_00_000, toAmount: 8_00_000, rate: 5 },
  { fromAmount: 8_00_000, toAmount: 12_00_000, rate: 10 },
  { fromAmount: 12_00_000, toAmount: null, rate: 15 },
];

describe('a valid slab table', () => {
  it('passes', () => {
    expect(slabProblems(VALID)).toEqual([]);
  });

  it('passes however the rows arrive, because the editor sorts on write', () => {
    expect(slabProblems([...VALID].reverse())).toEqual([]);
  });

  it('accepts a single band covering everything', () => {
    expect(slabProblems([{ fromAmount: 0, toAmount: null, rate: 30 }])).toEqual([]);
  });

  /* Two bands at the same rate is unusual but not wrong — a rate can repeat. */
  it('accepts two adjacent bands at the same rate', () => {
    expect(
      slabProblems([
        { fromAmount: 0, toAmount: 5_00_000, rate: 10 },
        { fromAmount: 5_00_000, toAmount: null, rate: 10 },
      ]),
    ).toEqual([]);
  });
});

describe('the gap — the one that silently under-taxes', () => {
  /*
   * Income between 8,00,000 and 9,00,000 falls in no band. The engine
   * accumulates only the bands it is given, so that slice is taxed at nothing
   * and the payslip is simply smaller. Nothing downstream notices.
   */
  it('is refused, and the message names the uncovered range', () => {
    const gapped: SlabLike[] = [
      { fromAmount: 0, toAmount: 4_00_000, rate: 0 },
      { fromAmount: 4_00_000, toAmount: 8_00_000, rate: 5 },
      { fromAmount: 9_00_000, toAmount: null, rate: 10 },
    ];
    const problems = slabProblems(gapped);
    expect(problems.some((p) => p.includes('must not leave a gap'))).toBe(true);
    expect(problems.join(' ')).toMatch(/8,00,000/);
    expect(problems.join(' ')).toMatch(/9,00,000/);
  });

  it('refuses an overlap, which taxes the same rupee twice', () => {
    const overlapping: SlabLike[] = [
      { fromAmount: 0, toAmount: 5_00_000, rate: 5 },
      { fromAmount: 4_00_000, toAmount: null, rate: 10 },
    ];
    expect(slabProblems(overlapping).some((p) => p.includes('overlap'))).toBe(true);
  });
});

describe('the boundaries', () => {
  it('refuses a table that does not start at zero', () => {
    const problems = slabProblems([
      { fromAmount: 2_50_000, toAmount: 5_00_000, rate: 5 },
      { fromAmount: 5_00_000, toAmount: null, rate: 20 },
    ]);
    expect(problems.some((p) => p.includes('must start at 0'))).toBe(true);
  });

  /* Without an open top band the highest incomes fall off the table entirely. */
  it('refuses a table with no open-ended band', () => {
    const problems = slabProblems([
      { fromAmount: 0, toAmount: 4_00_000, rate: 0 },
      { fromAmount: 4_00_000, toAmount: 8_00_000, rate: 5 },
    ]);
    expect(problems.some((p) => p.includes('must be open-ended'))).toBe(true);
  });

  it('refuses two open-ended bands', () => {
    const problems = slabProblems([
      { fromAmount: 0, toAmount: null, rate: 5 },
      { fromAmount: 8_00_000, toAmount: null, rate: 20 },
    ]);
    expect(problems.some((p) => p.includes('only the top one'))).toBe(true);
  });

  it('refuses a band that ends at or below where it starts', () => {
    const problems = slabProblems([
      { fromAmount: 0, toAmount: 4_00_000, rate: 0 },
      { fromAmount: 4_00_000, toAmount: 4_00_000, rate: 5 },
      { fromAmount: 4_00_000, toAmount: null, rate: 10 },
    ]);
    expect(problems.some((p) => p.includes('not above it'))).toBe(true);
  });

  it('refuses an empty table with something actionable', () => {
    expect(slabProblems([])).toEqual(['Add at least one tax band']);
  });
});

describe('rates', () => {
  it.each([[-5], [101], [1000]])('refuses %i%% as a rate', (rate) => {
    expect(
      slabProblems([{ fromAmount: 0, toAmount: null, rate }]).some((p) =>
        p.includes('not a percentage'),
      ),
    ).toBe(true);
  });

  /*
   * A progressive table never charges less on a higher slice. Refused rather
   * than warned: the engine accumulates band by band, so a lower rate above a
   * higher one is always a transposition, never a policy.
   */
  it('refuses a rate that drops as income rises', () => {
    const problems = slabProblems([
      { fromAmount: 0, toAmount: 5_00_000, rate: 20 },
      { fromAmount: 5_00_000, toAmount: null, rate: 10 },
    ]);
    expect(problems.some((p) => p.includes('below the 20%'))).toBe(true);
  });
});

describe('reporting', () => {
  /* One pass, all of them — the same call the expense and timesheet rules make. */
  it('reports every distinct problem at once', () => {
    const problems = slabProblems([
      { fromAmount: 1_00_000, toAmount: 4_00_000, rate: 5 },
      { fromAmount: 5_00_000, toAmount: 8_00_000, rate: 2 },
    ]);
    expect(problems.length).toBeGreaterThanOrEqual(3);
    expect(problems.some((p) => p.includes('must start at 0'))).toBe(true);
    expect(problems.some((p) => p.includes('gap'))).toBe(true);
    expect(problems.some((p) => p.includes('open-ended'))).toBe(true);
  });

  it('says a repeated problem once', () => {
    expect(new Set(slabProblems([])).size).toBe(slabProblems([]).length);
  });
});

describe('surcharge bands', () => {
  it('accepts an ascending set', () => {
    expect(
      surchargeProblems([
        { aboveIncome: 50_00_000, rate: 10 },
        { aboveIncome: 1_00_00_000, rate: 15 },
      ]),
    ).toEqual([]);
  });

  /* Thresholds, not slices — no contiguity to check, so no gap rule. */
  it('accepts a large jump between thresholds', () => {
    expect(
      surchargeProblems([
        { aboveIncome: 50_00_000, rate: 10 },
        { aboveIncome: 5_00_00_000, rate: 37 },
      ]),
    ).toEqual([]);
  });

  it('refuses two bands at the same threshold', () => {
    expect(
      surchargeProblems([
        { aboveIncome: 50_00_000, rate: 10 },
        { aboveIncome: 50_00_000, rate: 15 },
      ]).some((p) => p.includes('both start above')),
    ).toBe(true);
  });

  it('refuses a rate that drops as income rises', () => {
    expect(
      surchargeProblems([
        { aboveIncome: 50_00_000, rate: 15 },
        { aboveIncome: 1_00_00_000, rate: 10 },
      ]).some((p) => p.includes('below the 15%')),
    ).toBe(true);
  });

  it('accepts no surcharge at all', () => {
    expect(surchargeProblems([])).toEqual([]);
  });
});

describe('confirming a year', () => {
  it('allows a sourced, valid table', () => {
    expect(confirmBlockedReason({ slabs: VALID, source: 'Finance Act 2025' })).toBeNull();
  });

  it('refuses with no bands', () => {
    expect(confirmBlockedReason({ slabs: [], source: 'Finance Act 2025' })).toMatch(
      /Add the tax bands/,
    );
  });

  /* An unsourced rate table is one nobody can check. */
  it.each([[null], [undefined], ['']])('refuses with a source of %p', (source) => {
    expect(confirmBlockedReason({ slabs: VALID, source })).toMatch(/where these figures came from/);
  });

  it('refuses a source that is only whitespace', () => {
    expect(confirmBlockedReason({ slabs: VALID, source: '   ' })).toMatch(
      /where these figures came from/,
    );
  });

  it('refuses a sourced table that is still malformed', () => {
    expect(
      confirmBlockedReason({
        slabs: [{ fromAmount: 1_00_000, toAmount: null, rate: 10 }],
        source: 'Finance Act 2025',
      }),
    ).toMatch(/must start at 0/);
  });
});

describe('un-confirming a year', () => {
  it('is allowed before anything has been deducted', () => {
    expect(unconfirmBlockedReason(0)).toBeNull();
  });

  /*
   * tdsForRun SKIPS an employee whose year is unconfirmed rather than deducting
   * zero, so this would quietly stop TDS for the whole workforce from the next
   * run — the shortfall landing on people in March.
   */
  it('is refused once tax has been deducted, and says what to do instead', () => {
    const reason = unconfirmBlockedReason(4_57_890);
    expect(reason).toMatch(/4,57,890/);
    expect(reason).toMatch(/Correct the figures instead/);
  });
});

describe('purity', () => {
  it('has no clock and no database', () => {
    const source = require('node:fs').readFileSync(`${__dirname}/tax-config.guardrails.ts`, 'utf8');
    expect(source).not.toMatch(/new Date\(|Date\.now|PrismaService|prisma\./);
  });
});
