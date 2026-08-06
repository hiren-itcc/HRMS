import { defaultSettings } from '@hrms/shared';
import { addDays, toDate } from '../../src/common/utils/calendar';
import type { PrismaClient } from '../../src/generated/prisma/client';
import { calculatePayslip } from '../../src/modules/payroll/payroll.calc';
import type { OrgFixtures } from './org';
import type { People } from './people';
import type { Random } from './random';

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Salary structures, everybody's pay, and five months of runs.
 *
 * Payslips are produced by `calculatePayslip` — the engine payroll actually
 * runs on — rather than by figures typed in here. A seed with hand-written
 * totals drifts away from the code the first time the calculation changes, and
 * a demo payslip that does not add up is worse than no demo payslip.
 */
export async function seedPayroll(
  prisma: PrismaClient,
  orgId: string,
  org: OrgFixtures,
  people: People,
  random: Random,
  todayKey: string,
) {
  const componentId = org.componentId;

  const standard = await prisma.salaryStructure.create({
    data: {
      organizationId: orgId,
      name: 'Standard Staff',
      code: 'STD',
      description: '40% basic, HRA at half of basic, the rest as special allowance',
      lines: {
        create: [
          { componentId: componentId('BASIC'), calcType: 'PERCENT_OF_CTC', value: 40, order: 1 },
          { componentId: componentId('HRA'), calcType: 'PERCENT_OF_BASIC', value: 50, order: 2 },
          { componentId: componentId('CONVEYANCE'), calcType: 'FLAT', value: 1600, order: 3 },
          { componentId: componentId('MEDICAL'), calcType: 'FLAT', value: 1250, order: 4 },
          { componentId: componentId('SPECIAL'), calcType: 'BALANCE', value: 0, order: 5 },
        ],
      },
    },
  });

  const leadership = await prisma.salaryStructure.create({
    data: {
      organizationId: orgId,
      name: 'Leadership',
      code: 'LEAD',
      description: 'Higher basic, and a performance bonus line',
      lines: {
        create: [
          { componentId: componentId('BASIC'), calcType: 'PERCENT_OF_CTC', value: 50, order: 1 },
          { componentId: componentId('HRA'), calcType: 'PERCENT_OF_BASIC', value: 40, order: 2 },
          { componentId: componentId('CONVEYANCE'), calcType: 'FLAT', value: 3200, order: 3 },
          { componentId: componentId('SPECIAL'), calcType: 'BALANCE', value: 0, order: 4 },
        ],
      },
    },
  });

  const contract = await prisma.salaryStructure.create({
    data: {
      organizationId: orgId,
      name: 'Contract',
      code: 'CONTRACT',
      description: 'Consolidated pay with no allowance split',
      lines: {
        create: [
          { componentId: componentId('BASIC'), calcType: 'PERCENT_OF_CTC', value: 100, order: 1 },
        ],
      },
    },
  });

  const structureId = (code: string) =>
    ({ STD: standard.id, LEAD: leadership.id, CONTRACT: contract.id })[code] as string;

  for (const person of people.all) {
    await prisma.employeeSalary.create({
      data: {
        employeeId: person.employeeId,
        structureId: structureId(person.structure),
        effectiveFrom: toDate(person.joinDate),
        // The figure they joined on, before the raise below.
        monthlyCtc: Math.round(person.monthlyCtc * 0.88),
        monthlyTds: Math.round(person.monthlyTds * 0.88),
        revisionType: 'JOINING',
        reason: 'Salary on joining',
        approvedById: people.usr('hr@hrms.local'),
      },
    });
  }

  // Raises for about a third of the roster, so the revision timeline is not a
  // single row on every profile.
  const year = Number(todayKey.slice(0, 4));
  for (const person of people.all) {
    if (person.joinDate >= `${year}-04-01`) continue;
    if (!random.chance(0.4)) continue;
    await prisma.employeeSalary.create({
      data: {
        employeeId: person.employeeId,
        structureId: structureId(person.structure),
        effectiveFrom: toDate(`${year}-04-01`),
        monthlyCtc: person.monthlyCtc,
        monthlyTds: person.monthlyTds,
        revisionType: random.chance(0.3) ? 'PROMOTION' : 'INCREMENT',
        reason: random.chance(0.3) ? `Promoted to ${person.designation}` : 'Annual increment',
        approvedById: people.usr('hr@hrms.local'),
      },
    });
  }

  // ── Adjustments: one-off money that is not in anybody's structure ──────
  const adjustmentMonth = monthKey(todayKey, 1);
  for (const person of people.staff.slice(0, 4)) {
    await prisma.payrollAdjustment.create({
      data: {
        organizationId: orgId,
        employeeId: person.employeeId,
        month: adjustmentMonth,
        componentId: componentId('BONUS'),
        amount: random.step(5000, 25_000, 500),
        note: random.pick(['Quarterly incentive', 'Referral bonus', 'Project completion award']),
        createdById: people.usr('hr@hrms.local'),
      },
    });
  }

  // ── Runs ───────────────────────────────────────────────────────────────
  const payrollConfig = defaultSettings().payroll;
  const hr = people.usr('hr@hrms.local');
  const finance = people.usr('finance@hrms.local');

  /**
   * Four months behind to one month behind. The three oldest are published and
   * paid; the most recent sits IN_REVIEW so there is a run to approve and pay
   * without having to calculate one first.
   */
  for (const back of [4, 3, 2, 1]) {
    const month = monthKey(todayKey, back);
    const inReview = back === 1;
    const ageDays = back * 30;

    const run = await prisma.payrollRun.create({
      data: {
        organizationId: orgId,
        month,
        status: inReview ? 'IN_REVIEW' : 'PUBLISHED',
        payDate: inReview ? null : toDate(`${monthKey(todayKey, back - 1)}-01`),
        calculatedAt: toDate(addDays(todayKey, -ageDays - 6)),
        calculatedById: hr,
        ...(inReview
          ? {}
          : {
              approvedAt: toDate(addDays(todayKey, -ageDays - 5)),
              approvedById: finance,
              lockedAt: toDate(addDays(todayKey, -ageDays - 5)),
              lockedById: finance,
              publishedAt: toDate(addDays(todayKey, -ageDays - 4)),
              publishedById: hr,
            }),
      },
    });

    const totals = { earnings: 0, deductions: 0, employer: 0, net: 0 };
    let count = 0;

    for (const [index, person] of people.all.entries()) {
      // Only people actually employed that month belong on that month's run.
      if (person.joinDate > `${month}-28`) continue;
      if (person.exitDate && person.exitDate < `${month}-01`) continue;
      if (person.status === 'ONBOARDING') continue;

      const employee = await prisma.employee.findUniqueOrThrow({
        where: { id: person.employeeId },
        include: {
          department: true,
          designation: true,
          bankDetail: true,
          salaries: {
            where: { effectiveFrom: { lte: toDate(`${month}-28`) } },
            orderBy: { effectiveFrom: 'desc' },
            take: 1,
            include: { structure: { include: { lines: { include: { component: true } } } } },
          },
        },
      });
      const salary = employee.salaries[0];
      if (!salary) continue;

      // A little unpaid leave, spread around, so no two months look alike and
      // the salary register is not twenty-eight identical rows.
      const lopDays = (index + back) % 7 === 0 ? random.int(1, 3) : 0;

      const calc = calculatePayslip({
        month,
        monthlyCtc: Number(salary.monthlyCtc),
        monthlyTds: Number(salary.monthlyTds),
        lines: salary.structure.lines.map((line) => ({
          code: line.component.code,
          name: line.component.name,
          kind: line.component.kind,
          calcType: line.calcType,
          value: Number(line.value),
          order: line.order,
        })),
        lopDays,
        config: payrollConfig,
      });

      /*
       * Published months are settled. The IN_REVIEW one is unpaid throughout,
       * which is what "waiting on Finance" looks like; among the settled ones
       * a couple failed and a couple are still pending, so the payment badges,
       * the failure reason and the bulk action bar all have something real.
       */
      const payment = inReview
        ? { status: 'PENDING' as const, failureReason: null }
        : index % 11 === 3
          ? { status: 'FAILED' as const, failureReason: 'Bank rejected: account name mismatch' }
          : index % 13 === 5
            ? { status: 'PENDING' as const, failureReason: null }
            : { status: 'PAID' as const, failureReason: null };

      await prisma.payslip.create({
        data: {
          organizationId: orgId,
          runId: run.id,
          employeeId: employee.id,
          employeeCode: employee.employeeCode,
          employeeName: `${employee.firstName} ${employee.lastName}`,
          departmentName: employee.department?.name ?? null,
          designationName: employee.designation?.title ?? null,
          structureName: salary.structure.name,
          bankName: employee.bankDetail?.bankName ?? null,
          accountNumberMasked: employee.bankDetail
            ? `••••${employee.bankDetail.accountNumber.slice(-4)}`
            : null,
          ifsc: employee.bankDetail?.ifscCode ?? null,
          workingDays: calc.workingDays,
          lopDays: calc.lopDays,
          payableDays: calc.payableDays,
          grossEarnings: calc.grossEarnings,
          totalDeductions: calc.totalDeductions,
          employerContribution: calc.employerContribution,
          netPay: calc.netPay,
          carriedShortfall: calc.carriedShortfall,
          paymentStatus: payment.status,
          failureReason: payment.failureReason,
          paidAt: payment.status === 'PAID' ? toDate(addDays(todayKey, -ageDays - 3)) : null,
          paymentRef:
            payment.status === 'PAID'
              ? `NEFT-${month.replace('-', '')}-${employee.employeeCode}`
              : null,
          lines: {
            create: calc.lines.map((line) => ({
              componentCode: line.code,
              componentName: line.name,
              kind: line.kind,
              amount: line.amount,
              order: line.order,
            })),
          },
        },
      });

      totals.earnings += calc.grossEarnings;
      totals.deductions += calc.totalDeductions;
      totals.employer += calc.employerContribution;
      totals.net += calc.netPay;
      count++;
    }

    await prisma.payrollRun.update({
      where: { id: run.id },
      data: {
        employeeCount: count,
        totalEarnings: round2(totals.earnings),
        totalDeductions: round2(totals.deductions),
        totalEmployerCost: round2(totals.employer),
        netPayable: round2(totals.net),
      },
    });
  }

  // The current month sits open, so the workflow has somewhere to start.
  await prisma.payrollRun.create({
    data: {
      organizationId: orgId,
      month: todayKey.slice(0, 7),
      status: 'DRAFT',
      payDate: null,
      notes: 'Awaiting month end',
    },
  });

  return { standardStructureId: standard.id };
}

/** "YYYY-MM", counting whole months back from today. */
export function monthKey(todayKey: string, back: number): string {
  const [y, m] = todayKey.split('-').map(Number) as [number, number];
  const date = new Date(Date.UTC(y, m - 1 - back, 1));
  return date.toISOString().slice(0, 7);
}
