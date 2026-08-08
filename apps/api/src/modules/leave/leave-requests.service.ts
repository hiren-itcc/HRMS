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
import { dateKeyOf, displayDate, toDate } from '../../common/utils/calendar';
import { toPaginated } from '../../common/utils/list-query';
import { PrismaService } from '../../database/prisma.service';
import type { Prisma } from '../../generated/prisma/client';
import { MailService } from '../mail/mail.service';
import { NotificationsService } from '../notifications/notifications.service';
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

/*
 * Deliberately unchanged by the notification work, and it is worth saying why:
 * `mapRequest` forwards `employee` **verbatim**. Anything added here — a
 * `userId`, and certainly a `user.email` — appears on every leave request the
 * API returns, to everybody entitled to read one. The recipient's address is
 * fetched in `announceDecision` instead, which costs one query on a path that
 * already runs several and leaves the wire shape alone.
 */
const INCLUDE = {
  leaveType: { select: { id: true, name: true, code: true } },
  employee: {
    select: { id: true, firstName: true, lastName: true, employeeCode: true, managerId: true },
  },
} as const;

type RequestWithIncludes = Prisma.LeaveRequestGetPayload<{ include: typeof INCLUDE }>;

@Injectable()
export class LeaveRequestsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly balances: LeaveBalancesService,
    private readonly settings: SettingsService,
    private readonly notifications: NotificationsService,
    private readonly mail: MailService,
  ) {}

  /**
   * Tell an approver a request is waiting.
   *
   * By permission rather than by naming the manager: an organization that
   * composes its own approver role in Settings gets these without anybody
   * editing this file, and a request from somebody with no manager still
   * reaches whoever can act on it.
   */
  private async announceSubmission(
    claims: AccessTokenClaims,
    request: RequestWithIncludes,
  ): Promise<void> {
    const who = `${request.employee.firstName} ${request.employee.lastName}`;
    await this.notifications.notifyPermission(
      claims.orgId,
      'leave.approve',
      {
        type: 'leave.submitted',
        title: `${who} requested leave`,
        body: `${request.leaveType.name}, ${displayDate(dateKeyOf(request.startDate))} to ${displayDate(dateKeyOf(request.endDate))} (${Number(request.days)} day(s)).`,
        linkPath: '/leave/approvals',
      },
      // They filed it; they know.
      { except: claims.sub },
    );
  }

  /**
   * Tell somebody what happened to their request — in the app, and by email.
   *
   * The email is the specific `leave_approved` / `leave_rejected` template
   * rather than the generic notification one, because those templates want the
   * leave type, the dates, the day count and the approver's name, and this is
   * the only place all four are in hand. `{ email: false }` on the notify is
   * what stops the same news arriving twice.
   *
   * **Never throws.** Same bargain `notify` itself makes: the decision has
   * already been written and the balance already moved, and neither may be
   * undone because a mail host was unreachable.
   */
  private async announceDecision(
    claims: AccessTokenClaims,
    request: RequestWithIncludes,
    decision: 'APPROVED' | 'REJECTED',
    note: string | null | undefined,
  ): Promise<void> {
    try {
      const approved = decision === 'APPROVED';
      const startKey = dateKeyOf(request.startDate);
      const endKey = dateKeyOf(request.endDate);
      const range = `${displayDate(startKey)} to ${displayDate(endKey)}`;

      // Read here rather than through INCLUDE — see the note on it.
      const [recipient, approver] = await Promise.all([
        this.prisma.employee.findUnique({
          where: { id: request.employeeId },
          select: { user: { select: { id: true, email: true } } },
        }),
        this.prisma.user.findUnique({
          where: { id: claims.sub },
          select: { email: true, employee: { select: { firstName: true, lastName: true } } },
        }),
      ]);

      await this.notifications.notify(
        recipient?.user ? [recipient.user.id] : [],
        {
          type: `leave.${decision.toLowerCase()}`,
          title: approved ? 'Your leave was approved' : 'Your leave was declined',
          body: `${request.leaveType.name}, ${range}.${note ? ` ${note}` : ''}`,
          linkPath: '/leave',
        },
        // Sent below, with the dates and the approver's name in it — which the
        // generic notification template has no way to know.
        { email: false },
      );

      // Somebody with no sign-in — a record created with `createLogin: false`
      // — has nowhere to receive either.
      const to = recipient?.user?.email;
      if (!to) return;

      const approverName = approver?.employee
        ? `${approver.employee.firstName} ${approver.employee.lastName}`
        : (approver?.email ?? 'your approver');

      await this.mail.sendTemplate(
        claims.orgId,
        approved ? 'leave_approved' : 'leave_rejected',
        to,
        {
          firstName: request.employee.firstName,
          leaveType: request.leaveType.name,
          startDate: displayDate(startKey),
          endDate: displayDate(endKey),
          days: Number(request.days),
          approverName,
          approverNote: note ?? '',
        },
      );
    } catch {
      // Swallowed on purpose, and not logged here: `notify` logs its own
      // failure, and the mail transport logs its own. A third line saying the
      // same thing would only make the real one harder to find.
    }
  }

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
    // Organizations that let people go into deficit (advance leave against
    // future accrual) turn this check off in Settings.
    const { leave: leavePolicy } = await this.settings.get(claims.orgId);
    if (days > available && !leavePolicy.allowNegativeBalance) {
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
        leaveYear: year,
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
    // Only when somebody has to act. A type that skips approval is booked
    // already, and an approvals inbox is not where that belongs.
    if (type.requiresApproval) await this.announceSubmission(claims, request);
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

    // Stored, not re-derived: the leave-year policy may have changed since.
    const year = request.leaveYear;
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
    await this.announceDecision(claims, request, decision, input.note);
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
      // Stored, not re-derived: the leave-year policy may have changed since.
      const year = request.leaveYear;
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
