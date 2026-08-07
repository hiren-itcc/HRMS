import type { PayrollAdjustmentInput, PayrollAdjustmentQuery } from '@hrms/shared';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { auditMutation } from '../../common/utils/audit';
import { PrismaService } from '../../database/prisma.service';
import { toMoney } from './payroll.mapper';

/**
 * One-off amounts for a single month: bonuses, incentives, loan instalments.
 *
 * The calculation engine has accepted `adjustments[]` since payroll shipped and
 * `payroll-runs.service.ts` passed it an empty array, so none of it could be
 * reached. This is the missing half.
 *
 * They are kept out of salary structures deliberately. A structure is what
 * somebody earns *every* month; a bonus is the opposite. Putting one-offs in a
 * structure means adding a component and then remembering to remove it, which
 * is how a "temporary" allowance becomes permanent.
 */
@Injectable()
export class PayrollAdjustmentsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(orgId: string, query: PayrollAdjustmentQuery) {
    const rows = await this.prisma.payrollAdjustment.findMany({
      where: {
        organizationId: orgId,
        month: query.month,
        ...(query.employeeId ? { employeeId: query.employeeId } : {}),
      },
      include: {
        component: { select: { id: true, code: true, name: true, kind: true } },
        employee: {
          select: { id: true, firstName: true, lastName: true, employeeCode: true },
        },
      },
      orderBy: [{ employee: { employeeCode: 'asc' } }, { component: { code: 'asc' } }],
    });
    return rows.map((row) => ({
      id: row.id,
      month: row.month,
      amount: toMoney(row.amount),
      note: row.note,
      component: row.component,
      employee: row.employee,
    }));
  }

  /**
   * Creates or replaces the amount for that employee, month and component.
   *
   * Upsert rather than reject-on-duplicate because the unique key is the whole
   * point: two "Bonus" rows would print two payslip lines with the same code
   * and no way to tell them apart. Raising the single figure is the sane edit,
   * so entering it twice does that instead of failing.
   *
   * `mode: 'add'` sums into the existing figure instead of replacing it, for
   * callers where a second amount is genuinely a second thing rather than a
   * correction — two expense claims approved into the same month on the same
   * category. Replacing would silently lose the first one's money. Added as an
   * optional argument rather than a field on `PayrollAdjustmentInput`, so it
   * stays a decision the calling service makes and never something an API
   * client can send.
   */
  async upsert(
    ctx: { orgId: string; userId: string },
    input: PayrollAdjustmentInput,
    options: { mode?: 'set' | 'add' } = {},
  ) {
    const employee = await this.prisma.employee.findFirst({
      where: { id: input.employeeId, organizationId: ctx.orgId, deletedAt: null },
      select: { id: true },
    });
    if (!employee) throw new NotFoundException('Employee not found');

    const component = await this.prisma.payComponent.findFirst({
      where: { id: input.componentId, organizationId: ctx.orgId, active: true },
      select: { id: true, kind: true, isStatutory: true, code: true },
    });
    if (!component) throw new NotFoundException('Pay component not found');

    /*
     * Statutory components are computed from settings, and employer-cost ones
     * never touch net pay. Letting either be entered by hand would produce a
     * payslip whose PF line disagrees with the PF rules that generated it.
     */
    if (component.isStatutory) {
      throw new BadRequestException(
        `${component.code} is calculated from your payroll settings and cannot be adjusted by hand`,
      );
    }
    if (component.kind !== 'EARNING' && component.kind !== 'DEDUCTION') {
      throw new BadRequestException('Only earnings and deductions can be adjusted');
    }

    await this.assertMonthOpen(ctx.orgId, input.month);

    const row = await this.prisma.payrollAdjustment.upsert({
      where: {
        employeeId_month_componentId: {
          employeeId: input.employeeId,
          month: input.month,
          componentId: input.componentId,
        },
      },
      create: {
        organizationId: ctx.orgId,
        employeeId: input.employeeId,
        month: input.month,
        componentId: input.componentId,
        amount: input.amount,
        note: input.note ?? null,
        createdById: ctx.userId,
      },
      update:
        options.mode === 'add'
          ? // `increment` rather than read-then-write: two claims approved at
            // the same moment would otherwise both read the old figure and the
            // second would overwrite the first.
            { amount: { increment: input.amount }, note: input.note ?? null }
          : { amount: input.amount, note: input.note ?? null },
    });

    await auditMutation(this.prisma, ctx, 'payroll.adjustment.set', 'PayrollAdjustment', row.id, {
      after: { month: input.month, component: component.code, amount: input.amount },
    });
    return { id: row.id };
  }

  async remove(ctx: { orgId: string; userId: string }, id: string) {
    const row = await this.prisma.payrollAdjustment.findFirst({
      where: { id, organizationId: ctx.orgId },
      include: { component: { select: { code: true } } },
    });
    if (!row) throw new NotFoundException('Adjustment not found');

    await this.assertMonthOpen(ctx.orgId, row.month);

    await this.prisma.payrollAdjustment.delete({ where: { id } });
    await auditMutation(this.prisma, ctx, 'payroll.adjustment.delete', 'PayrollAdjustment', id, {
      before: { month: row.month, component: row.component.code, amount: toMoney(row.amount) },
    });
    return { id };
  }

  /** What `calculate()` reads: every adjustment for the month, by employee. */
  async forMonth(orgId: string, month: string) {
    const rows = await this.prisma.payrollAdjustment.findMany({
      where: { organizationId: orgId, month },
      include: { component: { select: { code: true, name: true, kind: true } } },
    });

    const byEmployee = new Map<
      string,
      { code: string; name: string; kind: 'EARNING' | 'DEDUCTION'; amount: number }[]
    >();
    for (const row of rows) {
      // The engine only understands these two; anything else was refused at
      // entry, so this is a type narrowing rather than a filter.
      if (row.component.kind !== 'EARNING' && row.component.kind !== 'DEDUCTION') continue;
      const list = byEmployee.get(row.employeeId) ?? [];
      list.push({
        code: row.component.code,
        name: row.component.name,
        kind: row.component.kind,
        amount: toMoney(row.amount),
      });
      byEmployee.set(row.employeeId, list);
    }
    return byEmployee;
  }

  /**
   * Refuses once the month is settled — the same rule salary revisions follow.
   * A locked or published run is what somebody was actually paid, and an
   * adjustment that appears afterwards would silently disagree with it.
   */
  private async assertMonthOpen(orgId: string, month: string) {
    const run = await this.prisma.payrollRun.findFirst({
      where: { organizationId: orgId, month, status: { in: ['LOCKED', 'PUBLISHED'] } },
      select: { status: true },
    });
    if (run) {
      throw new BadRequestException(
        `Payroll for ${month} is ${run.status.toLowerCase()} — adjust the next month's run instead`,
      );
    }
  }
}
