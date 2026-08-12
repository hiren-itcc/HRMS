import { COMPONENT_CODES } from '@hrms/shared';
import { addMonths } from '../../src/common/utils/calendar';
import type { PrismaClient } from '../../src/generated/prisma/client';
import { toMoney } from '../../src/modules/payroll/payroll.mapper';

/**
 * TDS challans — one per published payroll month, for the exact amount that
 * month's payslips actually deducted.
 *
 * `TdsReturnsService.gather` sums each month's payslip lines whose
 * `componentCode` is `COMPONENT_CODES.TDS` and compares that to the challan
 * recorded for the same month; a disagreement blocks the whole quarter from
 * being filed (`tds-returns.service.ts`, the `reconcile` call in `evaluate`).
 * So the figure below is computed the same way — summed from the same lines,
 * rounded with the same `toMoney` — rather than invented, which is the only
 * way the two can agree by construction instead of by luck.
 */
export async function seedTds(prisma: PrismaClient, orgId: string) {
  const runs = await prisma.payrollRun.findMany({
    where: { organizationId: orgId, status: 'PUBLISHED' },
    select: {
      month: true,
      payslips: {
        select: {
          lines: {
            where: { componentCode: COMPONENT_CODES.TDS },
            select: { amount: true },
          },
        },
      },
    },
    orderBy: { month: 'asc' },
  });

  // Most recent published month first, so it can be held back below.
  const byMonth = runs
    .map((run) => ({
      month: run.month,
      tds: toMoney(
        run.payslips.reduce(
          (sum, slip) => sum + slip.lines.reduce((s, line) => s + Number(line.amount), 0),
          0,
        ),
      ),
    }))
    .sort((a, b) => (a.month < b.month ? -1 : 1));

  const mostRecent = byMonth.at(-1)?.month;

  let bsrSerial = 1000;
  let created = 0;
  for (const { month, tds } of byMonth) {
    // Nothing was deducted that month — reconciliation does not demand a nil
    // challan for a month with nothing to deposit, so seeding one here would
    // contradict that rule rather than demonstrate it.
    if (tds <= 0) continue;

    // The most recent published month is deliberately left unrecorded. This
    // repo's seed philosophy shows real states rather than only happy ones —
    // payroll already seeds FAILED payments and an IN_REVIEW run for the same
    // reason — and an unrecorded deposit is the most common thing an operator
    // actually hits. Leaving it out lets the reconciliation on the 24Q screen
    // refuse with a specific month named, instead of the demo only ever
    // showing the case where every challan is already in.
    if (month === mostRecent) continue;

    const depositMonth = addMonths(`${month}-01`, 1).slice(0, 7);
    bsrSerial += 1;
    await prisma.tdsChallan.create({
      data: {
        organizationId: orgId,
        period: month,
        // Seven digits, varied per month so the register is not one row
        // repeated. Deposit due on the 7th of the following month — the
        // statutory due date for tax deducted in a given month.
        bsrCode: `034521${bsrSerial % 10}`,
        challanSerial: String(10_000 + bsrSerial).slice(0, 5),
        depositDate: new Date(`${depositMonth}-07T00:00:00.000Z`),
        sectionCode: '92B',
        minorHead: '200',
        tds,
        surcharge: 0,
        educationCess: 0,
        interest: 0,
        fee: 0,
        penalty: 0,
        others: 0,
      },
    });
    created++;
  }

  return { challans: created };
}
