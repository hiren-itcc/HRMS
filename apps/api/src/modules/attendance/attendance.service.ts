import type {
  AttendanceDayQuery,
  AttendanceSummaryQuery,
  ClockInInput,
  ClockOutInput,
} from '@hrms/shared';
import type { AccessTokenClaims } from '@hrms/types';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { auditMutation } from '../../common/utils/audit';
import { dateKeyOf, eachDayKey, toDate } from '../../common/utils/calendar';
import { toPaginated } from '../../common/utils/list-query';
import { PrismaService } from '../../database/prisma.service';
import type { Prisma } from '../../generated/prisma/client';
import { SettingsService } from '../settings/settings.service';
import { WfhService } from '../wfh/wfh.service';
import {
  type DerivedStatus,
  dateKeyInTz,
  daysInMonth,
  deriveDayStatus,
  detectPlacement,
  type EmploymentWindow,
  type Fix,
  isLateArrival,
  type PlaceGeofence,
  type Placement,
  rollUpSessions,
  rollUpWorkMode,
  type ShiftLike,
  type VerificationValue,
  type WorkModeValue,
} from './attendance.util';

/** Employee joined with everything the attendance rules need. */
const EMPLOYEE_CONTEXT = {
  shift: { select: { startTime: true, endTime: true, graceMinutes: true } },
  location: { select: { timezone: true } },
  organization: { select: { timezone: true } },
} as const;

/** A day's sessions, oldest first — the order every rollup and screen expects. */
const WITH_SESSIONS = {
  sessions: {
    orderBy: { checkIn: 'asc' },
    include: { location: { select: { name: true } } },
  },
} as const;

/**
 * Clocking out and straight back in is a mis-tap, not a break, so the next
 * clock-in inside this window reopens the session that was just closed instead
 * of leaving a stub on the timeline.
 */
const REOPEN_WINDOW_MS = 2 * 60 * 1000;

/** A backstop against a jammed button — nobody legitimately works 20 sittings. */
const MAX_SESSIONS_PER_DAY = 20;

/**
 * The statuses the rollup owns and may recompute. WFH belongs here now that it
 * is earned from the day's sessions rather than set by hand — leaving it out
 * would trap a day as WFH forever once an all-remote morning had set it, even
 * after the person came into the office in the afternoon. ON_LEAVE, HOLIDAY and
 * the rest stay out: those were set deliberately and must survive a clock-out.
 */
const DERIVED_STATUSES = new Set(['PRESENT', 'HALF_DAY', 'WFH']);

/** How a time got recorded — mirrors the `AttendanceSource` enum. */
export type AttendanceSourceValue = 'WEB' | 'MOBILE' | 'ADMIN' | 'IMPORT';

export interface AttendanceContext {
  employeeId: string;
  organizationId: string;
  timeZone: string;
  shift: ShiftLike | null;
  employment: EmploymentWindow;
}

/** One clock-in/clock-out pair; `checkOut` is null while the person is in. */
export interface DaySession {
  id: string;
  checkIn: string;
  checkOut: string | null;
  /** Worked out from the position, not declared. */
  workMode: WorkModeValue;
  /** How sure the reading was: VERIFIED when conclusive, else UNVERIFIED. */
  verification: VerificationValue;
  /** Metres from the nearest office, when a position was taken and judged. */
  distanceMeters: number | null;
  /** Name of that office, for a message a person can act on. */
  officeName: string | null;
}

export interface DayEntry {
  date: string;
  status: DerivedStatus;
  /** First session's clock-in. */
  checkIn: string | null;
  /** Last session's clock-out — null while any session is still open. */
  checkOut: string | null;
  /** Summed across closed sessions; the running one counts when it ends. */
  workMinutes: number | null;
  isLate: boolean;
  note: string | null;
  /** The day rolled up: all one way, or OFFICE when the sittings were mixed. */
  workMode: WorkModeValue | null;
  /**
   * Whether a remote day was agreed in advance. Null when the question does
   * not arise — an office day has nothing to approve.
   *
   * Derived on read from approved remote-work requests, never stored: an
   * unapproved remote day is recorded exactly as any other, because refusing
   * the punch would lose the record of a day somebody worked.
   */
  remoteApproved: boolean | null;
  sessions: DaySession[];
}

@Injectable()
export class AttendanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    /*
     * One direction only: attendance asks WFH which days were agreed. WFH
     * never asks whether somebody actually worked from home — it is not its
     * business, and not asking keeps a permission out of every clock-in.
     */
    private readonly wfh: WfhService,
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

  // ── where someone worked ──────────────────────────────────────────────

  /** Every place in the org that has actually been put on the map. */
  private async placesOf(orgId: string): Promise<PlaceGeofence[]> {
    const rows = await this.prisma.location.findMany({
      where: { organizationId: orgId, latitude: { not: null }, longitude: { not: null } },
      select: {
        id: true,
        type: true,
        latitude: true,
        longitude: true,
        geofenceRadiusMeters: true,
      },
    });
    return rows.map((r) => ({
      id: r.id,
      type: r.type,
      latitude: r.latitude as number,
      longitude: r.longitude as number,
      geofenceRadiusMeters: r.geofenceRadiusMeters,
    }));
  }

  /**
   * Works out where somebody is working, and decides what to keep of how we
   * found out.
   *
   * The privacy rule survives the move to detection but had to change shape.
   * The mode cannot be known until the position has been measured, so a home
   * position now reaches the server and is thrown away here rather than never
   * being sent. Nothing about somebody's home is stored; something about it is
   * briefly transmitted, which was not true before and is worth being honest
   * about.
   *
   * Nothing here throws. A position that cannot place someone produces an
   * unverified office day, never a failed punch.
   */
  private async resolvePlacement(
    orgId: string,
    input: { latitude?: number; longitude?: number; accuracyMeters?: number },
  ): Promise<{ fix: Fix | null; placement: Placement }> {
    const fix: Fix | null =
      input.latitude !== undefined &&
      input.longitude !== undefined &&
      input.accuracyMeters !== undefined
        ? {
            latitude: input.latitude,
            longitude: input.longitude,
            accuracyMeters: input.accuracyMeters,
          }
        : null;

    const placement = detectPlacement(fix, await this.placesOf(orgId));
    // Measured, used, discarded.
    return { fix: placement.workMode === 'REMOTE' ? null : fix, placement };
  }

  // ── clock in / out ────────────────────────────────────────────────────

  /**
   * Opens a session. A day holds as many as the person works, so clocking out
   * — deliberately at lunch or by accident — never ends the day.
   *
   * Still idempotent where it matters: tapping the button twice without
   * clocking out in between returns the running day unchanged.
   */
  async checkIn(claims: AccessTokenClaims, input: ClockInInput = {}) {
    const ctx = await this.contextFor(this.requireEmployee(claims));
    const now = new Date();
    const dateKey = dateKeyInTz(now, ctx.timeZone);

    const existing = await this.findRecord(ctx.employeeId, dateKey);
    const sessions = existing?.sessions ?? [];

    // Already clocked in — a double tap is not a new sitting.
    if (sessions.some((s) => s.checkOut === null)) {
      return this.toDayEntry(dateKey, existing, dateKey);
    }
    if (sessions.length >= MAX_SESSIONS_PER_DAY) {
      throw new BadRequestException(
        'Too many clock-ins today — raise a correction request instead',
      );
    }

    const record =
      existing ??
      (await this.prisma.attendanceRecord.create({
        data: {
          organizationId: ctx.organizationId,
          employeeId: ctx.employeeId,
          date: toDate(dateKey),
          status: 'PRESENT',
          source: 'WEB',
        },
      }));

    const { fix, placement } = await this.resolvePlacement(ctx.organizationId, input);
    const arrival = {
      workMode: placement.workMode,
      locationId: placement.locationId,
      inLatitude: fix?.latitude ?? null,
      inLongitude: fix?.longitude ?? null,
      inAccuracyMeters: fix ? Math.round(fix.accuracyMeters) : null,
      inVerification: placement.verification,
      inDistanceMeters: placement.distanceMeters,
    };

    const last = sessions[sessions.length - 1];
    const misTap =
      last?.checkOut && now.getTime() - last.checkOut.getTime() <= REOPEN_WINDOW_MS ? last : null;

    if (misTap) {
      // Measured again here and now, so the reopened session takes the fresh
      // placement — keeping the old one would leave a stale position standing.
      await this.prisma.attendanceSession.update({
        where: { id: misTap.id },
        data: {
          checkOut: null,
          outLatitude: null,
          outLongitude: null,
          outAccuracyMeters: null,
          outVerification: 'UNVERIFIED',
          outDistanceMeters: null,
          ...arrival,
        },
      });
    } else {
      await this.prisma.attendanceSession.create({
        data: { recordId: record.id, checkIn: now, source: 'WEB', ...arrival },
      });
    }

    const updated = await this.applyRollUp(record.id, ctx);
    await auditMutation(
      this.prisma,
      { orgId: ctx.organizationId, userId: claims.sub },
      'attendance.check_in',
      'AttendanceRecord',
      record.id,
    );
    return this.toDayEntry(dateKey, updated, dateKey);
  }

  /** Closes the running session. Idempotent: with none open, returns the day as-is. */
  async checkOut(claims: AccessTokenClaims, input: ClockOutInput = {}) {
    const ctx = await this.contextFor(this.requireEmployee(claims));
    const now = new Date();
    const dateKey = dateKeyInTz(now, ctx.timeZone);

    const record = await this.findRecord(ctx.employeeId, dateKey);
    if (!record || record.sessions.length === 0) {
      throw new BadRequestException('Clock in before clocking out');
    }
    const open = record.sessions.find((s) => s.checkOut === null);
    // Already out — repeating the action reports the day, it is not an error.
    if (!open) return this.toDayEntry(dateKey, record, dateKey);

    /*
     * Measured the same way as the arrival, but the session's own workMode is
     * left alone: the arrival defines the sitting, and somebody clocking out
     * from the train home has not retroactively worked from there.
     */
    const { fix, placement } = await this.resolvePlacement(ctx.organizationId, input);
    await this.prisma.attendanceSession.update({
      where: { id: open.id },
      data: {
        checkOut: now,
        outLatitude: fix?.latitude ?? null,
        outLongitude: fix?.longitude ?? null,
        outAccuracyMeters: fix ? Math.round(fix.accuracyMeters) : null,
        outVerification: placement.verification,
        outDistanceMeters: placement.distanceMeters,
      },
    });
    const updated = await this.applyRollUp(record.id, ctx);
    await auditMutation(
      this.prisma,
      { orgId: ctx.organizationId, userId: claims.sub },
      'attendance.check_out',
      'AttendanceRecord',
      record.id,
    );
    return this.toDayEntry(dateKey, updated, dateKey);
  }

  /**
   * Rewrites the day-level columns from its sessions. Every write to a record's
   * times goes through here, so the rollup and the sessions cannot drift apart.
   * Pass `client` to join a transaction the caller already opened.
   */
  async applyRollUp(
    recordId: string,
    ctx: Pick<AttendanceContext, 'shift' | 'timeZone'>,
    fields: { note?: string; source?: AttendanceSourceValue } = {},
    client: Prisma.TransactionClient = this.prisma,
  ) {
    const record = await client.attendanceRecord.findUniqueOrThrow({
      where: { id: recordId },
      include: WITH_SESSIONS,
    });
    const roll = rollUpSessions(record.sessions, ctx.shift);
    const workMode = rollUpWorkMode(record.sessions);
    /*
     * A day worked entirely from home earns WFH — until now the status only
     * ever came from the demo seed. Hours still win over place: a short remote
     * day is a half day, because that is what payroll and the reports mean by
     * it. Reports already count WFH as a working day, so nothing shifts.
     */
    const status =
      workMode === 'REMOTE' && roll.workedStatus === 'PRESENT' ? 'WFH' : roll.workedStatus;

    return client.attendanceRecord.update({
      where: { id: recordId },
      data: {
        checkIn: roll.checkIn,
        checkOut: roll.checkOut,
        workMinutes: roll.workMinutes,
        workMode,
        // The late mark follows the day's first arrival wherever it came from —
        // a later session never changes when someone showed up, and an approved
        // correction to the arrival time does.
        isLate: roll.checkIn ? isLateArrival(roll.checkIn, ctx.timeZone, ctx.shift) : false,
        // An on-leave or holiday day was marked as such deliberately; only the
        // statuses derived from the day's own sessions are recomputed.
        ...(DERIVED_STATUSES.has(record.status) ? { status } : {}),
        ...fields,
      },
      include: WITH_SESSIONS,
    });
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

    // The working week and the holidays are wanted twice — once here and once
    // by the remote-day lookup — so they are fetched first and handed over,
    // rather than each caller paying for them.
    const [holidays, weekOff] = await Promise.all([
      this.holidayKeys(ctx.organizationId, from, to),
      this.weekOffDays(ctx.organizationId),
    ]);

    const [records, leave, remote] = await Promise.all([
      this.prisma.attendanceRecord.findMany({
        where: { employeeId: ctx.employeeId, date: { gte: from, lte: to } },
        include: WITH_SESSIONS,
      }),
      this.leaveKeys([ctx.employeeId], from, to),
      // Derived, never stored. A remote day nobody approved is still recorded
      // exactly as it was — this is the only place that fact is noticed.
      this.wfh.approvedDaysIn(
        ctx.organizationId,
        [ctx.employeeId],
        days[0] as string,
        days[days.length - 1] as string,
        { weekOffDays: weekOff, holidays },
      ),
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
        this.remoteVerdict(byDate.get(dateKey) ?? null, remote, ctx.employeeId, dateKey),
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
      // ONBOARDING as well as EXITED: a hire who has not started would
      // otherwise read as absent to their manager from their join date on,
      // and inflate `notMarked` in today's stats.
      status: { notIn: ['EXITED', 'ONBOARDING'] },
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
          attendance: { where: { date: toDate(dateKey) }, include: WITH_SESSIONS },
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
    const weekOff = await this.weekOffDays(claims.orgId);
    const [leave, remote] = await Promise.all([
      this.leaveKeys(
        employees.map((e) => e.id),
        toDate(dateKey),
        toDate(dateKey),
      ),
      // `isHoliday` above already answered the holiday question for this one
      // day, so the set handed over is simply that answer.
      this.wfh.approvedDaysIn(
        claims.orgId,
        employees.map((e) => e.id),
        dateKey,
        dateKey,
        { weekOffDays: weekOff, holidays: new Set(isHoliday ? [dateKey] : []) },
      ),
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
        this.remoteVerdict(e.attendance[0] ?? null, remote, e.id, dateKey),
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
      // ONBOARDING as well as EXITED: a hire who has not started would
      // otherwise read as absent to their manager from their join date on,
      // and inflate `notMarked` in today's stats.
      status: { notIn: ['EXITED', 'ONBOARDING'] },
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
      // ONBOARDING as well as EXITED: a hire who has not started would
      // otherwise read as absent to their manager from their join date on,
      // and inflate `notMarked` in today's stats.
      status: { notIn: ['EXITED', 'ONBOARDING'] },
      ...(perms.has('attendance.read') ? {} : { managerId: claims.employeeId ?? '__none__' }),
    };

    const [headcount, records, pendingRequests] = await Promise.all([
      this.prisma.employee.count({ where: scope }),
      this.prisma.attendanceRecord.findMany({
        where: { date: toDate(dateKey), employee: scope },
        select: { status: true, isLate: true, checkOut: true, employeeId: true },
      }),
      this.prisma.attendanceRequest.count({
        where: { status: 'PENDING', employee: scope },
      }),
    ]);

    const present = records.filter((r) => r.status === 'PRESENT' || r.status === 'WFH').length;
    const halfDay = records.filter((r) => r.status === 'HALF_DAY').length;

    /*
     * Who is working from home today, and how many of them nobody agreed to.
     *
     * The remote count is a filter over rows already fetched. The unplanned
     * count costs one more query — worth it, because this is where a manager
     * meets the flag: the day view shows it per person, and until now nothing
     * said "one of today's three was not planned" without opening that screen.
     */
    const remoteRecords = records.filter((r) => r.status === 'WFH');
    const approved = await this.wfh.approvedDaysIn(
      claims.orgId,
      remoteRecords.map((r) => r.employeeId),
      dateKey,
      dateKey,
    );

    return {
      date: dateKey,
      headcount,
      present,
      halfDay,
      late: records.filter((r) => r.isLate).length,
      stillIn: records.filter((r) => !r.checkOut).length,
      notMarked: Math.max(0, headcount - records.length),
      pendingRequests,
      remote: remoteRecords.length,
      remoteUnplanned: remoteRecords.filter((r) => !approved.has(`${r.employeeId}|${dateKey}`))
        .length,
    };
  }

  // ── helpers ───────────────────────────────────────────────────────────

  findRecord(employeeId: string, dateKey: string) {
    return this.prisma.attendanceRecord.findUnique({
      where: { employeeId_date: { employeeId, date: toDate(dateKey) } },
      include: WITH_SESSIONS,
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

  /**
   * Was this remote day agreed? Null unless they actually worked remotely —
   * an office day has nothing to approve.
   */
  private remoteVerdict(
    record: { workMode?: WorkModeValue | null } | null,
    approved: Set<string>,
    employeeId: string,
    dateKey: string,
  ): boolean | null {
    if (record?.workMode !== 'REMOTE') return null;
    return approved.has(`${employeeId}|${dateKey}`);
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
      workMode?: WorkModeValue | null;
      /** Absent on the summary path, which never returns the entry to a client. */
      sessions?: {
        id: string;
        checkIn: Date;
        checkOut: Date | null;
        workMode: WorkModeValue;
        inVerification: VerificationValue;
        outVerification: VerificationValue;
        inDistanceMeters: number | null;
        outDistanceMeters: number | null;
        location?: { name: string } | null;
      }[];
    } | null,
    todayKey: string,
    isHoliday = false,
    employment?: EmploymentWindow,
    isOnLeave = false,
    weekOffDays?: number[],
    /**
     * Whether a remote day was agreed in advance. Null when the question does
     * not arise — an office day has nothing to approve, and answering "false"
     * there would read as a refusal rather than as "not applicable".
     */
    remoteApproved: boolean | null = null,
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
      workMode: record?.workMode ?? null,
      remoteApproved,
      sessions: (record?.sessions ?? []).map((s) => ({
        id: s.id,
        checkIn: s.checkIn.toISOString(),
        checkOut: s.checkOut?.toISOString() ?? null,
        workMode: s.workMode,
        // The arrival is what an office claim rests on, so that is the verdict
        // and the distance shown. The clock-out fix is kept but not surfaced.
        verification: s.inVerification,
        distanceMeters: s.inDistanceMeters,
        officeName: s.location?.name ?? null,
      })),
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
