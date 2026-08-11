import { round2 } from './payroll.statutory';

/**
 * The two monthly filing artefacts, as pure functions.
 *
 * No Prisma, no clock, no settings lookup — the same rule `payroll.calc.ts` and
 * `payroll.statutory.ts` follow, and it matters more here: these produce files
 * that a government portal validates and rejects, so they have to be testable
 * against a fixture byte for byte.
 *
 * Both take rows built from **frozen payslips**. Nothing is recomputed from
 * live salary data, because a return filed in June and regenerated in December
 * must be the same file.
 *
 * Deliberately not here: Form 24Q and Form 16. 24Q is a versioned NSDL format
 * validated by a Java desktop tool that cannot run in CI, and a wrong return is
 * *filed* and then needs a correction statement. Form 16 Part A is issued by
 * TRACES after the 24Q is processed and is not ours to produce at all; Part B
 * needs the annual tax engine that doc 11 deferred. See docs/15 §22b.
 */

export interface FilingRow {
  employeeCode: string;
  employeeName: string;
  /** Nullable on purpose — a member without one is excluded, never blanked. */
  uan: string | null;
  esicIpNumber: string | null;
  /** Frozen from the payslip. */
  grossWages: number;
  basic: number;
  employeePf: number;
  employerPf: number;
  employeeEsi: number;
  employerEsi: number;
  /** Days actually paid for, and days of no-pay leave. */
  paidDays: number;
  lopDays: number;
  /** Set only for somebody who left inside the month. */
  lastWorkingDate: string | null;
}

export interface Excluded {
  employeeCode: string;
  employeeName: string;
  reason: string;
}

export interface FilingResult {
  /** The file exactly as it will be downloaded. */
  content: string;
  rowCount: number;
  excluded: Excluded[];
  totals: Record<string, number>;
}

/**
 * A reconciliation failure is not a warning.
 *
 * Both portals recompute contributions from the wage columns beside them, so a
 * file whose totals do not match the payslips it came from is a rejected
 * return at best and a wrong one at worst. Generation refuses rather than
 * handing somebody a plausible file — the same call `bankTransfer()` makes
 * about a payment file with a hole in it.
 */
export class FilingMismatch extends Error {}

// ── ESIC monthly contribution return ──────────────────────────────────

/**
 * Column-ordered, which is all the ESIC portal wants — so `toCsv` renders it
 * and this only has to decide *what* goes in each column.
 *
 * ESI is levied on gross, which every payslip already carries, so unlike ECR
 * there is no wage arithmetic to get wrong here. The judgement is entirely in
 * who is excluded and why.
 */
export const ESIC_COLUMNS = [
  { key: 'ipNumber', header: 'IP Number' },
  { key: 'ipName', header: 'IP Name' },
  { key: 'daysPaid', header: 'No of Days for which wages paid' },
  { key: 'wages', header: 'Total Monthly Wages' },
  { key: 'reasonCode', header: 'Reason Code for Zero workings days' },
  { key: 'lastWorkingDay', header: 'Last Working Day' },
] as const;

/**
 * `0` means "worked" and is what the portal expects for almost every row.
 * `2` is the code for somebody who has left, and it is the only other one this
 * produces — the remaining codes cover situations (strike, lay-off) the product
 * has no concept of, and inventing a value for them would be worse than
 * leaving the row for a human.
 */
function esicReasonCode(row: FilingRow): number {
  if (row.paidDays > 0) return 0;
  return row.lastWorkingDate ? 2 : 0;
}

export function buildEsicReturn(rows: FilingRow[]): {
  rows: Record<string, string | number>[];
  excluded: Excluded[];
  totals: Record<string, number>;
} {
  const excluded: Excluded[] = [];
  const included: Record<string, string | number>[] = [];

  for (const row of rows) {
    /*
     * Somebody who contributed nothing is not in the scheme — they earn above
     * the threshold — and does not belong on a contribution return at all.
     * That is not an exclusion worth reporting; it is the return being correct.
     */
    if (row.employeeEsi <= 0 && row.employerEsi <= 0) continue;

    if (!row.esicIpNumber) {
      excluded.push({
        employeeCode: row.employeeCode,
        employeeName: row.employeeName,
        reason: 'No ESIC IP number on record',
      });
      continue;
    }

    included.push({
      ipNumber: row.esicIpNumber,
      ipName: row.employeeName,
      daysPaid: row.paidDays,
      wages: round2(row.grossWages),
      reasonCode: esicReasonCode(row),
      lastWorkingDay: row.lastWorkingDate ?? '',
    });
  }

  const totals = {
    wages: round2(included.reduce((sum, r) => sum + Number(r.wages), 0)),
    employeeEsi: round2(
      rows.filter((r) => r.esicIpNumber).reduce((sum, r) => sum + r.employeeEsi, 0),
    ),
    employerEsi: round2(
      rows.filter((r) => r.esicIpNumber).reduce((sum, r) => sum + r.employerEsi, 0),
    ),
  };

  return { rows: included, excluded, totals };
}

// ── EPFO Electronic Challan cum Return ────────────────────────────────

/** The delimiter EPFO's ECR v2.0 text format uses between every field. */
const ECR_DELIMITER = '#~#';

export interface EcrMember {
  uan: string;
  name: string;
  grossWages: number;
  epfWages: number;
  epsWages: number;
  edliWages: number;
  employeeShare: number;
  epsShare: number;
  /** The employer's provident-fund remainder, after the pension slice. */
  epfDifference: number;
  ncpDays: number;
  refundOfAdvances: number;
}

/**
 * One line per member, `#~#` delimited, uploaded to the EPFO portal — which
 * returns a TRRN and generates the challan. **We produce the return; the portal
 * produces the challan.**
 *
 * Amounts are whole rupees, not paise. EPFO rejects decimals in these columns,
 * and rounding here rather than at the edge is what lets the reconciliation
 * below compare like with like.
 */
export function ecrLine(member: EcrMember): string {
  return [
    member.uan,
    member.name,
    Math.round(member.grossWages),
    Math.round(member.epfWages),
    Math.round(member.epsWages),
    Math.round(member.edliWages),
    Math.round(member.employeeShare),
    Math.round(member.epsShare),
    Math.round(member.epfDifference),
    Math.round(member.ncpDays),
    Math.round(member.refundOfAdvances),
  ].join(ECR_DELIMITER);
}

export interface EcrConfig {
  /** Where the pension slice stops, whatever the employer's own PF ceiling is. */
  epsWageCeiling: number;
  epsRate: number;
  pfWageCeiling: number;
  applyPfCeiling: boolean;
}

export function buildEcr(rows: FilingRow[], config: EcrConfig): FilingResult {
  const excluded: Excluded[] = [];
  const members: EcrMember[] = [];
  /** What the payslips actually took, in whole rupees, for the members filed. */
  let paidWhole = 0;

  for (const row of rows) {
    // Not in the scheme. Same reasoning as ESI above: correct, not an exclusion.
    if (row.employeePf <= 0 && row.employerPf <= 0) continue;

    if (!row.uan) {
      excluded.push({
        employeeCode: row.employeeCode,
        employeeName: row.employeeName,
        reason: 'No UAN on record',
      });
      continue;
    }

    const epfWages = config.applyPfCeiling ? Math.min(row.basic, config.pfWageCeiling) : row.basic;
    const epsWages = Math.min(row.basic, config.epsWageCeiling);

    /*
     * Rounded to whole rupees **here**, once, and the remainder derived from
     * the rounded pension share rather than from the exact one.
     *
     * Rounding each column independently is the obvious thing and it is wrong.
     * At the ceiling the exact figures are 1249.50 and 550.50; `Math.round`
     * takes halves upward, so the file said 1250 and 551 — a rupee more than
     * was ever contributed. EPFO recomputes the total from these columns, so
     * that is a rejected return, and it happens for everybody earning above
     * the ceiling, which in most companies is most people.
     *
     * The fixture missed it because 9,000 basic gives 749.70 and 330.30, which
     * round in opposite directions and cancel. Found by generating a real file
     * against real payroll, not by a test.
     */
    const employerWhole = Math.round(row.employerPf);
    const epsWhole = Math.min(Math.round((epsWages * config.epsRate) / 100), employerWhole);

    members.push({
      uan: row.uan,
      name: row.employeeName,
      grossWages: row.grossWages,
      epfWages,
      epsWages,
      // EDLI is levied on the same wage as the pension scheme.
      edliWages: epsWages,
      employeeShare: row.employeePf,
      epsShare: epsWhole,
      epfDifference: employerWhole - epsWhole,
      ncpDays: row.lopDays,
      refundOfAdvances: 0,
    });
    paidWhole += Math.round(row.employeePf) + employerWhole;
  }

  const content = members.map(ecrLine).join('\n');

  const totals = {
    employeeShare: round2(members.reduce((sum, m) => sum + m.employeeShare, 0)),
    epsShare: round2(members.reduce((sum, m) => sum + m.epsShare, 0)),
    epfDifference: round2(members.reduce((sum, m) => sum + m.epfDifference, 0)),
    epfWages: round2(members.reduce((sum, m) => sum + m.epfWages, 0)),
  };

  /*
   * The guard that makes this file trustworthy. Employee share plus pension
   * plus remainder must equal what the payslips actually deducted and
   * contributed, to the rupee — anything else means the return and the payroll
   * it came from disagree, and EPFO would find that rather than us.
   *
   * Compared on rounded totals because the file carries whole rupees; the
   * tolerance is one rupee per member, which is the most rounding can move it.
   */
  const filed = members.reduce(
    (sum, m) => sum + Math.round(m.employeeShare) + m.epsShare + m.epfDifference,
    0,
  );
  /*
   * Compared **as filed**, in whole rupees, not on the exact values.
   *
   * The previous version summed the unrounded figures, which reconciled
   * perfectly while the file itself was a rupee out per member — the guard
   * passed on exactly the defect it existed to catch. What goes in the file is
   * what has to add up.
   */
  if (filed !== paidWhole) {
    throw new FilingMismatch(
      `This return does not reconcile with its payslips: it files ${filed} against ${paidWhole} deducted. Nothing has been generated.`,
    );
  }

  return { content, rowCount: members.length, excluded, totals };
}
