import { round2 } from './payroll.statutory';

/**
 * Do the challans deposited agree with the TDS payroll actually deducted?
 *
 * No Prisma and no clock. This exists because `EmployeeSalary.monthlyTds` is
 * typed in per employee — see `packages/shared/src/schemas/settings.ts:60` for
 * why there is no engine behind it — so the figure deducted and the figure
 * deposited are two independent human acts that nothing has ever compared.
 * Once a quarter, this compares them.
 *
 * A mismatch refuses generation rather than warning on it. A 24Q reports
 * deductee-wise TDS against a named challan; if those two numbers disagree the
 * return is wrong whichever one you believe, and a wrong 24Q is *filed* and
 * then needs a correction statement.
 */

export interface MonthTds {
  month: string;
  /** Summed from the frozen payslips of that month's published run. */
  payslipTds: number;
  /** Null when no challan has been recorded for the month at all. */
  challanTds: number | null;
}

export interface MonthDifference {
  month: string;
  payslipTds: number;
  challanTds: number | null;
  /** Challan minus payslips. Negative means under-deposited. */
  difference: number;
}

export interface Reconciliation {
  balanced: boolean;
  differences: MonthDifference[];
  /** Months that deducted TDS and have no challan recorded. */
  missingChallans: string[];
}

/**
 * Thrown by `reconcile` on a non-finite TDS amount. A named class rather than
 * a bare `Error` so this specific, deliberate failure — an upstream
 * Decimal-to-number conversion already broke — is distinguishable in the
 * stack from any other 500 `TdsReturnsService.evaluate` lets through.
 */
export class NonFiniteAmount extends Error {}

/**
 * Half a paisa. Payslip TDS is a sum over `Decimal(14, 2)` columns, so a drift
 * below this is floating-point arithmetic and anything above it is somebody
 * depositing a different number from the one payroll produced.
 */
const TOLERANCE = 0.005;

export function reconcile(months: MonthTds[]): Reconciliation {
  const differences: MonthDifference[] = [];
  const missingChallans: string[] = [];

  for (const entry of months) {
    /*
     * `NaN > TOLERANCE` and `Math.abs(NaN) > TOLERANCE` are both false, so a
     * non-finite amount would fall through every check below unreported and
     * this function would hand back `balanced: true` — the exact failure
     * this reconciliation exists to prevent. A NaN here is not a money
     * disagreement to describe through `differences` or `missingChallans`;
     * it means an upstream Decimal-to-number conversion already broke, so
     * this is a bug to surface immediately, not a reconciliation outcome to
     * report on. Throwing (rather than returning `balanced: false`) makes
     * that distinction impossible to miss: every caller already treats a
     * non-balanced result as "the numbers disagree, tell the operator",
     * which would misdescribe a corrupt input as a mere deposit mismatch.
     */
    if (
      !Number.isFinite(entry.payslipTds) ||
      (entry.challanTds !== null && !Number.isFinite(entry.challanTds))
    ) {
      throw new NonFiniteAmount(
        `tds-reconcile: non-finite TDS amount for month ${entry.month} (payslipTds=${entry.payslipTds}, challanTds=${entry.challanTds}) — this is an upstream data bug, not a reconciliation result`,
      );
    }

    const payslipTds = round2(entry.payslipTds);

    if (entry.challanTds === null) {
      /*
       * A month that deducted nothing owes nothing, and demanding a nil
       * challan would block a quarter for a company that simply had no
       * liability — a real case for a small employer whose whole payroll sits
       * below the threshold in a given month.
       */
      if (payslipTds > TOLERANCE) missingChallans.push(entry.month);
      continue;
    }

    const challanTds = round2(entry.challanTds);
    const difference = round2(challanTds - payslipTds);
    if (Math.abs(difference) > TOLERANCE) {
      differences.push({ month: entry.month, payslipTds, challanTds, difference });
    }
  }

  return {
    balanced: differences.length === 0 && missingChallans.length === 0,
    differences,
    missingChallans,
  };
}
