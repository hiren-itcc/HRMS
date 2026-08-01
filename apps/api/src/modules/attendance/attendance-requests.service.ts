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
import {
  instantFromLocal,
  isLateArrival,
  statusForWorkedMinutes,
  workedMinutesBetween,
} from './attendance.util';

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

    const writes: Prisma.PrismaPromise<unknown>[] = [
      this.prisma.attendanceRequest.update({
        where: { id },
        data: {
          status: decision,
          approverId: claims.sub,
          actedAt: new Date(),
          approverNote: input.note,
        },
      }),
    ];

    if (decision === 'APPROVED') {
      const ctx = await this.attendance.contextFor(request.employeeId);
      const existing = await this.prisma.attendanceRecord.findUnique({
        where: {
          employeeId_date: { employeeId: request.employeeId, date: request.date },
        },
      });

      const checkIn = request.requestedIn ?? existing?.checkIn ?? null;
      const checkOut = request.requestedOut ?? existing?.checkOut ?? null;
      const workMinutes = checkIn && checkOut ? workedMinutesBetween(checkIn, checkOut) : null;
      const data = {
        checkIn,
        checkOut,
        workMinutes,
        isLate: checkIn ? isLateArrival(checkIn, ctx.timeZone, ctx.shift) : false,
        status:
          workMinutes !== null
            ? statusForWorkedMinutes(workMinutes, ctx.shift)
            : ('PRESENT' as const),
        source: 'ADMIN' as const,
        note: request.reason,
      };

      writes.push(
        this.prisma.attendanceRecord.upsert({
          where: {
            employeeId_date: { employeeId: request.employeeId, date: request.date },
          },
          update: data,
          create: {
            ...data,
            organizationId: ctx.organizationId,
            employeeId: request.employeeId,
            date: request.date,
          },
        }),
      );
    }

    await this.prisma.$transaction(writes);
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

  private inboxScope(claims: AccessTokenClaims): Prisma.EmployeeWhereInput {
    const perms = new Set(claims.perms);
    return perms.has('attendance.approve')
      ? { organizationId: claims.orgId, deletedAt: null }
      : { organizationId: claims.orgId, managerId: claims.employeeId ?? '__none__' };
  }
}
