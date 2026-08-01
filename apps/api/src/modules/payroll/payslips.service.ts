import type { PaymentUpdateInput, PayslipQuery } from '@hrms/shared';
import type { AccessTokenClaims } from '@hrms/types';
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { auditMutation } from '../../common/utils/audit';
import { buildListArgs, searchWhere, toPaginated } from '../../common/utils/list-query';
import { PrismaService } from '../../database/prisma.service';
import { toDateKey, toDays, toMoney } from './payroll.mapper';
import {
  canPay,
  canTransitionPayment,
  isPayslipVisibleToEmployee,
  type PaymentStatus,
  paymentTransitionError,
  type RunStatus,
} from './payroll.workflow';

const SORTABLE = ['employeeName', 'netPay', 'createdAt'] as const;

@Injectable()
export class PayslipsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(claims: AccessTokenClaims, query: PayslipQuery) {
    const where = {
      organizationId: claims.orgId,
      ...(await this.visibilityWhere(claims)),
      ...(query.runId ? { runId: query.runId } : {}),
      ...(query.employeeId ? { employeeId: query.employeeId } : {}),
      ...(query.month ? { run: { month: query.month } } : {}),
      ...(query.paymentStatus ? { paymentStatus: query.paymentStatus } : {}),
      ...(query.departmentId ? { employee: { departmentId: query.departmentId } } : {}),
      ...searchWhere(query.search, ['employeeName', 'employeeCode']),
    };

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.payslip.findMany({
        where,
        include: { run: { select: { month: true, status: true, payDate: true } } },
        ...buildListArgs(query, SORTABLE, 'employeeName'),
      }),
      this.prisma.payslip.count({ where }),
    ]);

    return toPaginated(
      rows.map((row) => ({
        id: row.id,
        runId: row.runId,
        month: row.run.month,
        runStatus: row.run.status,
        employeeId: row.employeeId,
        employeeCode: row.employeeCode,
        employeeName: row.employeeName,
        department: row.departmentName,
        designation: row.designationName,
        payableDays: toDays(row.payableDays),
        lopDays: toDays(row.lopDays),
        grossEarnings: toMoney(row.grossEarnings),
        totalDeductions: toMoney(row.totalDeductions),
        netPay: toMoney(row.netPay),
        carriedShortfall: toMoney(row.carriedShortfall),
        paymentStatus: row.paymentStatus,
        paymentMethod: row.paymentMethod,
        paidAt: row.paidAt?.toISOString() ?? null,
        payDate: toDateKey(row.run.payDate),
      })),
      total,
      query,
    );
  }

  /** One payslip with its full breakdown — the payslip document itself. */
  async get(claims: AccessTokenClaims, id: string) {
    const row = await this.prisma.payslip.findFirst({
      where: { id, organizationId: claims.orgId },
      include: {
        lines: { orderBy: { order: 'asc' } },
        run: { select: { month: true, status: true, payDate: true } },
      },
    });
    if (!row) throw new NotFoundException('Payslip not found');
    await this.assertVisible(claims, row.employeeId, row.run.status as RunStatus);

    const lines = row.lines.map((line) => ({
      code: line.componentCode,
      name: line.componentName,
      kind: line.kind,
      amount: toMoney(line.amount),
    }));

    return {
      id: row.id,
      runId: row.runId,
      month: row.run.month,
      runStatus: row.run.status,
      payDate: toDateKey(row.run.payDate),
      employee: {
        id: row.employeeId,
        code: row.employeeCode,
        name: row.employeeName,
        department: row.departmentName,
        designation: row.designationName,
      },
      structureName: row.structureName,
      bank: {
        name: row.bankName,
        accountNumberMasked: row.accountNumberMasked,
        ifsc: row.ifsc,
      },
      days: {
        working: toDays(row.workingDays),
        lop: toDays(row.lopDays),
        payable: toDays(row.payableDays),
      },
      earnings: lines.filter((l) => l.kind === 'EARNING'),
      deductions: lines.filter((l) => l.kind === 'DEDUCTION'),
      employerContributions: lines.filter((l) => l.kind === 'EMPLOYER_CONTRIBUTION'),
      totals: {
        gross: toMoney(row.grossEarnings),
        deductions: toMoney(row.totalDeductions),
        employerContribution: toMoney(row.employerContribution),
        net: toMoney(row.netPay),
        carriedShortfall: toMoney(row.carriedShortfall),
      },
      payment: {
        status: row.paymentStatus,
        method: row.paymentMethod,
        paidAt: row.paidAt?.toISOString() ?? null,
        reference: row.paymentRef,
        failureReason: row.failureReason,
      },
    };
  }

  /**
   * Moves payment status in bulk — one bank file covers many payslips, and one
   * of them failing must not disturb the others.
   */
  async updatePayment(claims: AccessTokenClaims, input: PaymentUpdateInput) {
    const ctx = { orgId: claims.orgId, userId: claims.sub };
    if (input.status === 'FAILED' && !input.failureReason) {
      throw new BadRequestException('A failed payment needs a reason');
    }

    const payslips = await this.prisma.payslip.findMany({
      where: { id: { in: input.payslipIds }, organizationId: claims.orgId },
      include: { run: { select: { status: true, month: true } } },
    });
    if (payslips.length !== new Set(input.payslipIds).size) {
      throw new NotFoundException('One or more payslips do not exist');
    }

    const unpublished = payslips.find((p) => !canPay(p.run.status as RunStatus));
    if (unpublished) {
      throw new BadRequestException(
        `Payroll for ${unpublished.run.month} is not published yet — publish it before recording payment`,
      );
    }

    const illegal = payslips.find(
      (p) => !canTransitionPayment(p.paymentStatus as PaymentStatus, input.status),
    );
    if (illegal) {
      throw new BadRequestException(
        `${illegal.employeeName}: ${paymentTransitionError(illegal.paymentStatus as PaymentStatus, input.status)}`,
      );
    }

    await this.prisma.payslip.updateMany({
      where: { id: { in: input.payslipIds } },
      data: {
        paymentStatus: input.status as never,
        paidAt: input.status === 'PAID' ? new Date() : null,
        paymentRef: input.paymentRef ?? null,
        failureReason: input.status === 'FAILED' ? (input.failureReason ?? null) : null,
      },
    });

    await auditMutation(
      this.prisma,
      ctx,
      'payroll.payment.update',
      'Payslip',
      input.payslipIds[0] ?? '',
      {
        before: { statuses: [...new Set(payslips.map((p) => p.paymentStatus))] },
        after: { status: input.status },
        count: payslips.length,
        reference: input.paymentRef ?? null,
      },
    );

    return { updated: payslips.length, status: input.status };
  }

  /** The signed-in employee's own published payslips. */
  async mine(claims: AccessTokenClaims, query: PayslipQuery) {
    if (!claims.employeeId) return toPaginated([], 0, query);
    return this.list(
      { ...claims, perms: ['payroll.read.own'] },
      {
        ...query,
        employeeId: claims.employeeId,
      },
    );
  }

  /**
   * Scopes a list by what the caller may see. Employees see their own
   * published payslips only; managers add their reports; `payroll.read` sees
   * everything including runs still in review.
   */
  private async visibilityWhere(claims: AccessTokenClaims) {
    const perms = new Set(claims.perms);
    if (perms.has('payroll.read')) return {};

    const published = { run: { status: 'PUBLISHED' as const } };
    if (perms.has('payroll.read.team')) {
      const reports = await this.prisma.employee.findMany({
        where: { organizationId: claims.orgId, managerId: claims.employeeId ?? '__none__' },
        select: { id: true },
      });
      return {
        ...published,
        employeeId: { in: [...reports.map((r) => r.id), claims.employeeId ?? '__none__'] },
      };
    }
    return { ...published, employeeId: claims.employeeId ?? '__none__' };
  }

  private async assertVisible(claims: AccessTokenClaims, employeeId: string, runStatus: RunStatus) {
    const perms = new Set(claims.perms);
    if (perms.has('payroll.read')) return;

    // An unpublished payslip does not exist as far as its owner is concerned:
    // the figures are still moving, and a payslip seen once cannot be unseen.
    if (!isPayslipVisibleToEmployee(runStatus)) {
      throw new ForbiddenException('This payslip has not been published yet');
    }
    if (claims.employeeId === employeeId) return;

    if (perms.has('payroll.read.team')) {
      const report = await this.prisma.employee.findFirst({
        where: {
          id: employeeId,
          organizationId: claims.orgId,
          managerId: claims.employeeId ?? '__none__',
        },
        select: { id: true },
      });
      if (report) return;
    }
    throw new ForbiddenException('You cannot view this payslip');
  }
}
