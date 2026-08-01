import type {
  LeaveApplyInput,
  LeaveDecisionInput,
  LeavePreviewQuery,
  LeaveRequestQuery,
} from '@hrms/shared';
import type { AccessTokenClaims } from '@hrms/types';
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { auditMutation } from '../../common/utils/audit';
import { dateKeyOf, toDate } from '../../common/utils/calendar';
import { toPaginated } from '../../common/utils/list-query';
import { PrismaService } from '../../database/prisma.service';
import type { Prisma } from '../../generated/prisma/client';
import { SettingsService } from '../settings/settings.service';
import { mapRequest } from './leave.mapper';
import {
  availableDays,
  BLOCKING_STATUSES,
  calculateLeaveDays,
  canEmployeeCancel,
  round1,
} from './leave.util';
import { currentLeaveYear, LeaveBalancesService } from './leave-balances.service';

const INCLUDE = {
  leaveType: { select: { id: true, name: true, code: true } },
  employee: {
    select: { id: true, firstName: true, lastName: true, employeeCode: true, managerId: true },
  },
} as const;

@Injectable()
export class LeaveRequestsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly balances: LeaveBalancesService,
    private readonly settings: SettingsService,
  ) {}

  /** Org policy: which weekdays never consume leave balance. */
  private async weekOffDays(orgId: string): Promise<number[]> {
    const settings = await this.settings.get(orgId);
    return settings.workingWeek.weekOffDays;
  }

  private requireEmployee(claims: AccessTokenClaims): string {
    if (!claims.employeeId) {
      throw new BadRequestException('No employee record is linked to this account');
    }
    return claims.employeeId;
  }

  /** Holidays never consume balance — the preview shows exactly what will. */
  private async holidayKeys(orgId: string, startKey: string, endKey: string) {
    const rows = await this.prisma.holiday.findMany({
      where: { organizationId: orgId, date: { gte: toDate(startKey), lte: toDate(endKey) } },
      select: { date: true },
    });
    return new Set(rows.map((h) => dateKeyOf(h.date)));
  }

  /** Live day-count for the apply form, before anything is submitted. */
  async preview(claims: AccessTokenClaims, query: LeavePreviewQuery) {
    const [holidays, weekOff] = await Promise.all([
      this.holidayKeys(claims.orgId, query.startDate, query.endDate),
      this.weekOffDays(claims.orgId),
    ]);
    const breakdown = calculateLeaveDays(
      query.startDate,
      query.endDate,
      holidays,
      query.halfDaySide,
      weekOff,
    );
    return {
      days: breakdown.days,
      workingDays: breakdown.workingDays.length,
      skipped: breakdown.skipped,
    };
  }

  async apply(claims: AccessTokenClaims, input: LeaveApplyInput) {
    const employeeId = this.requireEmployee(claims);
    const type = await this.prisma.leaveType.findFirst({
      where: { id: input.leaveTypeId, organizationId: claims.orgId },
    });
    if (!type) throw new NotFoundException('Leave type not found');

    const [holidays, weekOff] = await Promise.all([
      this.holidayKeys(claims.orgId, input.startDate, input.endDate),
      this.weekOffDays(claims.orgId),
    ]);
    const { days } = calculateLeaveDays(
      input.startDate,
      input.endDate,
      holidays,
      input.halfDaySide,
      weekOff,
    );
    if (days <= 0) {
      throw new BadRequestException(
        'Those dates are all weekends or holidays — no leave is needed',
      );
    }

    // Any pending/approved request touching the same dates blocks a new one
    const clash = await this.prisma.leaveRequest.findFirst({
      where: {
        employeeId,
        status: { in: [...BLOCKING_STATUSES] },
        startDate: { lte: toDate(input.endDate) },
        endDate: { gte: toDate(input.startDate) },
      },
      include: INCLUDE,
    });
    if (clash) {
      throw new BadRequestException(
        `These dates overlap an existing ${clash.status.toLowerCase()} request`,
      );
    }

    const year = await this.balances.yearFor(claims.orgId, input.startDate);
    await this.balances.ensureForEmployee(claims.orgId, employeeId, year);
    const balance = await this.prisma.leaveBalance.findUnique({
      where: {
        employeeId_leaveTypeId_year: { employeeId, leaveTypeId: type.id, year },
      },
    });
    const available = balance
      ? availableDays({
          allocated: Number(balance.allocated),
          carriedOver: Number(balance.carriedOver),
          used: Number(balance.used),
        })
      : 0;
    if (days > available) {
      throw new BadRequestException(
        `Only ${available} day(s) of ${type.name} remain — this request needs ${days}`,
      );
    }

    const request = await this.prisma.leaveRequest.create({
      data: {
        employeeId,
        leaveTypeId: type.id,
        startDate: toDate(input.startDate),
        endDate: toDate(input.endDate),
        halfDaySide: input.halfDaySide ?? null,
        days,
        reason: input.reason,
        // Types that skip approval are booked immediately
        status: type.requiresApproval ? 'PENDING' : 'APPROVED',
        ...(type.requiresApproval ? {} : { actedAt: new Date() }),
      },
      include: INCLUDE,
    });

    if (!type.requiresApproval) await this.addUsed(employeeId, type.id, year, days);

    await auditMutation(
      this.prisma,
      { orgId: claims.orgId, userId: claims.sub },
      'leave.request.create',
      'LeaveRequest',
      request.id,
    );
    return mapRequest(request);
  }

  async list(claims: AccessTokenClaims, query: LeaveRequestQuery) {
    const perms = new Set(claims.perms);
    const where: Prisma.LeaveRequestWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.leaveTypeId ? { leaveTypeId: query.leaveTypeId } : {}),
      ...this.scopeWhere(claims, query.scope, perms),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.leaveRequest.findMany({
        where,
        include: INCLUDE,
        orderBy: [{ status: 'asc' }, { startDate: 'desc' }],
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      this.prisma.leaveRequest.count({ where }),
    ]);
    return toPaginated(rows.map(mapRequest), total, query);
  }

  /** Who is off this month — team- or org-scoped. */
  async calendar(claims: AccessTokenClaims, month: string) {
    const perms = new Set(claims.perms);
    const first = toDate(`${month}-01`);
    const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0));
    const scoped =
      perms.has('leave.read') || perms.has('leave.manage')
        ? { organizationId: claims.orgId, deletedAt: null }
        : perms.has('leave.read.team')
          ? { organizationId: claims.orgId, managerId: claims.employeeId ?? '__none__' }
          : { id: claims.employeeId ?? '__none__' };

    const rows = await this.prisma.leaveRequest.findMany({
      where: {
        status: 'APPROVED',
        startDate: { lte: last },
        endDate: { gte: first },
        employee: scoped,
      },
      include: INCLUDE,
      orderBy: { startDate: 'asc' },
    });
    return { month, requests: rows.map(mapRequest) };
  }

  /**
   * Approving books the days against the balance in the same transaction
   * as the status change — a request and its balance can never disagree.
   */
  async decide(
    claims: AccessTokenClaims,
    id: string,
    decision: 'APPROVED' | 'REJECTED',
    input: LeaveDecisionInput,
  ) {
    const request = await this.prisma.leaveRequest.findFirst({
      where: { id, employee: { organizationId: claims.orgId } },
      include: INCLUDE,
    });
    if (!request) throw new NotFoundException('Leave request not found');
    if (request.status !== 'PENDING') {
      throw new BadRequestException('This request has already been decided');
    }

    const perms = new Set(claims.perms);
    const isTeam =
      request.employee.managerId != null && request.employee.managerId === claims.employeeId;
    if (!perms.has('leave.approve') && !(perms.has('leave.approve.team') && isTeam)) {
      throw new ForbiddenException('You cannot act on this request');
    }
    if (request.employeeId === claims.employeeId) {
      throw new ForbiddenException('You cannot approve your own leave');
    }

    const year = await this.balances.yearFor(claims.orgId, dateKeyOf(request.startDate));
    const days = Number(request.days);

    if (decision === 'APPROVED') {
      await this.balances.ensureForEmployee(claims.orgId, request.employeeId, year);
      const balance = await this.prisma.leaveBalance.findUniqueOrThrow({
        where: {
          employeeId_leaveTypeId_year: {
            employeeId: request.employeeId,
            leaveTypeId: request.leaveTypeId,
            year,
          },
        },
      });
      const available = availableDays({
        allocated: Number(balance.allocated),
        carriedOver: Number(balance.carriedOver),
        used: Number(balance.used),
      });
      // Balance may have been consumed by another request since this was filed
      if (days > available) {
        throw new BadRequestException(
          `Only ${available} day(s) remain — this request needs ${days}. Adjust the balance first.`,
        );
      }
      await this.prisma.$transaction([
        this.prisma.leaveRequest.update({
          where: { id },
          data: {
            status: decision,
            approverId: claims.sub,
            actedAt: new Date(),
            approverNote: input.note,
          },
        }),
        this.prisma.leaveBalance.update({
          where: { id: balance.id },
          data: { used: round1(Number(balance.used) + days) },
        }),
      ]);
    } else {
      await this.prisma.leaveRequest.update({
        where: { id },
        data: {
          status: decision,
          approverId: claims.sub,
          actedAt: new Date(),
          approverNote: input.note,
        },
      });
    }

    await auditMutation(
      this.prisma,
      { orgId: claims.orgId, userId: claims.sub },
      `leave.request.${decision.toLowerCase()}`,
      'LeaveRequest',
      id,
    );
    const fresh = await this.prisma.leaveRequest.findUniqueOrThrow({
      where: { id },
      include: INCLUDE,
    });
    return mapRequest(fresh);
  }

  /** Withdrawing approved future leave releases the booked days. */
  async cancel(claims: AccessTokenClaims, id: string) {
    const request = await this.prisma.leaveRequest.findFirst({
      where: { id, employee: { organizationId: claims.orgId } },
      include: INCLUDE,
    });
    if (!request) throw new NotFoundException('Leave request not found');

    const perms = new Set(claims.perms);
    const isOwn = request.employeeId === claims.employeeId;
    const isAdmin = perms.has('leave.manage');
    if (!isOwn && !isAdmin) throw new ForbiddenException('You cannot cancel this request');

    const todayKey = dateKeyOf(new Date());
    const startKey = dateKeyOf(request.startDate);
    if (!isAdmin && !canEmployeeCancel({ status: request.status, startDate: startKey }, todayKey)) {
      throw new BadRequestException(
        request.status === 'APPROVED'
          ? 'Leave that has already started can only be cancelled by HR'
          : 'Only pending or upcoming approved leave can be cancelled',
      );
    }
    if (request.status === 'CANCELLED' || request.status === 'REJECTED') {
      throw new BadRequestException('This request is already closed');
    }

    const writes: Prisma.PrismaPromise<unknown>[] = [
      this.prisma.leaveRequest.update({
        where: { id },
        data: { status: 'CANCELLED', actedAt: new Date() },
      }),
    ];

    // Approved days were booked — give them back
    if (request.status === 'APPROVED') {
      const year = await this.balances.yearFor(claims.orgId, dateKeyOf(request.startDate));
      const balance = await this.prisma.leaveBalance.findUnique({
        where: {
          employeeId_leaveTypeId_year: {
            employeeId: request.employeeId,
            leaveTypeId: request.leaveTypeId,
            year,
          },
        },
      });
      if (balance) {
        writes.push(
          this.prisma.leaveBalance.update({
            where: { id: balance.id },
            data: { used: Math.max(0, round1(Number(balance.used) - Number(request.days))) },
          }),
        );
      }
    }

    await this.prisma.$transaction(writes);
    await auditMutation(
      this.prisma,
      { orgId: claims.orgId, userId: claims.sub },
      'leave.request.cancel',
      'LeaveRequest',
      id,
    );
  }

  private async addUsed(employeeId: string, leaveTypeId: string, year: number, days: number) {
    const balance = await this.prisma.leaveBalance.findUnique({
      where: { employeeId_leaveTypeId_year: { employeeId, leaveTypeId, year } },
    });
    if (!balance) return;
    await this.prisma.leaveBalance.update({
      where: { id: balance.id },
      data: { used: round1(Number(balance.used) + days) },
    });
  }

  private scopeWhere(
    claims: AccessTokenClaims,
    scope: LeaveRequestQuery['scope'],
    perms: Set<string>,
  ): Prisma.LeaveRequestWhereInput {
    if (scope === 'own') return { employeeId: claims.employeeId ?? '__none__' };
    if (scope === 'inbox') {
      return perms.has('leave.approve')
        ? { employee: { organizationId: claims.orgId, deletedAt: null } }
        : {
            employee: { organizationId: claims.orgId, managerId: claims.employeeId ?? '__none__' },
          };
    }
    // scope=all — everything the caller may read
    return perms.has('leave.read')
      ? { employee: { organizationId: claims.orgId, deletedAt: null } }
      : { employee: { organizationId: claims.orgId, managerId: claims.employeeId ?? '__none__' } };
  }
}

export { currentLeaveYear };
