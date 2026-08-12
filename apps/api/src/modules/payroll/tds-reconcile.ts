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
 * Half a paisa. Payslip TDS is a sum over `Decimal(14, 2)` columns, so a drift
 * below this is floating-point arithmetic and anything above it is somebody
 * depositing a different number from the one payroll produced.
 */
const TOLERANCE = 0.005;

export function reconcile(months: MonthTds[]): Reconciliation {
  const differences: MonthDifference[] = [];
  const missingChallans: string[] = [];

  for (const entry of months) {
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
