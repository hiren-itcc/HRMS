import type { Prisma } from '../../generated/prisma/client';

/**
 * Who counts as a working employee.
 *
 * `ONBOARDING` is a real `EmployeeStatus` but not a real member of staff yet:
 * they have been invited, may not have accepted, and have signed nothing. Every
 * operational query — attendance, leave, payroll, reports, the directory,
 * the manager picker — must leave them out, or a candidate who never joins
 * shows up as absent to a manager, holds a year of leave balance, and appears
 * in the headcount.
 *
 * This lives in one place because the alternative is the same predicate
 * hand-copied into a dozen `where` clauses, where the one that gets forgotten
 * is a slow leak nobody notices. Import it; do not retype it.
 *
 * Deliberately NOT applied to:
 * - the HR employee list — HR has to be able to chase people who never finished
 * - salary assignment — assigning pay before the start date is normal
 * - letters — issuing an offer letter to an onboarding hire is the point
 */
export const EMPLOYED = {
  status: { not: 'ONBOARDING' },
} satisfies Pick<Prisma.EmployeeWhereInput, 'status'>;

/** `EMPLOYED`, plus the soft-delete filter that always travels with it. */
export const EMPLOYED_AND_LIVE = {
  deletedAt: null,
  ...EMPLOYED,
} satisfies Pick<Prisma.EmployeeWhereInput, 'status' | 'deletedAt'>;
