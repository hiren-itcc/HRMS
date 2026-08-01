import type { AttendanceDayQuery, AttendanceSummaryQuery } from '@hrms/shared';
import type { AccessTokenClaims } from '@hrms/types';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { auditMutation } from '../../common/utils/audit';
import { dateKeyOf, eachDayKey, toDate } from '../../common/utils/calendar';
import { toPaginated } from '../../common/utils/list-query';
import { PrismaService } from '../../database/prisma.service';
import type { Prisma } from '../../generated/prisma/client';
import { SettingsService } from '../settings/settings.service';
import {
  type DerivedStatus,
  dateKeyInTz,
  daysInMonth,
  deriveDayStatus,
  type EmploymentWindow,
  isLateArrival,
  type ShiftLike,
  statusForWorkedMinutes,
  workedMinutesBetween,
} from './attendance.util';

/** Employee joined with everything the attendance rules need. */
const EMPLOYEE_CONTEXT = {
  shift: { select: { startTime: true, endTime: true, graceMinutes: true } },
  location: { select: { timezone: true } },
  organization: { select: { timezone: true } },
} as const;

export interface AttendanceContext {
  employeeId: string;
  organizationId: string;
  timeZone: string;
  shift: ShiftLike | null;
  employment: EmploymentWindow;
}

export interface DayEntry {
  date: string;
  status: DerivedStatus;
  checkIn: string | null;
  checkOut: string | null;
  workMinutes: number | null;
  isLate: boolean;
  note: string | null;
}

@Injectable()
export class AttendanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
  ) {}

  /** Org working week — drives which days derive as WEEK_OFF. */
  private async weekOffDays(orgId: string): Promise<number[]> {
    const settings = await this.settings.get(orgId);
    return settings.workingWeek.weekOffDays;
  }

  /** Resolves timezone (location → org) and shift for the rules to use. */
  async contextFor(employeeId: string): Promise<AttendanceContext> {
    const employee = await this.prisma.employee.findFirst({
      where: { id: employeeId, deletedAt: null },
      include: EMPLOYEE_CONTEXT,
    });
    if (!employee) throw new NotFoundException('Employee not found');
    return {
      employeeId: employee.id,
      organizationId: employee.organizationId,
      timeZone: employee.location?.timezone ?? employee.organization.timezone,
      shift: employee.shift,
      employment: {
        joinDate: dateKeyOf(employee.joinDate),
        exitDate: employee.exitDate ? dateKeyOf(employee.exitDate) : null,
      },
    };
  }

  private requireEmployee(claims: AccessTokenClaims): string {
    if (!claims.employeeId) {
      throw new BadRequestException('No employee record is linked to this account');
    }
    return claims.employeeId;
  }

  // ── clock in / out ────────────────────────────────────────────────────

  /** Idempotent: clocking in twice returns the existing record unchanged. */
  async checkIn(claims: AccessTokenClaims) {
    const ctx = await this.contextFor(this.requireEmployee(claims));
    const now = new Date();
    const dateKey = dateKeyInTz(now, ctx.timeZone);

    const existing = await this.findRecord(ctx.employeeId, dateKey);
    if (existing?.checkIn) return this.toDayEntry(dateKey, existing, dateKey);

    const record = await this.prisma.attendanceRecord.upsert({
      where: { employeeId_date: { employeeId: ctx.employeeId, date: toDate(dateKey) } },
      update: { checkIn: now, isLate: isLateArrival(now, ctx.timeZone, ctx.shift) },
      create: {
        organizationId: ctx.organizationId,
        employeeId: ctx.employeeId,
        date: toDate(dateKey),
        checkIn: now,
        isLate: isLateArrival(now, ctx.timeZone, ctx.shift),
        status: 'PRESENT',
        source: 'WEB',
      },
    });
    await auditMutation(
      this.prisma,
      { orgId: ctx.organizationId, userId: claims.sub },
      'attendance.check_in',
      'AttendanceRecord',
      record.id,
    );
    return this.toDayEntry(dateKey, record, dateKey);
  }

  /** Idempotent: clocking out twice returns the finished record unchanged. */
  async checkOut(claims: AccessTokenClaims) {
    const ctx = await this.contextFor(this.requireEmployee(claims));
    const now = new Date();
    const dateKey = dateKeyInTz(now, ctx.timeZone);

    const record = await this.findRecord(ctx.employeeId, dateKey);
    if (!record?.checkIn) throw new BadRequestException('Clock in before clocking out');
    if (record.checkOut) return this.toDayEntry(dateKey, record, dateKey);

    const workMinutes = workedMinutesBetween(record.checkIn, now);
    const updated = await this.prisma.attendanceRecord.update({
      where: { id: record.id },
      data: {
        checkOut: now,
        workMinutes,
        status: statusForWorkedMinutes(workMinutes, ctx.shift),
      },
    });
    await auditMutation(
      this.prisma,
      { orgId: ctx.organizationId, userId: claims.sub },
      'attendance.check_out',
      'AttendanceRecord',
      record.id,
    );
    return this.toDayEntry(dateKey, updated, dateKey);
  }

  /** Live state for the clock card. */
  async today(claims: AccessTokenClaims) {
    const ctx = await this.contextFor(this.requireEmployee(claims));
    const dateKey = dateKeyInTz(new Date(), ctx.timeZone);
    const record = await this.findRecord(ctx.employeeId, dateKey);
    const [isHoliday, weekOff] = await Promise.all([
      this.isHoliday(ctx.organizationId, dateKey),
      this.weekOffDays(ctx.organizationId),
    ]);
    return {
      ...this.toDayEntry(dateKey, record, dateKey, isHoliday, undefined, false, weekOff),
      timeZone: ctx.timeZone,
      shift: ctx.shift,
      serverTime: new Date().toISOString(),
    };
  }

  // ── calendar / history ────────────────────────────────────────────────

  /** One month of derived days for the calendar + history table. */
  async myMonth(claims: AccessTokenClaims, month: string) {
    const ctx = await this.contextFor(this.requireEmployee(claims));
    return this.monthFor(ctx, month);
  }

  async monthForEmployee(claims: AccessTokenClaims, employeeId: string, month: string) {
    const ctx = await this.contextFor(employeeId);
    if (ctx.organizationId !== claims.orgId) throw new NotFoundException('Employee not found');
    return this.monthFor(ctx, month);
  }

  private async monthFor(ctx: AttendanceContext, month: string) {
    const days = daysInMonth(month);
    const from = toDate(days[0] as string);
    const to = toDate(days[days.length - 1] as string);
    const todayKey = dateKeyInTz(new Date(), ctx.timeZone);

    const [records, holidays, leave, weekOff] = await Promise.all([
      this.prisma.attendanceRecord.findMany({
        where: { employeeId: ctx.employeeId, date: { gte: from, lte: to } },
      }),
      this.holidayKeys(ctx.organizationId, from, to),
      this.leaveKeys([ctx.employeeId], from, to),
      this.weekOffDays(ctx.organizationId),
    ]);
    const byDate = new Map(records.map((r) => [dateKeyOf(r.date), r]));

    const entries = days.map((dateKey) =>
      this.toDayEntry(
        dateKey,
        byDate.get(dateKey) ?? null,
        todayKey,
        holidays.has(dateKey),
        ctx.employment,
        leave.has(`${ctx.employeeId}|${dateKey}`),
        weekOff,
      ),
    );
    return { month, timeZone: ctx.timeZone, days: entries, summary: summarize(entries) };
  }

  // ── team / org day view ───────────────────────────────────────────────

  /**
   * Who was in on a given day. Scope follows the RBAC matrix: full
   * `attendance.read` sees the org, otherwise direct reports only.
   */
  async dayView(claims: AccessTokenClaims, query: AttendanceDayQuery) {
    const perms = new Set(claims.perms);
    const orgTz = await this.orgTimeZone(claims.orgId);
    const dateKey = query.date ?? dateKeyInTz(new Date(), orgTz);
    const todayKey = dateKeyInTz(new Date(), orgTz);

    const where: Prisma.EmployeeWhereInput = {
      organizationId: claims.orgId,
      deletedAt: null,
      status: { not: 'EXITED' },
      ...(perms.has('attendance.read') ? {} : { managerId: claims.employeeId ?? '__none__' }),
      ...(query.departmentId ? { departmentId: query.departmentId } : {}),
      ...(query.locationId ? { locationId: query.locationId } : {}),
      ...(query.search
        ? {
            OR: [
              { firstName: { contains: query.search, mode: 'insensitive' as const } },
              { lastName: { contains: query.search, mode: 'insensitive' as const } },
              { employeeCode: { contains: query.search, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    };

    const [employees, total, isHoliday] = await Promise.all([
      this.prisma.employee.findMany({
        where,
        select: {
          id: true,
          firstName: true,
          lastName: true,
          employeeCode: true,
          avatarUrl: true,
          joinDate: true,
          exitDate: true,
          department: { select: { name: true } },
          attendance: { where: { date: toDate(dateKey) } },
        },
        orderBy: { firstName: 'asc' },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      this.prisma.employee.count({ where }),
      this.isHoliday(claims.orgId, dateKey),
    ]);

    // Approved leave must win over "absent" here too — without this an
    // employee on sanctioned leave reads as ABSENT to their manager.
    const [leave, weekOff] = await Promise.all([
      this.leaveKeys(
        employees.map((e) => e.id),
        toDate(dateKey),
        toDate(dateKey),
      ),
      this.weekOffDays(claims.orgId),
    ]);

    const data = employees.map((e) => ({
      employee: {
        id: e.id,
        firstName: e.firstName,
        lastName: e.lastName,
        employeeCode: e.employeeCode,
        avatarUrl: e.avatarUrl,
        department: e.department?.name ?? null,
      },
      ...this.toDayEntry(
        dateKey,
        e.attendance[0] ?? null,
        todayKey,
        isHoliday,
        {
          joinDate: dateKeyOf(e.joinDate),
          exitDate: e.exitDate ? dateKeyOf(e.exitDate) : null,
        },
        leave.has(`${e.id}|${dateKey}`),
        weekOff,
      ),
    }));
    return { date: dateKey, ...toPaginated(data, total, query) };
  }

  /** Monthly totals per employee (HR/manager reporting view). */
  async monthlySummary(claims: AccessTokenClaims, query: AttendanceSummaryQuery) {
    const perms = new Set(claims.perms);
    const days = daysInMonth(query.month);
    const from = toDate(days[0] as string);
    const to = toDate(days[days.length - 1] as string);
    const orgTz = await this.orgTimeZone(claims.orgId);
    const todayKey = dateKeyInTz(new Date(), orgTz);

    const where: Prisma.EmployeeWhereInput = {
      organizationId: claims.orgId,
      deletedAt: null,
      status: { not: 'EXITED' },
      ...(perms.has('attendance.read') ? {} : { managerId: claims.employeeId ?? '__none__' }),
      ...(query.departmentId ? { departmentId: query.departmentId } : {}),
    };

    const [employees, total, holidays] = await Promise.all([
      this.prisma.employee.findMany({
        where,
        select: {
          id: true,
          firstName: true,
          lastName: true,
          employeeCode: true,
          joinDate: true,
          exitDate: true,
          department: { select: { name: true } },
          attendance: { where: { date: { gte: from, lte: to } } },
        },
        orderBy: { firstName: 'asc' },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      this.prisma.employee.count({ where }),
      this.holidayKeys(claims.orgId, from, to),
    ]);

    // Leave days counted as absences would understate attendance and
    // penalise people on sanctioned leave in every report built on this.
    const [leave, weekOff] = await Promise.all([
      this.leaveKeys(
        employees.map((e) => e.id),
        from,
        to,
      ),
      this.weekOffDays(claims.orgId),
    ]);

    const data = employees.map((e) => {
      const byDate = new Map(e.attendance.map((r) => [dateKeyOf(r.date), r]));
      const employment = {
        joinDate: dateKeyOf(e.joinDate),
        exitDate: e.exitDate ? dateKeyOf(e.exitDate) : null,
      };
      const entries = days.map((dateKey) =>
        this.toDayEntry(
          dateKey,
          byDate.get(dateKey) ?? null,
          todayKey,
          holidays.has(dateKey),
          employment,
          leave.has(`${e.id}|${dateKey}`),
          weekOff,
        ),
      );
      return {
        employee: {
          id: e.id,
          firstName: e.firstName,
          lastName: e.lastName,
          employeeCode: e.employeeCode,
          department: e.department?.name ?? null,
        },
        ...summarize(entries),
      };
    });
    return { month: query.month, ...toPaginated(data, total, query) };
  }

  /** Headline numbers for the manager/HR dashboards. */
  async todayStats(claims: AccessTokenClaims) {
    const perms = new Set(claims.perms);
    const orgTz = await this.orgTimeZone(claims.orgId);
    const dateKey = dateKeyInTz(new Date(), orgTz);
    const scope: Prisma.EmployeeWhereInput = {
      organizationId: claims.orgId,
      deletedAt: null,
      status: { not: 'EXITED' },
      ...(perms.has('attendance.read') ? {} : { managerId: claims.employeeId ?? '__none__' }),
    };

    const [headcount, records, pendingRequests] = await Promise.all([
      this.prisma.employee.count({ where: scope }),
      this.prisma.attendanceRecord.findMany({
        where: { date: toDate(dateKey), employee: scope },
        select: { status: true, isLate: true, checkOut: true },
      }),
      this.prisma.attendanceRequest.count({
        where: { status: 'PENDING', employee: scope },
      }),
    ]);

    const present = records.filter((r) => r.status === 'PRESENT' || r.status === 'WFH').length;
    const halfDay = records.filter((r) => r.status === 'HALF_DAY').length;
    return {
      date: dateKey,
      headcount,
      present,
      halfDay,
      late: records.filter((r) => r.isLate).length,
      stillIn: records.filter((r) => !r.checkOut).length,
      notMarked: Math.max(0, headcount - records.length),
      pendingRequests,
    };
  }

  // ── helpers ───────────────────────────────────────────────────────────

  private findRecord(employeeId: string, dateKey: string) {
    return this.prisma.attendanceRecord.findUnique({
      where: { employeeId_date: { employeeId, date: toDate(dateKey) } },
    });
  }

  private async orgTimeZone(orgId: string): Promise<string> {
    const org = await this.prisma.organization.findUniqueOrThrow({
      where: { id: orgId },
      select: { timezone: true },
    });
    return org.timezone;
  }

  private async isHoliday(orgId: string, dateKey: string): Promise<boolean> {
    const count = await this.prisma.holiday.count({
      where: { organizationId: orgId, date: toDate(dateKey) },
    });
    return count > 0;
  }

  /** Days covered by approved leave — makes ON_LEAVE derivable (no writes). */
  private async leaveKeys(employeeIds: string[], from: Date, to: Date): Promise<Set<string>> {
    const requests = await this.prisma.leaveRequest.findMany({
      where: {
        employeeId: { in: employeeIds },
        status: 'APPROVED',
        startDate: { lte: to },
        endDate: { gte: from },
      },
      select: { employeeId: true, startDate: true, endDate: true },
    });
    const keys = new Set<string>();
    for (const r of requests) {
      for (const dateKey of eachDayKey(dateKeyOf(r.startDate), dateKeyOf(r.endDate))) {
        keys.add(`${r.employeeId}|${dateKey}`);
      }
    }
    return keys;
  }

  private async holidayKeys(orgId: string, from: Date, to: Date): Promise<Set<string>> {
    const holidays = await this.prisma.holiday.findMany({
      where: { organizationId: orgId, date: { gte: from, lte: to } },
      select: { date: true },
    });
    return new Set(holidays.map((h) => dateKeyOf(h.date)));
  }

  private toDayEntry(
    dateKey: string,
    record: {
      checkIn: Date | null;
      checkOut: Date | null;
      workMinutes: number | null;
      isLate: boolean;
      status: string;
      note: string | null;
    } | null,
    todayKey: string,
    isHoliday = false,
    employment?: EmploymentWindow,
    isOnLeave = false,
    weekOffDays?: number[],
  ): DayEntry {
    return {
      date: dateKey,
      status: deriveDayStatus({
        dateKey,
        todayKey,
        record,
        isHoliday,
        employment,
        isOnLeave,
        weekOffDays,
      }),
      checkIn: record?.checkIn?.toISOString() ?? null,
      checkOut: record?.checkOut?.toISOString() ?? null,
      workMinutes: record?.workMinutes ?? null,
      isLate: record?.isLate ?? false,
      note: record?.note ?? null,
    };
  }
}

export function summarize(entries: DayEntry[]) {
  const count = (s: DerivedStatus) => entries.filter((e) => e.status === s).length;
  return {
    present: count('PRESENT') + count('WFH'),
    absent: count('ABSENT'),
    halfDay: count('HALF_DAY'),
    onLeave: count('ON_LEAVE'),
    holidays: count('HOLIDAY'),
    weekOffs: count('WEEK_OFF'),
    lateMarks: entries.filter((e) => e.isLate).length,
    workedMinutes: entries.reduce((sum, e) => sum + (e.workMinutes ?? 0), 0),
  };
}
