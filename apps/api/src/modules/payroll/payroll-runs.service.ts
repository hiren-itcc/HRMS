import type { PayrollRunActionInput, PayrollRunCreateInput, PayrollRunQuery } from '@hrms/shared';
import type { AccessTokenClaims } from '@hrms/types';
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { auditMutation } from '../../common/utils/audit';
import { daysInMonth, toDate } from '../../common/utils/calendar';
import { buildListArgs, toPaginated } from '../../common/utils/list-query';
import { PrismaService } from '../../database/prisma.service';
import { EMPLOYED_AND_LIVE } from '../employees/employee-scopes';
import { SettingsService } from '../settings/settings.service';
import { calculatePayslip, type StructureLineInput } from './payroll.calc';
import { maskAccount, toDateKey, toDays, toMoney } from './payroll.mapper';
import {
  canTransition,
  nextStatus,
  RUN_ACTION_PERMISSION,
  type RunAction,
  type RunStatus,
  transitionError,
} from './payroll.workflow';
import { PayrollAdjustmentsService } from './payroll-adjustments.service';

const SORTABLE = ['month', 'createdAt', 'netPayable'] as const;

interface RunRow {
  id: string;
  month: string;
  status: string;
  payDate: Date | null;
  notes: string | null;
  employeeCount: number;
  totalEarnings: unknown;
  totalDeductions: unknown;
  totalEmployerCost: unknown;
  netPayable: unknown;
  calculatedAt: Date | null;
  approvedAt: Date | null;
  lockedAt: Date | null;
  publishedAt: Date | null;
  createdAt: Date;
}

function mapRun(row: RunRow) {
  return {
    id: row.id,
    month: row.month,
    status: row.status,
    payDate: toDateKey(row.payDate),
    notes: row.notes,
    employeeCount: row.employeeCount,
    totalEarnings: toMoney(row.totalEarnings),
    totalDeductions: toMoney(row.totalDeductions),
    totalEmployerCost: toMoney(row.totalEmployerCost),
    netPayable: toMoney(row.netPayable),
    calculatedAt: row.calculatedAt?.toISOString() ?? null,
    approvedAt: row.approvedAt?.toISOString() ?? null,
    lockedAt: row.lockedAt?.toISOString() ?? null,
    publishedAt: row.publishedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

@Injectable()
export class PayrollRunsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly adjustments: PayrollAdjustmentsService,
  ) {}

  async list(orgId: string, query: PayrollRunQuery) {
    const where = {
      organizationId: orgId,
      ...(query.status ? { status: query.status } : {}),
      ...(query.year ? { month: { startsWith: String(query.year) } } : {}),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.payrollRun.findMany({ where, ...buildListArgs(query, SORTABLE, 'month') }),
      this.prisma.payrollRun.count({ where }),
    ]);
    return toPaginated(rows.map(mapRun), total, query);
  }

  async get(orgId: string, id: string) {
    const row = await this.prisma.payrollRun.findFirst({ where: { id, organizationId: orgId } });
    if (!row) throw new NotFoundException('Payroll run not found');
    return mapRun(row);
  }

  async create(ctx: { orgId: string; userId: string }, input: PayrollRunCreateInput) {
    const currentMonth = new Date().toISOString().slice(0, 7);
    if (input.month > currentMonth) {
      throw new BadRequestException('Payroll cannot be run for a future month');
    }
    const clash = await this.prisma.payrollRun.findFirst({
      where: { organizationId: ctx.orgId, month: input.month },
      select: { id: true, status: true },
    });
    if (clash) {
      throw new BadRequestException(
        `Payroll for ${input.month} already exists (${clash.status.toLowerCase()})`,
      );
    }

    const row = await this.prisma.payrollRun.create({
      data: {
        organizationId: ctx.orgId,
        month: input.month,
        payDate: input.payDate ? toDate(input.payDate) : null,
        notes: input.notes ?? null,
      },
    });
    await auditMutation(this.prisma, ctx, 'payroll.run.create', 'PayrollRun', row.id, {
      after: { month: row.month, status: row.status },
    });
    return mapRun(row);
  }

  /**
   * Everything that would stop a run producing correct payslips, reported
   * before anyone presses calculate.
   *
   * Not in the specification, but without it the first sign of a missing bank
   * account is a failed transfer after the payroll is locked.
   */
  async preflight(orgId: string, id: string) {
    const run = await this.get(orgId, id);
    const monthEnd = `${run.month}-31`;

    const employees = await this.prisma.employee.findMany({
      where: {
        organizationId: orgId,
        // Same exclusion as calculate(), or preflight reports an onboarding
        // hire as "no salary, no bank" on the screen whose job is to say
        // whether *this payroll* is safe.
        ...EMPLOYED_AND_LIVE,
        joinDate: { lte: toDate(monthEnd) },
        OR: [{ exitDate: null }, { exitDate: { gte: toDate(`${run.month}-01`) } }],
      },
      include: {
        bankDetail: true,
        salaries: {
          where: { effectiveFrom: { lte: toDate(monthEnd) } },
          orderBy: { effectiveFrom: 'desc' },
          take: 1,
          include: { structure: { include: { lines: true } } },
        },
      },
    });

    const noSalary: { id: string; name: string }[] = [];
    const noBank: { id: string; name: string }[] = [];
    const emptyStructure: { id: string; name: string }[] = [];

    for (const employee of employees) {
      const name = `${employee.firstName} ${employee.lastName}`;
      const salary = employee.salaries[0];
      if (!salary) {
        noSalary.push({ id: employee.id, name });
        continue;
      }
      if (salary.paymentMethod === 'BANK_TRANSFER' && !employee.bankDetail) {
        noBank.push({ id: employee.id, name });
      }
      if (salary.structure.lines.length === 0) {
        emptyStructure.push({ id: employee.id, name });
      }
    }

    return {
      month: run.month,
      eligible: employees.length - noSalary.length,
      totalConsidered: employees.length,
      blocking: { noSalary, emptyStructure },
      warnings: { noBank },
      // A run with nobody to pay is almost always a configuration mistake.
      canCalculate: employees.length - noSalary.length > 0 && emptyStructure.length === 0,
    };
  }

  /**
   * Rebuilds every payslip for the run from scratch.
   *
   * Deliberately destructive — payroll is recalculated repeatedly during
   * review, and merging would leave a payslip for someone who has since been
   * excluded. Everything the calculation needs is snapshot onto the payslip so
   * the result stays readable after the inputs move.
   */
  async calculate(claims: AccessTokenClaims, id: string) {
    const ctx = { orgId: claims.orgId, userId: claims.sub };
    const run = await this.requireTransition(claims, id, 'calculate');
    const settings = await this.settings.get(claims.orgId);
    const config = settings.payroll;
    const weekOff = settings.workingWeek.weekOffDays;

    const monthStart = `${run.month}-01`;
    const monthDays = daysInMonth(run.month);
    const monthEnd = monthDays[monthDays.length - 1] as string;

    const employees = await this.prisma.employee.findMany({
      where: {
        organizationId: claims.orgId,
        /*
         * Onboarding hires are excluded explicitly rather than by luck. Today
         * they escape a payslip only because nobody has assigned them a
         * salary — but assigning one before the start date is perfectly
         * normal once the offer is signed, and then they would be paid.
         */
        ...EMPLOYED_AND_LIVE,
        joinDate: { lte: toDate(monthEnd) },
        OR: [{ exitDate: null }, { exitDate: { gte: toDate(monthStart) } }],
      },
      include: {
        department: { select: { name: true } },
        designation: { select: { title: true } },
        bankDetail: true,
        salaries: {
          where: { effectiveFrom: { lte: toDate(monthEnd) } },
          orderBy: { effectiveFrom: 'desc' },
          take: 1,
          include: { structure: { include: { lines: { include: { component: true } } } } },
        },
      },
    });

    const lopByEmployee = await this.lossOfPayDays(
      claims.orgId,
      monthStart,
      monthEnd,
      employees.map((e) => e.id),
    );

    // One-offs entered for this month: bonuses, incentives, loan instalments.
    // Read here rather than inside the map so the whole month costs one query
    // regardless of headcount.
    const adjustmentsByEmployee = await this.adjustments.forMonth(claims.orgId, run.month);

    const payslips = employees
      .map((employee) => {
        const salary = employee.salaries[0];
        if (!salary) return null;

        const lines: StructureLineInput[] = salary.structure.lines.map((line) => ({
          code: line.component.code,
          name: line.component.name,
          kind: line.component.kind,
          calcType: line.calcType,
          value: Number(line.value),
          order: line.order,
        }));

        const joinKey = toDateKey(employee.joinDate);
        const exitKey = toDateKey(employee.exitDate);

        const calc = calculatePayslip({
          month: run.month,
          monthlyCtc: Number(salary.monthlyCtc),
          monthlyTds: Number(salary.monthlyTds),
          lines,
          lopDays: lopByEmployee.get(employee.id) ?? 0,
          // Only pass the boundary when it falls inside the month; otherwise
          // the whole month is payable.
          joinDate: joinKey && joinKey > monthStart ? joinKey : null,
          exitDate: exitKey && exitKey < monthEnd ? exitKey : null,
          adjustments: adjustmentsByEmployee.get(employee.id) ?? [],
          config,
          weekOffDays: weekOff,
        });

        return { employee, salary, calc };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);

    await this.prisma.$transaction(async (tx) => {
      await tx.payslipLine.deleteMany({ where: { payslip: { runId: id } } });
      await tx.payslip.deleteMany({ where: { runId: id } });

      /*
       * Two statements, whatever the headcount.
       *
       * This was a nested `create` per employee, which meant one round trip
       * each, sequentially, inside this transaction — so the transaction's
       * duration grew with the payroll and eventually exceeded Prisma's
       * interactive-transaction timeout. A payroll that fails because the
       * company hired people is not a payroll.
       *
       * `createManyAndReturn` gives back the generated ids, so the lines can
       * be inserted in one further statement without pre-generating ids.
       */
      const created = await tx.payslip.createManyAndReturn({
        data: payslips.map(({ employee, salary, calc }) => ({
          organizationId: claims.orgId,
          runId: id,
          employeeId: employee.id,
          // Snapshot: a payslip must still read true after a rename,
          // transfer, promotion or structure edit.
          employeeCode: employee.employeeCode,
          employeeName: `${employee.firstName} ${employee.lastName}`,
          departmentName: employee.department?.name ?? null,
          designationName: employee.designation?.title ?? null,
          structureName: salary.structure.name,
          bankName: employee.bankDetail?.bankName ?? null,
          accountNumberMasked: maskAccount(employee.bankDetail?.accountNumber),
          ifsc: employee.bankDetail?.ifscCode ?? null,
          workingDays: calc.workingDays,
          lopDays: calc.lopDays,
          payableDays: calc.payableDays,
          grossEarnings: calc.grossEarnings,
          totalDeductions: calc.totalDeductions,
          employerContribution: calc.employerContribution,
          netPay: calc.netPay,
          carriedShortfall: calc.carriedShortfall,
          paymentMethod: salary.paymentMethod,
        })),
        select: { id: true, employeeId: true },
      });

      // Keyed by employee: `createManyAndReturn` preserves input order on
      // PostgreSQL, but pairing on the id rather than the index means a change
      // to that guarantee cannot silently attach lines to the wrong payslip.
      const payslipIdByEmployee = new Map(created.map((row) => [row.employeeId, row.id]));

      await tx.payslipLine.createMany({
        data: payslips.flatMap(({ employee, calc }) => {
          const payslipId = payslipIdByEmployee.get(employee.id);
          if (!payslipId) return [];
          return calc.lines.map((line) => ({
            payslipId,
            componentCode: line.code,
            componentName: line.name,
            kind: line.kind,
            amount: line.amount,
            order: line.order,
          }));
        }),
      });

      const totals = payslips.reduce(
        (acc, { calc }) => ({
          earnings: acc.earnings + calc.grossEarnings,
          deductions: acc.deductions + calc.totalDeductions,
          employer: acc.employer + calc.employerContribution,
          net: acc.net + calc.netPay,
        }),
        { earnings: 0, deductions: 0, employer: 0, net: 0 },
      );

      await tx.payrollRun.update({
        where: { id },
        data: {
          status: nextStatus(run.status as RunStatus, 'calculate') as never,
          calculatedAt: new Date(),
          calculatedById: claims.sub,
          employeeCount: payslips.length,
          totalEarnings: toMoney(totals.earnings),
          totalDeductions: toMoney(totals.deductions),
          totalEmployerCost: toMoney(totals.employer),
          netPayable: toMoney(totals.net),
        },
      });
    });

    await auditMutation(this.prisma, ctx, 'payroll.run.calculate', 'PayrollRun', id, {
      before: { status: run.status },
      after: { status: 'IN_REVIEW', employeeCount: payslips.length },
    });
    return this.get(claims.orgId, id);
  }

  /** Approve, reopen, lock, publish or cancel. */
  async act(claims: AccessTokenClaims, id: string, input: PayrollRunActionInput) {
    if (input.action === 'calculate') return this.calculate(claims, id);

    const ctx = { orgId: claims.orgId, userId: claims.sub };
    const run = await this.requireTransition(claims, id, input.action);
    const to = nextStatus(run.status as RunStatus, input.action) as RunStatus;

    const stamps: Record<string, unknown> = {};
    if (input.action === 'approve') {
      stamps.approvedAt = new Date();
      stamps.approvedById = claims.sub;
    }
    if (input.action === 'lock') {
      stamps.lockedAt = new Date();
      stamps.lockedById = claims.sub;
    }
    if (input.action === 'publish') {
      stamps.publishedAt = new Date();
      stamps.publishedById = claims.sub;
    }
    if (input.action === 'reopen') {
      // Clear the approval so the trail cannot show a run that is under review
      // and approved at the same time.
      stamps.approvedAt = null;
      stamps.approvedById = null;
    }

    await this.prisma.payrollRun.update({
      where: { id },
      data: { status: to as never, ...stamps },
    });

    await auditMutation(this.prisma, ctx, `payroll.run.${input.action}`, 'PayrollRun', id, {
      before: { status: run.status },
      after: { status: to },
      note: input.note ?? null,
    });
    return this.get(claims.orgId, id);
  }

  /**
   * Loss-of-pay days per employee for the month.
   *
   * Derived rather than entered, consistent with how attendance and leave work
   * everywhere else: unpaid approved leave plus days explicitly marked absent.
   * The two are unioned by date so a day that is both is only counted once.
   */
  private async lossOfPayDays(
    orgId: string,
    monthStart: string,
    monthEnd: string,
    employeeIds: string[],
  ): Promise<Map<string, number>> {
    const [unpaidLeave, absences] = await Promise.all([
      this.prisma.leaveRequest.findMany({
        where: {
          employeeId: { in: employeeIds },
          status: 'APPROVED',
          leaveType: { isPaid: false },
          startDate: { lte: toDate(monthEnd) },
          endDate: { gte: toDate(monthStart) },
        },
        select: { employeeId: true, startDate: true, endDate: true, halfDaySide: true },
      }),
      this.prisma.attendanceRecord.findMany({
        where: {
          organizationId: orgId,
          employeeId: { in: employeeIds },
          status: 'ABSENT',
          date: { gte: toDate(monthStart), lte: toDate(monthEnd) },
        },
        select: { employeeId: true, date: true },
      }),
    ]);

    const days = new Map<string, Map<string, number>>();
    const mark = (employeeId: string, dateKey: string, value: number) => {
      const forEmployee = days.get(employeeId) ?? new Map<string, number>();
      // A day already counted as a full day is never downgraded to a half.
      forEmployee.set(dateKey, Math.max(forEmployee.get(dateKey) ?? 0, value));
      days.set(employeeId, forEmployee);
    };

    for (const leave of unpaidLeave) {
      const from = toDateKey(leave.startDate) as string;
      const to = toDateKey(leave.endDate) as string;
      const isHalf = Boolean(leave.halfDaySide) && from === to;
      for (const day of eachDayInclusive(from, to)) {
        if (day < monthStart || day > monthEnd) continue;
        mark(leave.employeeId, day, isHalf ? 0.5 : 1);
      }
    }
    for (const record of absences) {
      mark(record.employeeId, toDateKey(record.date) as string, 1);
    }

    const totals = new Map<string, number>();
    for (const [employeeId, byDay] of days) {
      totals.set(employeeId, toDays([...byDay.values()].reduce((sum, n) => sum + n, 0)));
    }
    return totals;
  }

  /** Loads the run and refuses the action if state or permission says no. */
  private async requireTransition(claims: AccessTokenClaims, id: string, action: RunAction) {
    const run = await this.prisma.payrollRun.findFirst({
      where: { id, organizationId: claims.orgId },
    });
    if (!run) throw new NotFoundException('Payroll run not found');

    const required = RUN_ACTION_PERMISSION[action];
    if (!new Set(claims.perms).has(required)) {
      throw new ForbiddenException(`You need ${required} to ${action} payroll`);
    }
    if (!canTransition(run.status as RunStatus, action)) {
      throw new BadRequestException(transitionError(run.status as RunStatus, action));
    }
    return run;
  }
}

/** Inclusive day keys; small enough to inline rather than import a helper. */
function eachDayInclusive(from: string, to: string): string[] {
  const keys: string[] = [];
  const cursor = new Date(`${from}T00:00:00.000Z`);
  const end = new Date(`${to}T00:00:00.000Z`);
  while (cursor <= end && keys.length < 400) {
    keys.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return keys;
}
