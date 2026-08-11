import {
  buildEcr,
  buildEsicReturn,
  type EcrConfig,
  ecrLine,
  FilingMismatch,
  type FilingRow,
} from './statutory-files';

const config: EcrConfig = {
  epsWageCeiling: 15_000,
  epsRate: 8.33,
  pfWageCeiling: 15_000,
  applyPfCeiling: true,
};

/**
 * A fixture spanning every edge a real month has: basic below and above the PF
 * ceiling, gross just under and just over the ESI threshold, a mid-month
 * joiner, a leaver, no-pay leave, and one person with no identifiers at all.
 */
const row = (over: Partial<FilingRow> = {}): FilingRow => ({
  employeeCode: 'EMP001',
  employeeName: 'Asha Verma',
  uan: '100200300400',
  esicIpNumber: '3100200300',
  grossWages: 18_000,
  basic: 9_000,
  employeePf: 1_080,
  employerPf: 1_080,
  employeeEsi: 135,
  employerEsi: 585,
  paidDays: 30,
  lopDays: 0,
  lastWorkingDate: null,
  ...over,
});

describe('the ESIC contribution return', () => {
  it('carries the gross, because ESI is levied on it', () => {
    const { rows } = buildEsicReturn([row()]);
    expect(rows[0]).toMatchObject({ ipNumber: '3100200300', wages: 18_000, daysPaid: 30 });
  });

  /*
   * Somebody earning above the threshold is not a zero on this return — they
   * are simply not in the scheme, and the existing ESI report already words it
   * that way. Emitting them would inflate the challan.
   */
  it('leaves out anybody who contributed nothing, without calling it an exclusion', () => {
    const above = row({ employeeEsi: 0, employerEsi: 0 });
    const { rows, excluded } = buildEsicReturn([above]);
    expect(rows).toHaveLength(0);
    expect(excluded).toHaveLength(0);
  });

  /*
   * The rule this whole workstream turns on. A member with no IP number is
   * *excluded and named*, never emitted with the field blank —
   * `bankTransfer()` put it best: a file with a hole in it is worse than a
   * short one, because the hole is found by the recipient rather than by us.
   */
  it('excludes a member with no IP number and says who and why', () => {
    const { rows, excluded } = buildEsicReturn([row({ esicIpNumber: null })]);
    expect(rows).toHaveLength(0);
    expect(excluded[0]).toMatchObject({
      employeeCode: 'EMP001',
      reason: 'No ESIC IP number on record',
    });
  });

  it('marks a leaver with reason code 2 and everybody else with 0', () => {
    const leaver = row({ paidDays: 0, lastWorkingDate: '2026-06-12' });
    const { rows } = buildEsicReturn([row(), leaver]);
    expect(rows[0]?.reasonCode).toBe(0);
    expect(rows[1]).toMatchObject({ reasonCode: 2, lastWorkingDay: '2026-06-12' });
  });

  it('totals the wages it actually filed', () => {
    const { totals } = buildEsicReturn([row(), row({ employeeCode: 'EMP002' })]);
    expect(totals.wages).toBe(36_000);
    expect(totals.employeeEsi).toBe(270);
  });
});

describe('the ECR line', () => {
  /*
   * A golden line, byte for byte. Any change to the serialiser has to justify
   * its diff here — which is the closest thing to the EPFO validator that can
   * run in CI.
   */
  it('is #~# delimited, in whole rupees, in the order EPFO reads', () => {
    const line = ecrLine({
      uan: '100200300400',
      name: 'Asha Verma',
      grossWages: 18_000,
      epfWages: 9_000,
      epsWages: 9_000,
      edliWages: 9_000,
      employeeShare: 1_080,
      epsShare: 750,
      epfDifference: 330,
      ncpDays: 0,
      refundOfAdvances: 0,
    });
    expect(line).toBe(
      '100200300400#~#Asha Verma#~#18000#~#9000#~#9000#~#9000#~#1080#~#750#~#330#~#0#~#0',
    );
  });

  /* EPFO rejects decimals in these columns outright. */
  it('carries no paise', () => {
    const line = ecrLine({
      uan: '1',
      name: 'A',
      grossWages: 18_000.4,
      epfWages: 9_000.6,
      epsWages: 9_000,
      edliWages: 9_000,
      employeeShare: 1_080.5,
      epsShare: 749.7,
      epfDifference: 330.3,
      ncpDays: 1.4,
      refundOfAdvances: 0,
    });
    expect(line).not.toMatch(/\./);
  });
});

describe('the ECR return', () => {
  it('excludes a member with no UAN and names them', () => {
    const { rowCount, excluded } = buildEcr([row({ uan: null })], config);
    expect(rowCount).toBe(0);
    expect(excluded[0]?.reason).toBe('No UAN on record');
  });

  it('leaves out anybody not in the scheme at all', () => {
    const { rowCount, excluded } = buildEcr([row({ employeePf: 0, employerPf: 0 })], config);
    expect(rowCount).toBe(0);
    expect(excluded).toHaveLength(0);
  });

  /*
   * The pension ceiling is the government's, not the employer's. Somebody on
   * 40,000 basic still pensions on 15,000 — and the whole remainder of the
   * employer's contribution falls to the provident-fund column.
   */
  it('caps the pension wage while the PF wage follows the employer’s own choice', () => {
    const big = row({ basic: 40_000, employeePf: 1_800, employerPf: 1_800 });
    const { content } = buildEcr([big], config);
    const [, , , epfWages, epsWages] = (content.split('#~#') ?? []) as string[];
    expect(epfWages).toBe('15000');
    expect(epsWages).toBe('15000');
  });

  it('pensions on the ceiling but files full basic as EPF wages when the cap is off', () => {
    const uncapped = { ...config, applyPfCeiling: false };
    const big = row({ basic: 40_000, employeePf: 4_800, employerPf: 4_800 });
    const parts = buildEcr([big], uncapped).content.split('#~#');
    expect(parts[3]).toBe('40000'); // EPF wages — the employer's generosity
    expect(parts[4]).toBe('15000'); // EPS wages — the government's ceiling
  });

  /*
   * The guard that makes the file trustworthy at all: what is filed has to
   * equal what was deducted, because EPFO recomputes from these columns and
   * would find the difference rather than us.
   */
  it('reconciles the three contribution columns against the payslips', () => {
    const { totals } = buildEcr([row(), row({ employeeCode: 'EMP002' })], config);
    const filed = totals.employeeShare + totals.epsShare + totals.epfDifference;
    expect(Math.round(filed)).toBe(1_080 * 2 + 1_080 * 2);
  });

  /*
   * The reconciliation cannot currently fail, and that is worth stating plainly
   * rather than dressing a guard up as a passing test.
   *
   * `epfDifference` is `employerPf − epsShare`, so the three filed columns sum
   * to `employeePf + employerPf` by construction, whatever the rates or
   * ceilings are. The property is asserted across a spread of inputs below.
   *
   * The guard in `buildEcr` stays anyway, because the one change most likely to
   * be made here — deriving the remainder from a 3.67% rate instead of
   * subtracting — breaks exactly this and would otherwise ship a file that is
   * a rupee out per member. The guard is what turns that into a refusal rather
   * than a rejected upload weeks later.
   */
  it.each([
    [9_000, 1_080, 1_080],
    [15_000, 1_800, 1_800],
    [40_000, 1_800, 1_800],
    [6_000, 720, 720],
  ])('files exactly what was deducted, at basic %s', (basic, ee, er) => {
    const { totals } = buildEcr([row({ basic, employeePf: ee, employerPf: er })], config);
    const filed = totals.employeeShare + totals.epsShare + totals.epfDifference;
    expect(Math.round(filed)).toBe(ee + er);
  });

  /*
   * The defect a real file found and this fixture had missed.
   *
   * At the ceiling the exact shares are 1249.50 and 550.50. Rounding each
   * column independently takes both halves upward — 1250 and 551 — so the file
   * claims a rupee more than was ever contributed, and EPFO recomputes the
   * total from exactly these columns.
   *
   * The original fixture used 9,000 basic, where the shares are 749.70 and
   * 330.30 and round in opposite directions and cancel. It passed for the wrong
   * reason, which is the most expensive kind of passing test.
   */
  it('files columns that add up, at the ceiling where the halves both round up', () => {
    const atCeiling = row({ basic: 15_000, employeePf: 1_800, employerPf: 1_800 });
    const parts = buildEcr([atCeiling], config).content.split('#~#');
    const employee = Number(parts[6]);
    const eps = Number(parts[7]);
    const epfDiff = Number(parts[8]);

    expect(eps).toBe(1250);
    expect(epfDiff).toBe(550);
    expect(employee + eps + epfDiff).toBe(3_600);
  });

  /* And the property, across the basics where rounding is worst. */
  it.each([15_000, 15_001, 24_999, 40_000, 154_000])(
    'never files more or less than was contributed, at basic %s',
    (basic) => {
      const one = row({ basic, employeePf: 1_800, employerPf: 1_800 });
      const parts = buildEcr([one], config).content.split('#~#');
      expect(Number(parts[6]) + Number(parts[7]) + Number(parts[8])).toBe(3_600);
    },
  );

  it('files no-pay days as NCP days', () => {
    const parts = buildEcr([row({ lopDays: 3 })], config).content.split('#~#');
    expect(parts[9]).toBe('3');
  });

  it('is one line per member, newline separated', () => {
    const { content, rowCount } = buildEcr(
      [row(), row({ employeeCode: 'EMP002', uan: '999' })],
      config,
    );
    expect(rowCount).toBe(2);
    expect(content.split('\n')).toHaveLength(2);
  });

  it('exports the mismatch error so a caller can tell it from a crash', () => {
    expect(new FilingMismatch('x')).toBeInstanceOf(Error);
  });
});
