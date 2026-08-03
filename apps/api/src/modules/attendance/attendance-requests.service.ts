import type {
  ApprovalDecisionInput,
  AttendanceRequestCreateInput,
  AttendanceRequestQuery,
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
import { AttendanceService } from './attendance.service';
import { instantFromLocal } from './attendance.util';

/**
 * `date` is a `@db.Date` column, so Prisma hands back a full timestamp. Every
 * consumer treats attendance dates as YYYY-MM-DD keys — the web builds
 * `${date}T00:00:00.000Z` from it — so serialise it the same way leave does
 * (leave.mapper.ts) rather than leaking the timestamp.
 */
function mapRequest<T extends { date: Date }>(row: T) {
  return { ...row, date: dateKeyOf(row.date) };
}

const INCLUDE = {
  employee: {
    select: { id: true, firstName: true, lastName: true, employeeCode: true, managerId: true },
  },
} as const;

@Injectable()
export class AttendanceRequestsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly attendance: AttendanceService,
  ) {}

  /** Employee files a correction for a past/current day. */
  async create(claims: AccessTokenClaims, input: AttendanceRequestCreateInput) {
    if (!claims.employeeId) {
      throw new BadRequestException('No employee record is linked to this account');
    }
    const ctx = await this.attendance.contextFor(claims.employeeId);

    const existing = await this.prisma.attendanceRequest.findFirst({
      where: { employeeId: claims.employeeId, date: toDate(input.date), status: 'PENDING' },
    });
    if (existing) {
      throw new BadRequestException('A correction for this date is already awaiting approval');
    }

    const request = await this.prisma.attendanceRequest.create({
      data: {
        employeeId: claims.employeeId,
        date: toDate(input.date),
        requestedIn: input.requestedIn
          ? instantFromLocal(input.date, input.requestedIn, ctx.timeZone)
          : null,
        requestedOut: input.requestedOut
          ? instantFromLocal(input.date, input.requestedOut, ctx.timeZone)
          : null,
        reason: input.reason,
      },
      include: INCLUDE,
    });
    await auditMutation(
      this.prisma,
      { orgId: claims.orgId, userId: claims.sub },
      'attendance.request.create',
      'AttendanceRequest',
      request.id,
    );
    return mapRequest(request);
  }

  /**
   * `scope=own` → the caller's own requests; `scope=inbox` → requests the
   * caller can act on (direct reports, or org-wide with attendance.approve).
   */
  async list(claims: AccessTokenClaims, query: AttendanceRequestQuery) {
    const where: Prisma.AttendanceRequestWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.scope === 'inbox'
        ? { employee: this.inboxScope(claims) }
        : { employeeId: claims.employeeId ?? '__none__' }),
    };
    const [data, total] = await this.prisma.$transaction([
      this.prisma.attendanceRequest.findMany({
        where,
        include: INCLUDE,
        orderBy: [{ status: 'asc' }, { date: 'desc' }],
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      this.prisma.attendanceRequest.count({ where }),
    ]);
    return toPaginated(data.map(mapRequest), total, query);
  }

  /**
   * Approving writes the corrected times onto the attendance record and
   * recomputes late/half-day — request and record move together or not at
   * all, so an approved request can never disagree with the timesheet.
   */
  async decide(
    claims: AccessTokenClaims,
    id: string,
    decision: 'APPROVED' | 'REJECTED',
    input: ApprovalDecisionInput,
  ) {
    const request = await this.prisma.attendanceRequest.findFirst({
      where: { id, employee: { organizationId: claims.orgId } },
      include: INCLUDE,
    });
    if (!request) throw new NotFoundException('Request not found');
    if (request.status !== 'PENDING') {
      throw new BadRequestException('This request has already been decided');
    }

    const perms = new Set(claims.perms);
    const isTeam =
      request.employee.managerId != null && request.employee.managerId === claims.employeeId;
    if (!perms.has('attendance.approve') && !(perms.has('attendance.approve.team') && isTeam)) {
      throw new ForbiddenException('You cannot act on this request');
    }
    if (request.employeeId === claims.employeeId) {
      throw new ForbiddenException('You cannot approve your own correction');
    }

    const ctx =
      decision === 'APPROVED' ? await this.attendance.contextFor(request.employeeId) : null;

    await this.prisma.$transaction(async (tx) => {
      await tx.attendanceRequest.update({
        where: { id },
        data: {
          status: decision,
          approverId: claims.sub,
          actedAt: new Date(),
          approverNote: input.note,
        },
      });
      if (!ctx) return;

      const record = await tx.attendanceRecord.upsert({
        where: { employeeId_date: { employeeId: request.employeeId, date: request.date } },
        update: {},
        create: {
          organizationId: ctx.organizationId,
          employeeId: request.employeeId,
          date: request.date,
          status: 'PRESENT',
          source: 'ADMIN',
        },
        include: { sessions: { orderBy: { checkIn: 'asc' } } },
      });

      await this.applyToSessions(tx, record.id, record.sessions, request);
      // Rolling up here is what keeps the record and its sessions from ever
      // telling different stories, the same guarantee the transaction gives
      // the request and the record.
      await this.attendance.applyRollUp(
        record.id,
        ctx,
        { source: 'ADMIN', note: request.reason },
        tx,
      );
    });
    await auditMutation(
      this.prisma,
      { orgId: claims.orgId, userId: claims.sub },
      `attendance.request.${decision.toLowerCase()}`,
      'AttendanceRequest',
      id,
    );
    const updated = await this.prisma.attendanceRequest.findUniqueOrThrow({
      where: { id },
      include: INCLUDE,
    });
    return mapRequest(updated);
  }

  /** An employee may withdraw their own pending request. */
  async cancel(claims: AccessTokenClaims, id: string) {
    const request = await this.prisma.attendanceRequest.findFirst({
      where: { id, employeeId: claims.employeeId ?? '__none__' },
    });
    if (!request) throw new NotFoundException('Request not found');
    if (request.status !== 'PENDING') {
      throw new BadRequestException('Only pending requests can be cancelled');
    }
    await this.prisma.attendanceRequest.update({
      where: { id },
      data: { status: 'CANCELLED', actedAt: new Date() },
    });
    await auditMutation(
      this.prisma,
      { orgId: claims.orgId, userId: claims.sub },
      'attendance.request.cancel',
      'AttendanceRequest',
      id,
    );
  }

  /**
   * A correction is written as one in/out pair, so it edits the day's sessions
   * rather than the record's columns — the record is only ever their rollup.
   *
   * Giving both times describes the whole day and replaces it. Giving one moves
   * just that edge, which leaves the middle sittings of a split day alone: "I
   * forgot to clock out after the client visit" should not erase the morning.
   */
  private async applyToSessions(
    tx: Prisma.TransactionClient,
    recordId: string,
    sessions: { id: string }[],
    request: { requestedIn: Date | null; requestedOut: Date | null },
  ) {
    const { requestedIn, requestedOut } = request;

    if (requestedIn && requestedOut) {
      await tx.attendanceSession.deleteMany({ where: { recordId } });
      await tx.attendanceSession.create({
        data: { recordId, checkIn: requestedIn, checkOut: requestedOut, source: 'ADMIN' },
      });
      return;
    }

    const first = sessions[0];
    const last = sessions[sessions.length - 1];

    if (requestedIn) {
      if (first) {
        await tx.attendanceSession.update({
          where: { id: first.id },
          data: { checkIn: requestedIn, source: 'ADMIN' },
        });
      } else {
        await tx.attendanceSession.create({
          data: { recordId, checkIn: requestedIn, source: 'ADMIN' },
        });
      }
      return;
    }

    // Only a clock-out, and nothing to close: there is no arrival to infer, so
    // say so rather than invent one or silently drop the correction.
    if (!last) {
      throw new BadRequestException(
        'That day has no clock-in to correct — the request needs a clock-in time too',
      );
    }
    await tx.attendanceSession.update({
      where: { id: last.id },
      data: { checkOut: requestedOut, source: 'ADMIN' },
    });
  }

  private inboxScope(claims: AccessTokenClaims): Prisma.EmployeeWhereInput {
    const perms = new Set(claims.perms);
    return perms.has('attendance.approve')
      ? { organizationId: claims.orgId, deletedAt: null }
      : { organizationId: claims.orgId, managerId: claims.employeeId ?? '__none__' };
  }
}
