import type { LeaveBalanceAdjustInput, LeaveBalanceQuery } from '@hrms/shared';
import type { AccessTokenClaims } from '@hrms/types';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { auditMutation } from '../../common/utils/audit';
import { dateKeyOf, leaveYearOf } from '../../common/utils/calendar';
import { toPaginated } from '../../common/utils/list-query';
import { PrismaService } from '../../database/prisma.service';
import { EMPLOYED_AND_LIVE } from '../employees/employee-scopes';
import { SettingsService } from '../settings/settings.service';
import { mapBalance } from './leave.mapper';

@Injectable()
export class LeaveBalancesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
  ) {}

  /** The leave year a date falls in under this organization's policy. */
  async yearFor(orgId: string, dateKey: string): Promise<number> {
    const settings = await this.settings.get(orgId);
    return leaveYearOf(dateKey, settings.leave.yearStartMonth);
  }

  /** The leave year currently running for this organization. */
  currentYear(orgId: string): Promise<number> {
    return this.yearFor(orgId, dateKeyOf(new Date()));
  }

  /**
   * Balances are provisioned lazily from each leave type's annual
   * allocation the first time a year is touched, so HR never has to run a
   * bulk job before people can apply. Existing rows are left alone —
   * manual adjustments are never overwritten.
   */
  async ensureForEmployee(orgId: string, employeeId: string, year: number) {
    const [types, existing] = await Promise.all([
      this.prisma.leaveType.findMany({ where: { organizationId: orgId } }),
      this.prisma.leaveBalance.findMany({ where: { employeeId, year } }),
    ]);
    const have = new Set(existing.map((b) => b.leaveTypeId));
    const missing = types.filter((t) => !have.has(t.id));
    if (missing.length > 0) {
      await this.prisma.leaveBalance.createMany({
        data: missing.map((t) => ({
          employeeId,
          leaveTypeId: t.id,
          year,
          allocated: t.daysPerYear,
        })),
        skipDuplicates: true,
      });
    }
  }

  async forEmployee(orgId: string, employeeId: string, year: number) {
    await this.ensureForEmployee(orgId, employeeId, year);
    const rows = await this.prisma.leaveBalance.findMany({
      where: { employeeId, year },
      include: { leaveType: true },
      orderBy: { leaveType: { name: 'asc' } },
    });
    return { year, balances: rows.map(mapBalance) };
  }

  /** HR/manager view — one row per employee+type for the year. */
  async list(claims: AccessTokenClaims, query: LeaveBalanceQuery) {
    const perms = new Set(claims.perms);
    const year = query.year ?? (await this.currentYear(claims.orgId));
    const employeeWhere = {
      organizationId: claims.orgId,
      /*
       * Onboarding hires are excluded, and not only for tidiness: listing them
       * calls ensureForEmployee below, which *provisions a full leave year* as
       * a side effect. A candidate who never joins would otherwise be holding
       * an allocation because HR opened a screen.
       */
      ...EMPLOYED_AND_LIVE,
      ...(query.employeeId ? { id: query.employeeId } : {}),
      ...(perms.has('leave.read') ? {} : { managerId: claims.employeeId ?? '__none__' }),
    };

    const employees = await this.prisma.employee.findMany({
      where: employeeWhere,
      select: { id: true },
    });
    // Provision on demand so newly added types show up for everyone
    await Promise.all(employees.map((e) => this.ensureForEmployee(claims.orgId, e.id, year)));

    const where = { year, employee: employeeWhere };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.leaveBalance.findMany({
        where,
        include: {
          leaveType: true,
          employee: {
            select: { id: true, firstName: true, lastName: true, employeeCode: true },
          },
        },
        orderBy: [{ employee: { firstName: 'asc' } }, { leaveType: { name: 'asc' } }],
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      this.prisma.leaveBalance.count({ where }),
    ]);
    return { year, ...toPaginated(rows.map(mapBalance), total, query) };
  }

  /** HR overrides an allocation; `used` is never edited directly. */
  async adjust(claims: AccessTokenClaims, input: LeaveBalanceAdjustInput) {
    const [employee, type] = await Promise.all([
      this.prisma.employee.findFirst({
        where: { id: input.employeeId, organizationId: claims.orgId, deletedAt: null },
      }),
      this.prisma.leaveType.findFirst({
        where: { id: input.leaveTypeId, organizationId: claims.orgId },
      }),
    ]);
    if (!employee) throw new NotFoundException('Employee not found');
    if (!type) throw new NotFoundException('Leave type not found');

    const existing = await this.prisma.leaveBalance.findUnique({
      where: {
        employeeId_leaveTypeId_year: {
          employeeId: input.employeeId,
          leaveTypeId: input.leaveTypeId,
          year: input.year,
        },
      },
    });
    if (existing && Number(existing.used) > input.allocated + input.carriedOver) {
      throw new BadRequestException(
        `${Number(existing.used)} days are already booked — allocate at least that many`,
      );
    }

    const row = await this.prisma.leaveBalance.upsert({
      where: {
        employeeId_leaveTypeId_year: {
          employeeId: input.employeeId,
          leaveTypeId: input.leaveTypeId,
          year: input.year,
        },
      },
      update: { allocated: input.allocated, carriedOver: input.carriedOver },
      create: {
        employeeId: input.employeeId,
        leaveTypeId: input.leaveTypeId,
        year: input.year,
        allocated: input.allocated,
        carriedOver: input.carriedOver,
      },
      include: { leaveType: true },
    });
    await auditMutation(
      this.prisma,
      { orgId: claims.orgId, userId: claims.sub },
      'leave.balance.adjust',
      'LeaveBalance',
      row.id,
    );
    return mapBalance(row);
  }
}
