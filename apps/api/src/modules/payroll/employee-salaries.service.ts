import type { EmployeeSalaryInput, SalaryQuery } from '@hrms/shared';
import type { AccessTokenClaims } from '@hrms/types';
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { auditMutation } from '../../common/utils/audit';
import { toDate } from '../../common/utils/calendar';
import { buildListArgs, searchWhere, toPaginated } from '../../common/utils/list-query';
import { PrismaService } from '../../database/prisma.service';
import { maskAccount, toDateKey, toMoney } from './payroll.mapper';

const SORTABLE = ['firstName', 'employeeCode', 'joinDate'] as const;

/**
 * Employee salary — assignment and revision history in one effective-dated
 * table. The salary as at a date is the row with the greatest `effectiveFrom`
 * on or before it, so history cannot drift away from the live value.
 */
@Injectable()
export class EmployeeSalariesService {
  constructor(private readonly prisma: PrismaService) {}

  /** Roster with the current salary alongside, for the assignment screen. */
  async list(claims: AccessTokenClaims, query: SalaryQuery) {
    const where = {
      organizationId: claims.orgId,
      deletedAt: null,
      ...(query.departmentId ? { departmentId: query.departmentId } : {}),
      ...searchWhere(query.search, ['firstName', 'lastName', 'employeeCode', 'workEmail']),
      ...(query.unassigned ? { salaries: { none: {} } } : {}),
      ...(query.structureId ? { salaries: { some: { structureId: query.structureId } } } : {}),
    };

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.employee.findMany({
        where,
        include: {
          department: { select: { name: true } },
          designation: { select: { title: true } },
          // Only the current row is needed for a list; the full timeline is
          // fetched when someone opens one person.
          salaries: {
            orderBy: { effectiveFrom: 'desc' },
            take: 1,
            include: { structure: { select: { name: true } } },
          },
        },
        ...buildListArgs(query, SORTABLE, 'firstName'),
      }),
      this.prisma.employee.count({ where }),
    ]);

    const data = rows.map((row) => {
      const current = row.salaries[0];
      return {
        employeeId: row.id,
        employeeCode: row.employeeCode,
        name: `${row.firstName} ${row.lastName}`,
        department: row.department?.name ?? null,
        designation: row.designation?.title ?? null,
        status: row.status,
        joinDate: toDateKey(row.joinDate),
        current: current
          ? {
              id: current.id,
              structureId: current.structureId,
              structureName: current.structure.name,
              monthlyCtc: toMoney(current.monthlyCtc),
              monthlyTds: toMoney(current.monthlyTds),
              effectiveFrom: toDateKey(current.effectiveFrom),
              revisionType: current.revisionType,
              paymentMethod: current.paymentMethod,
            }
          : null,
      };
    });
    return toPaginated(data, total, query);
  }

  /**
   * One employee's full salary timeline, newest first, with the delta from the
   * revision before it — which is the number a revision history exists to show.
   */
  async timeline(claims: AccessTokenClaims, employeeId: string) {
    await this.assertVisible(claims, employeeId);

    const [employee, rows] = await Promise.all([
      this.prisma.employee.findFirst({
        where: { id: employeeId, organizationId: claims.orgId },
        include: {
          department: { select: { name: true } },
          designation: { select: { title: true } },
          bankDetail: true,
        },
      }),
      this.prisma.employeeSalary.findMany({
        where: { employeeId },
        orderBy: { effectiveFrom: 'desc' },
        include: { structure: { include: { lines: { include: { component: true } } } } },
      }),
    ]);
    if (!employee) throw new NotFoundException('Employee not found');

    const revisions = rows.map((row, index) => {
      // `rows` is newest first, so the previous salary is the *next* element.
      const previous = rows[index + 1];
      const ctc = toMoney(row.monthlyCtc);
      const previousCtc = previous ? toMoney(previous.monthlyCtc) : null;
      return {
        id: row.id,
        effectiveFrom: toDateKey(row.effectiveFrom),
        structureId: row.structureId,
        structureName: row.structure.name,
        monthlyCtc: ctc,
        monthlyTds: toMoney(row.monthlyTds),
        revisionType: row.revisionType,
        reason: row.reason,
        paymentMethod: row.paymentMethod,
        approvedById: row.approvedById,
        createdAt: row.createdAt.toISOString(),
        previousCtc,
        changeAmount: previousCtc === null ? null : toMoney(ctc - previousCtc),
        changePercent:
          previousCtc === null || previousCtc === 0
            ? null
            : Math.round(((ctc - previousCtc) / previousCtc) * 1000) / 10,
      };
    });

    return {
      employee: {
        id: employee.id,
        employeeCode: employee.employeeCode,
        name: `${employee.firstName} ${employee.lastName}`,
        department: employee.department?.name ?? null,
        designation: employee.designation?.title ?? null,
        joinDate: toDateKey(employee.joinDate),
        exitDate: toDateKey(employee.exitDate),
        status: employee.status,
        bank: employee.bankDetail
          ? {
              bankName: employee.bankDetail.bankName,
              accountNumberMasked: maskAccount(employee.bankDetail.accountNumber),
              ifsc: employee.bankDetail.ifscCode,
            }
          : null,
      },
      current: revisions[0] ?? null,
      revisions,
    };
  }

  async assign(ctx: { orgId: string; userId: string }, input: EmployeeSalaryInput) {
    const employee = await this.prisma.employee.findFirst({
      where: { id: input.employeeId, organizationId: ctx.orgId, deletedAt: null },
      select: { id: true, joinDate: true, firstName: true, lastName: true },
    });
    if (!employee) throw new NotFoundException('Employee not found');

    const structure = await this.prisma.salaryStructure.findFirst({
      where: { id: input.structureId, organizationId: ctx.orgId },
      select: { id: true, name: true },
    });
    if (!structure) throw new NotFoundException('Salary structure not found');

    const joinKey = toDateKey(employee.joinDate);
    if (joinKey && input.effectiveFrom < joinKey) {
      throw new BadRequestException(
        `A salary cannot take effect before the join date (${joinKey})`,
      );
    }

    /*
     * A revision must not land inside a month whose payroll is already locked
     * or published — the payslips for that month are final, and a salary the
     * payslip disagrees with is worse than no salary at all.
     */
    const month = input.effectiveFrom.slice(0, 7);
    const settled = await this.prisma.payrollRun.findFirst({
      where: {
        organizationId: ctx.orgId,
        month: { gte: month },
        status: { in: ['LOCKED', 'PUBLISHED'] },
      },
      orderBy: { month: 'asc' },
      select: { month: true, status: true },
    });
    if (settled) {
      throw new BadRequestException(
        `Payroll for ${settled.month} is already ${settled.status.toLowerCase()} — a revision effective ${input.effectiveFrom} would contradict payslips that have been issued`,
      );
    }

    const previous = await this.prisma.employeeSalary.findFirst({
      where: { employeeId: input.employeeId },
      orderBy: { effectiveFrom: 'desc' },
    });

    const row = await this.prisma.employeeSalary.upsert({
      // Re-assigning on a date that already has a row replaces it rather than
      // failing: correcting today's entry is a normal thing to do.
      where: {
        employeeId_effectiveFrom: {
          employeeId: input.employeeId,
          effectiveFrom: toDate(input.effectiveFrom),
        },
      },
      create: {
        employeeId: input.employeeId,
        structureId: input.structureId,
        effectiveFrom: toDate(input.effectiveFrom),
        monthlyCtc: input.monthlyCtc,
        monthlyTds: input.monthlyTds,
        revisionType: input.revisionType,
        reason: input.reason ?? null,
        paymentMethod: input.paymentMethod,
        approvedById: ctx.userId,
      },
      update: {
        structureId: input.structureId,
        monthlyCtc: input.monthlyCtc,
        monthlyTds: input.monthlyTds,
        revisionType: input.revisionType,
        reason: input.reason ?? null,
        paymentMethod: input.paymentMethod,
        approvedById: ctx.userId,
      },
    });

    await auditMutation(this.prisma, ctx, 'payroll.salary.revise', 'EmployeeSalary', row.id, {
      before: previous
        ? {
            monthlyCtc: toMoney(previous.monthlyCtc),
            structureId: previous.structureId,
            effectiveFrom: toDateKey(previous.effectiveFrom),
          }
        : null,
      after: {
        monthlyCtc: input.monthlyCtc,
        structureId: input.structureId,
        effectiveFrom: input.effectiveFrom,
        revisionType: input.revisionType,
      },
      employee: `${employee.firstName} ${employee.lastName}`,
      reason: input.reason ?? null,
    });

    return { id: row.id };
  }

  async remove(ctx: { orgId: string; userId: string }, id: string) {
    const row = await this.prisma.employeeSalary.findFirst({
      where: { id, employee: { organizationId: ctx.orgId } },
    });
    if (!row) throw new NotFoundException('Salary revision not found');

    const month = toDateKey(row.effectiveFrom)?.slice(0, 7) ?? '';
    const settled = await this.prisma.payrollRun.findFirst({
      where: {
        organizationId: ctx.orgId,
        month: { gte: month },
        status: { in: ['LOCKED', 'PUBLISHED'] },
      },
      select: { month: true },
    });
    if (settled) {
      throw new BadRequestException(
        `Payroll for ${settled.month} is settled — this revision is part of the record and cannot be removed`,
      );
    }

    await this.prisma.employeeSalary.delete({ where: { id } });
    await auditMutation(this.prisma, ctx, 'payroll.salary.delete', 'EmployeeSalary', id, {
      before: {
        monthlyCtc: toMoney(row.monthlyCtc),
        effectiveFrom: toDateKey(row.effectiveFrom),
      },
    });
    return { id };
  }

  /**
   * Own salary always; a direct report's with `payroll.read.team`; anyone's
   * with `payroll.read`.
   */
  private async assertVisible(claims: AccessTokenClaims, employeeId: string) {
    const perms = new Set(claims.perms);
    if (perms.has('payroll.read')) return;
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
    throw new ForbiddenException('You cannot view this salary');
  }
}
