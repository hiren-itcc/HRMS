/**
 * The File Format document the record layout was transcribed from.
 *
 * `UNTRANSCRIBED` while nobody has done it. Task 13 replaces this with the
 * document's own version string, which is what flips `LAYOUT_TRANSCRIBED`
 * and unblocks generation.
 */
export const FVU_SPEC_VERSION = 'UNTRANSCRIBED';

/**
 * Whether the field order below came from the specification or is still the
 * provisional guess.
 *
 * `TdsReturnsService.readiness` refuses to generate while this is false, so
 * the screen says the layout is not transcribed rather than handing somebody
 * a file whose fields are in an order we invented. The register and the
 * reconciliation work regardless — they need no layout at all.
 */
export const LAYOUT_TRANSCRIBED: boolean = FVU_SPEC_VERSION !== 'UNTRANSCRIBED';

import { round2 } from './payroll.statutory';
import type { TdsQuarterCode } from './tds-period';

/**
 * Form 24Q, as a pure function.
 *
 * No Prisma, no clock, no settings lookup — the rule `statutory-files.ts`
 * follows, and it matters more here because this output is validated by a tool
 * CI cannot run. Per ADR-001 what we emit is the *input* to the NSDL File
 * Validation Utility, not a filed return: the FVU is the operator's gate and
 * the screen says so.
 *
 * Built from frozen payslips of published runs, so a return regenerated in
 * December is the same file it was in October.
 */

/** The delimiter the e-TDS file format uses between fields. */
const DELIMITER = '^';

/** What the format wants where a deductee's PAN is unavailable. */
const PAN_NOT_AVAILABLE = 'PANNOTAVBL';

export interface Deductee {
  employeeCode: string;
  employeeName: string;
  /** Null is reported with the marker above, never dropped. */
  pan: string | null;
  tdsDeducted: number;
  grossSalary: number;
}

export interface ChallanEntry {
  /** `YYYY-MM`, the payroll month this challan deposits. */
  month: string;
  bsrCode: string;
  challanSerial: string;
  /** ISO `YYYY-MM-DD`. */
  depositDate: string;
  tds: number;
  surcharge: number;
  educationCess: number;
  interest: number;
  fee: number;
  penalty: number;
  others: number;
}

export interface Q24Input {
  tan: string;
  deductorName: string;
  deductorPan: string;
  responsiblePerson: string;
  financialYear: string;
  quarter: TdsQuarterCode;
  challans: ChallanEntry[];
  /** Keyed by `YYYY-MM`, so every deductee row knows its challan. */
  deductees: Record<string, Deductee[]>;
}

export interface Q24Result {
  content: string;
  rowCount: number;
  noPan: Deductee[];
  totals: Record<string, number>;
}

function line(values: (string | number)[]): string {
  return values.join(DELIMITER);
}

export function build24Q(input: Q24Input): Q24Result {
  /*
   * Sorted here rather than trusted from the caller: deductee rows reference
   * their challan by index, so an out-of-order list would mis-key every row
   * beneath it — a file that validates and reports the wrong people.
   */
  const challans = [...input.challans].sort((a, b) => a.month.localeCompare(b.month));
  const noPan: Deductee[] = [];
  const records: string[] = [];
  let rowCount = 0;
  let deducteeTds = 0;

  records.push(line(['FH', FVU_SPEC_VERSION, input.tan, input.financialYear, input.quarter]));
  records.push(
    line(['BH', input.tan, input.deductorPan, input.deductorName, input.responsiblePerson]),
  );

  for (const [index, challan] of challans.entries()) {
    records.push(
      line([
        'CD',
        index + 1,
        challan.month,
        challan.bsrCode,
        challan.challanSerial,
        challan.depositDate,
        round2(challan.tds),
        round2(challan.surcharge),
        round2(challan.educationCess),
        round2(challan.interest),
        round2(challan.fee),
        round2(challan.penalty),
        round2(challan.others),
      ]),
    );

    for (const [row, person] of (input.deductees[challan.month] ?? []).entries()) {
      /*
       * Reported, not dropped. A deductee without a PAN is filed with the
       * prescribed marker and attracts deduction at 20%; omitting the row
       * would file a short return, which is the failure the ECR screen's
       * exclusion panel exists to prevent.
       */
      if (!person.pan) noPan.push(person);

      records.push(
        line([
          'DD',
          index + 1,
          row + 1,
          person.pan ?? PAN_NOT_AVAILABLE,
          person.employeeName,
          round2(person.grossSalary),
          round2(person.tdsDeducted),
        ]),
      );
      rowCount += 1;
      deducteeTds += person.tdsDeducted;
    }
  }

  return {
    content: `${records.join('\n')}\n`,
    rowCount,
    noPan,
    totals: {
      challanTds: round2(challans.reduce((sum, c) => sum + c.tds, 0)),
      deducteeTds: round2(deducteeTds),
      challanCount: challans.length,
    },
  };
}
