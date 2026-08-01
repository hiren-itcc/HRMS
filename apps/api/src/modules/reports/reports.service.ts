import type { ReportChart, ReportColumn, ReportRangeQuery, ReportResult } from '@hrms/shared';
import type { AccessTokenClaims } from '@hrms/types';
import { Injectable } from '@nestjs/common';
import { dateKeyOf, eachDayKey, isWeekend, leaveYearOf, toDate } from '../../common/utils/calendar';
import { PrismaService } from '../../database/prisma.service';
import type { Prisma } from '../../generated/prisma/client';
import { dateKeyInTz, deriveDayStatus } from '../attendance/attendance.util';
import { toNumber } from '../leave/leave.mapper';
import { round1 } from '../leave/leave.util';
import { SettingsService } from '../settings/settings.service';
import {
  attritionRate,
  monthKeyOf,
  monthKeysBetween,
  percentage,
  TENURE_BUCKETS,
  tenureBucket,
  tenureMonths,
} from './reports.util';

/**
 * A report never pages: charts computed from a page would be silently wrong.
 * The range cap (366 days) bounds the work; this bounds the org size.
 */
const MAX_ROSTER = 5000;

interface ReportScope {
  from: string;
  to: string;
  fromDate: Date;
  toDate: Date;
  isOrgWide: boolean;
  where: Prisma.EmployeeWhereInput;
}

interface RosterRow {
  id: string;
  firstName: string;
  lastName: string;
  employeeCode: string;
  status: string;
  gender: string | null;
  joinDate: string;
  exitDate: string | null;
  departmentId: string | null;
  departmentName: string;
  designationTitle: string;
  employmentTypeName: string;
  locationName: string;
}

@Injectable()
export class ReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
  ) {}

  /** Org working week — the same policy attendance and leave derive from. */
  private async weekOffDays(orgId: string): Promise<number[]> {
    const settings = await this.settings.get(orgId);
    return settings.workingWeek.weekOffDays;
  }

  // ── shared substrate ──────────────────────────────────────────────────

  /**
   * Every report is a fold over (scoped roster × facts in a range), so the
   * scope is resolved once here rather than hand-rolled four times — four
   * copies of the `'__none__'` sentinel is four chances to leak data.
   */
  private resolveScope(claims: AccessTokenClaims, query: ReportRangeQuery): ReportScope {
    const isOrgWide = new Set(claims.perms).has('report.view');
    return {
      from: query.from,
      to: query.to,
      fromDate: toDate(query.from),
      toDate: toDate(query.to),
      isOrgWide,
      where: {
        organizationId: claims.orgId,
        deletedAt: null,
        ...(isOrgWide ? {} : { managerId: claims.employeeId ?? '__none__' }),
        ...(query.departmentId ? { departmentId: query.departmentId } : {}),
        // Anyone employed for *any part* of the range belongs in it. Filtering
        // on `status != EXITED` here would erase exactly the people an
        // attrition or historical attendance report exists to show.
        AND: [
          { joinDate: { lte: toDate(query.to) } },
          { OR: [{ exitDate: null }, { exitDate: { gte: toDate(query.from) } }] },
        ],
      },
    };
  }

  private async roster(scope: ReportScope): Promise<RosterRow[]> {
    const rows = await this.prisma.employee.findMany({
      where: scope.where,
      select: {
        id: true,
        firstName: true,
        lastName: true,
        employeeCode: true,
        status: true,
        gender: true,
        joinDate: true,
        exitDate: true,
        departmentId: true,
        department: { select: { name: true } },
        designation: { select: { title: true } },
        employmentType: { select: { name: true } },
        location: { select: { name: true } },
      },
      orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
      take: MAX_ROSTER,
    });
    return rows.map((e) => ({
      id: e.id,
      firstName: e.firstName,
      lastName: e.lastName,
      employeeCode: e.employeeCode,
      status: e.status,
      gender: e.gender,
      joinDate: dateKeyOf(e.joinDate),
      exitDate: e.exitDate ? dateKeyOf(e.exitDate) : null,
      departmentId: e.departmentId,
      departmentName: e.department?.name ?? 'Unassigned',
      designationTitle: e.designation?.title ?? '—',
      employmentTypeName: e.employmentType?.name ?? '—',
      locationName: e.location?.name ?? '—',
    }));
  }

  /**
   * "Today" must be the organisation's today, not the server's. In UTC+X an
   * evening request would roll the date forward and mark everyone who has not
   * clocked in yet ABSENT instead of NOT_MARKED.
   */
  private async orgTodayKey(orgId: string): Promise<string> {
    const org = await this.prisma.organization.findUniqueOrThrow({
      where: { id: orgId },
      select: { timezone: true },
    });
    return dateKeyInTz(new Date(), org.timezone);
  }

  private async holidayKeys(orgId: string, from: Date, to: Date): Promise<Set<string>> {
    const holidays = await this.prisma.holiday.findMany({
      where: { organizationId: orgId, date: { gte: from, lte: to } },
      select: { date: true },
    });
    return new Set(holidays.map((h) => dateKeyOf(h.date)));
  }

  /** Days covered by approved leave, keyed `${employeeId}|${dateKey}`. */
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
      for (const key of eachDayKey(dateKeyOf(r.startDate), dateKeyOf(r.endDate))) {
        keys.add(`${r.employeeId}|${key}`);
      }
    }
    return keys;
  }

  private meta(scope: ReportScope, title: string, roster: RosterRow[]): ReportResult['meta'] {
    return {
      title,
      from: scope.from,
      to: scope.to,
      generatedAt: new Date().toISOString(),
      scope: scope.isOrgWide ? 'org' : 'team',
      // Silence here would read as "this is everyone" when it is not.
      ...(roster.length >= MAX_ROSTER ? { truncated: true } : {}),
    };
  }

  // ── employee report ───────────────────────────────────────────────────

  async employees(claims: AccessTokenClaims, query: ReportRangeQuery): Promise<ReportResult> {
    const scope = this.resolveScope(claims, query);
    const [roster, todayKey] = await Promise.all([
      this.roster(scope),
      this.orgTodayKey(claims.orgId),
    ]);
    // Tenure is "so far", so a range ending in the future must not age people
    // up — a default preset runs to the end of the current month.
    const asOf = toDate(scope.to < todayKey ? scope.to : todayKey);

    const employedOn = (dateKey: string) =>
      roster.filter((e) => e.joinDate <= dateKey && (!e.exitDate || e.exitDate >= dateKey)).length;
    const inRange = (dateKey: string) => dateKey >= scope.from && dateKey <= scope.to;

    const months = monthKeysBetween(scope.from, scope.to);
    const trend = months.map((month, i) => {
      // Compared as a string, never parsed — "-31" sorts after every real day
      // of that month, so it means "as of month end" for February too. The
      // final bucket stops at `to` so the line's last point and the headcount
      // KPI are the same number.
      const monthEnd = i === months.length - 1 ? scope.to : `${month}-31`;
      return {
        month,
        headcount: employedOn(monthEnd),
        // Clamped to the range, not the calendar month: the roster covers
        // anyone employed for *part* of the range, so an unclamped month
        // bucket would count a join that happened before `from`.
        joiners: roster.filter(
          (e) => monthKeyOf(toDate(e.joinDate)) === month && inRange(e.joinDate),
        ).length,
        leavers: roster.filter(
          (e) => e.exitDate && monthKeyOf(toDate(e.exitDate)) === month && inRange(e.exitDate),
        ).length,
      };
    });

    const exits = roster.filter((e) => e.exitDate && inRange(e.exitDate)).length;
    const active = employedOn(scope.to);

    const byDepartment = countBy(roster, (e) => e.departmentName);
    const byType = countBy(roster, (e) => e.employmentTypeName);
    const tenure = TENURE_BUCKETS.map((b) => ({
      bucket: b.label,
      employees: roster.filter(
        (e) => tenureBucket(tenureMonths(toDate(e.joinDate), asOf)) === b.label,
      ).length,
    }));

    const charts: ReportChart[] = [
      {
        id: 'movement',
        title: 'Joiners vs leavers',
        kind: 'bar',
        xKey: 'month',
        series: [
          { key: 'joiners', label: 'Joiners' },
          { key: 'leavers', label: 'Leavers' },
        ],
        data: trend.map((t) => ({ month: t.month, joiners: t.joiners, leavers: t.leavers })),
      },
      {
        id: 'headcount',
        title: 'Headcount over time',
        kind: 'line',
        xKey: 'month',
        series: [{ key: 'headcount', label: 'Headcount' }],
        data: trend.map((t) => ({ month: t.month, headcount: t.headcount })),
      },
      {
        id: 'tenure',
        title: 'Tenure distribution',
        kind: 'bar',
        xKey: 'bucket',
        series: [{ key: 'employees', label: 'Employees' }],
        data: tenure,
      },
      {
        id: 'department',
        title: 'Headcount by department',
        kind: 'horizontalBar',
        xKey: 'department',
        series: [{ key: 'employees', label: 'Employees' }],
        data: byDepartment.map(([department, employees]) => ({ department, employees })),
      },
    ];

    const columns: ReportColumn[] = [
      { key: 'employeeCode', header: 'Code' },
      { key: 'name', header: 'Name' },
      { key: 'department', header: 'Department' },
      { key: 'designation', header: 'Designation' },
      { key: 'employmentType', header: 'Employment type' },
      { key: 'location', header: 'Location' },
      { key: 'status', header: 'Status' },
      { key: 'joinDate', header: 'Joined', type: 'date' },
      { key: 'exitDate', header: 'Exited', type: 'date' },
      { key: 'tenureMonths', header: 'Tenure (months)', type: 'number' },
    ];

    return {
      meta: this.meta(scope, 'Employee report', roster),
      kpis: [
        { key: 'headcount', label: 'Headcount at period end', value: active },
        { key: 'joiners', label: 'Joined in range', value: countJoiners(roster, scope) },
        { key: 'leavers', label: 'Exited in range', value: exits },
        {
          key: 'attrition',
          label: 'Attrition',
          value: attritionRate(exits, employedOn(scope.from), employedOn(scope.to)),
          unit: 'percent',
        },
        { key: 'types', label: 'Employment types', value: byType.length },
      ],
      charts,
      rows: roster.map((e) => ({
        employeeCode: e.employeeCode,
        name: `${e.firstName} ${e.lastName}`,
        department: e.departmentName,
        designation: e.designationTitle,
        employmentType: e.employmentTypeName,
        location: e.locationName,
        status: e.status,
        joinDate: e.joinDate,
        exitDate: e.exitDate,
        tenureMonths: tenureMonths(toDate(e.joinDate), asOf),
      })),
      columns,
    };
  }

  // ── attendance report ─────────────────────────────────────────────────

  async attendance(claims: AccessTokenClaims, query: ReportRangeQuery): Promise<ReportResult> {
    const scope = this.resolveScope(claims, query);
    const [roster, todayKey, weekOff] = await Promise.all([
      this.roster(scope),
      this.orgTodayKey(claims.orgId),
      this.weekOffDays(claims.orgId),
    ]);
    const ids = roster.map((e) => e.id);
    const days = eachDayKey(scope.from, scope.to);

    const [records, holidays, leave] = await Promise.all([
      this.prisma.attendanceRecord.findMany({
        where: { employeeId: { in: ids }, date: { gte: scope.fromDate, lte: scope.toDate } },
        select: {
          employeeId: true,
          date: true,
          status: true,
          isLate: true,
          workMinutes: true,
          checkIn: true,
          checkOut: true,
        },
      }),
      this.holidayKeys(claims.orgId, scope.fromDate, scope.toDate),
      this.leaveKeys(ids, scope.fromDate, scope.toDate),
    ]);

    const byEmployeeDay = new Map(
      records.map((r) => [`${r.employeeId}|${dateKeyOf(r.date)}`, r] as const),
    );

    // Per-day org totals for the trend chart, accumulated in the same pass
    // that derives each employee's row — the two must never disagree.
    const daily = new Map<
      string,
      { date: string; present: number; absent: number; onLeave: number; late: number }
    >(days.map((d) => [d, { date: d, present: 0, absent: 0, onLeave: 0, late: 0 }]));

    const rows = roster.map((e) => {
      const totals = { present: 0, absent: 0, halfDay: 0, onLeave: 0, late: 0, minutes: 0 };
      let workingDays = 0;
      for (const dateKey of days) {
        const record = byEmployeeDay.get(`${e.id}|${dateKey}`) ?? null;
        const status = deriveDayStatus({
          dateKey,
          todayKey,
          record,
          isHoliday: holidays.has(dateKey),
          employment: { joinDate: e.joinDate, exitDate: e.exitDate },
          isOnLeave: leave.has(`${e.id}|${dateKey}`),
          weekOffDays: weekOff,
        });
        const bucket = daily.get(dateKey);
        if (status === 'PRESENT' || status === 'WFH') {
          totals.present += 1;
          workingDays += 1;
          if (bucket) bucket.present += 1;
        } else if (status === 'HALF_DAY') {
          totals.halfDay += 1;
          workingDays += 1;
          if (bucket) bucket.present += 1;
        } else if (status === 'ABSENT') {
          totals.absent += 1;
          workingDays += 1;
          if (bucket) bucket.absent += 1;
        } else if (status === 'ON_LEAVE') {
          // Sanctioned leave stays out of the denominator. Counting it would
          // score someone on 20 days of approved leave in a 22-day month at
          // ~9%, which is the very penalty the ON_LEAVE derivation exists to
          // prevent. Leave utilisation is the leave report's job.
          totals.onLeave += 1;
          if (bucket) bucket.onLeave += 1;
        }
        if (record?.isLate) {
          totals.late += 1;
          if (bucket) bucket.late += 1;
        }
        totals.minutes += record?.workMinutes ?? 0;
      }
      return {
        employeeId: e.id,
        departmentName: e.departmentName,
        row: {
          employeeCode: e.employeeCode,
          name: `${e.firstName} ${e.lastName}`,
          department: e.departmentName,
          present: totals.present,
          halfDay: totals.halfDay,
          absent: totals.absent,
          onLeave: totals.onLeave,
          late: totals.late,
          hours: Math.round(totals.minutes / 6) / 10,
          attendanceRate: percentage(totals.present + totals.halfDay * 0.5, workingDays),
        },
      };
    });

    const totalPresent = sum(rows.map((r) => r.row.present));
    const totalAbsent = sum(rows.map((r) => r.row.absent));
    const totalHalf = sum(rows.map((r) => r.row.halfDay));

    const byDept = groupNumeric(
      rows,
      (r) => r.departmentName,
      (r) => ({
        present: r.row.present + r.row.halfDay * 0.5,
        working: r.row.present + r.row.halfDay + r.row.absent,
      }),
    );

    const charts: ReportChart[] = [
      {
        id: 'daily',
        title: 'Daily attendance',
        kind: 'stackedBar',
        xKey: 'date',
        series: [
          { key: 'present', label: 'Present' },
          { key: 'onLeave', label: 'On leave' },
          { key: 'absent', label: 'Absent' },
        ],
        data: [...daily.values()].map((d) => ({
          date: d.date,
          present: d.present,
          onLeave: d.onLeave,
          absent: d.absent,
        })),
      },
      {
        id: 'late',
        title: 'Late marks per day',
        kind: 'line',
        xKey: 'date',
        series: [{ key: 'late', label: 'Late marks' }],
        data: [...daily.values()].map((d) => ({ date: d.date, late: d.late })),
      },
      {
        id: 'rate-by-department',
        title: 'Attendance rate by department',
        kind: 'horizontalBar',
        xKey: 'department',
        series: [{ key: 'rate', label: 'Attendance rate %' }],
        data: byDept.map(([department, v]) => ({
          department,
          rate: percentage(v.present, v.working),
        })),
      },
    ];

    return {
      meta: this.meta(scope, 'Attendance report', roster),
      kpis: [
        {
          key: 'rate',
          label: 'Attendance rate',
          value: percentage(totalPresent + totalHalf * 0.5, totalPresent + totalHalf + totalAbsent),
          unit: 'percent',
        },
        { key: 'present', label: 'Present days', value: totalPresent },
        { key: 'absent', label: 'Absent days', value: totalAbsent },
        { key: 'late', label: 'Late marks', value: sum(rows.map((r) => r.row.late)) },
        {
          key: 'hours',
          label: 'Hours worked',
          // Summing one-decimal floats drifts (8.1 + 8.2 = 16.299999999999997),
          // and this value is rendered straight onto the card.
          value: round1(sum(rows.map((r) => r.row.hours))),
          unit: 'hours',
        },
      ],
      charts,
      columns: [
        { key: 'employeeCode', header: 'Code' },
        { key: 'name', header: 'Name' },
        { key: 'department', header: 'Department' },
        { key: 'present', header: 'Present', type: 'number' },
        { key: 'halfDay', header: 'Half day', type: 'number' },
        { key: 'absent', header: 'Absent', type: 'number' },
        { key: 'onLeave', header: 'On leave', type: 'number' },
        { key: 'late', header: 'Late', type: 'number' },
        { key: 'hours', header: 'Hours', type: 'number' },
        { key: 'attendanceRate', header: 'Rate %', type: 'number' },
      ],
      rows: rows.map((r) => r.row),
    };
  }

  // ── leave report ──────────────────────────────────────────────────────

  async leave(claims: AccessTokenClaims, query: ReportRangeQuery): Promise<ReportResult> {
    const scope = this.resolveScope(claims, query);
    const roster = await this.roster(scope);
    const ids = roster.map((e) => e.id);
    const byId = new Map(roster.map((e) => [e.id, e]));
    // The leave year the org actually runs on — bookings use the same rule, so
    // reading the calendar year here would show a different year's entitlement
    // beside days taken from real requests.
    const { leave: leavePolicy, workingWeek } = await this.settings.get(claims.orgId);
    const year = leaveYearOf(scope.to, leavePolicy.yearStartMonth);

    const [requests, holidays, balances] = await Promise.all([
      this.prisma.leaveRequest.findMany({
        where: {
          employeeId: { in: ids },
          startDate: { lte: scope.toDate },
          endDate: { gte: scope.fromDate },
        },
        select: {
          employeeId: true,
          status: true,
          startDate: true,
          endDate: true,
          halfDaySide: true,
          leaveType: { select: { id: true, name: true } },
        },
      }),
      this.holidayKeys(claims.orgId, scope.fromDate, scope.toDate),
      this.prisma.leaveBalance.groupBy({
        by: ['leaveTypeId'],
        where: { year, employee: scope.where },
        _sum: { allocated: true, used: true, carriedOver: true },
      }),
    ]);
    const weekOff = workingWeek.weekOffDays;

    const leaveTypes = await this.prisma.leaveType.findMany({
      where: { organizationId: claims.orgId },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    });
    const typeName = new Map(leaveTypes.map((t) => [t.id, t.name]));

    // Days are counted by expanding each request into the days that actually
    // fall inside the range. Summing the stored `days` column instead would
    // credit a request spanning the boundary to both halves of the year.
    const perEmployee = new Map<string, number>();
    const perType = new Map<string, number>();
    const perDepartment = new Map<string, number>();
    const perMonth = new Map<string, number>();
    const statusMix = new Map<string, number>();

    for (const r of requests) {
      statusMix.set(r.status, (statusMix.get(r.status) ?? 0) + 1);
      if (r.status !== 'APPROVED') continue;
      const employee = byId.get(r.employeeId);
      const covered = eachDayKey(dateKeyOf(r.startDate), dateKeyOf(r.endDate)).filter(
        (d) => d >= scope.from && d <= scope.to && !isWeekend(d, weekOff) && !holidays.has(d),
      );
      // A half day is only a half day when the whole request is that one day.
      const total =
        r.halfDaySide && covered.length === 1 && dateKeyOf(r.startDate) === dateKeyOf(r.endDate)
          ? 0.5
          : covered.length;
      if (total === 0) continue;
      perEmployee.set(r.employeeId, (perEmployee.get(r.employeeId) ?? 0) + total);
      perType.set(r.leaveType.name, (perType.get(r.leaveType.name) ?? 0) + total);
      if (employee) {
        perDepartment.set(
          employee.departmentName,
          (perDepartment.get(employee.departmentName) ?? 0) + total,
        );
      }
      for (const d of covered) {
        const month = d.slice(0, 7);
        perMonth.set(month, (perMonth.get(month) ?? 0) + (total === 0.5 ? 0.5 : 1));
      }
    }

    const balanceRows = balances.map((b) => {
      const allocated = toNumber(b._sum.allocated) + toNumber(b._sum.carriedOver);
      const used = toNumber(b._sum.used);
      return {
        leaveType: typeName.get(b.leaveTypeId) ?? 'Unknown',
        allocated,
        used,
        remaining: round1(allocated - used),
      };
    });

    const charts: ReportChart[] = [
      {
        id: 'entitlement',
        title: `Allocated vs used (${year})`,
        kind: 'bar',
        xKey: 'leaveType',
        series: [
          { key: 'used', label: 'Used' },
          { key: 'remaining', label: 'Remaining' },
        ],
        data: balanceRows.map((b) => ({
          leaveType: b.leaveType,
          used: b.used,
          remaining: Math.max(0, b.remaining),
        })),
      },
      {
        id: 'by-type',
        title: 'Days taken by type',
        kind: 'horizontalBar',
        xKey: 'leaveType',
        series: [{ key: 'days', label: 'Days' }],
        data: [...perType.entries()].map(([leaveType, days]) => ({ leaveType, days })),
      },
      {
        id: 'by-month',
        title: 'Days taken per month',
        kind: 'line',
        xKey: 'month',
        series: [{ key: 'days', label: 'Days' }],
        data: monthKeysBetween(scope.from, scope.to).map((month) => ({
          month,
          days: perMonth.get(month) ?? 0,
        })),
      },
      {
        id: 'by-department',
        title: 'Days taken by department',
        kind: 'horizontalBar',
        xKey: 'department',
        series: [{ key: 'days', label: 'Days' }],
        data: [...perDepartment.entries()].map(([department, days]) => ({ department, days })),
      },
    ];

    return {
      meta: this.meta(scope, 'Leave report', roster),
      kpis: [
        {
          key: 'days',
          label: 'Days taken',
          value: round1(sum([...perEmployee.values()])),
          unit: 'days',
        },
        { key: 'requests', label: 'Requests raised', value: requests.length },
        { key: 'pending', label: 'Pending approval', value: statusMix.get('PENDING') ?? 0 },
        {
          key: 'takers',
          label: 'Employees on leave',
          value: perEmployee.size,
        },
        {
          key: 'utilisation',
          label: 'Entitlement used',
          value: percentage(
            sum(balanceRows.map((b) => b.used)),
            sum(balanceRows.map((b) => b.allocated)),
          ),
          unit: 'percent',
        },
      ],
      charts,
      columns: [
        { key: 'employeeCode', header: 'Code' },
        { key: 'name', header: 'Name' },
        { key: 'department', header: 'Department' },
        { key: 'daysTaken', header: 'Days taken', type: 'number' },
      ],
      rows: roster.map((e) => ({
        employeeCode: e.employeeCode,
        name: `${e.firstName} ${e.lastName}`,
        department: e.departmentName,
        daysTaken: round1(perEmployee.get(e.id) ?? 0),
      })),
    };
  }

  // ── department report ─────────────────────────────────────────────────

  async departments(claims: AccessTokenClaims, query: ReportRangeQuery): Promise<ReportResult> {
    const scope = this.resolveScope(claims, query);
    // Folding the other two reports rather than re-querying costs an extra
    // roster read, and buys the guarantee that a department's attendance rate
    // here can never disagree with the same figure on the attendance tab.
    const [attendance, leave, allDepartments] = await Promise.all([
      this.attendance(claims, query),
      this.leave(claims, query),
      this.prisma.department.findMany({
        where: { organizationId: claims.orgId },
        select: { id: true, name: true, head: { select: { firstName: true, lastName: true } } },
        orderBy: { name: 'asc' },
      }),
    ]);
    const roster = await this.roster(scope);

    const attendanceByDept = new Map<string, { present: number; working: number; late: number }>();
    for (const row of attendance.rows) {
      const key = String(row.department ?? 'Unassigned');
      const acc = attendanceByDept.get(key) ?? { present: 0, working: 0, late: 0 };
      acc.present += Number(row.present ?? 0) + Number(row.halfDay ?? 0) * 0.5;
      // Approved leave is out of the denominator here too, matching the
      // attendance report exactly.
      acc.working += Number(row.present ?? 0) + Number(row.halfDay ?? 0) + Number(row.absent ?? 0);
      acc.late += Number(row.late ?? 0);
      attendanceByDept.set(key, acc);
    }

    const leaveByDept = new Map<string, number>();
    for (const row of leave.rows) {
      const key = String(row.department ?? 'Unassigned');
      leaveByDept.set(key, (leaveByDept.get(key) ?? 0) + Number(row.daysTaken ?? 0));
    }

    // Org-wide readers get a row per department, including empty ones — a bar
    // chart with silently missing bars reads as "no such department", not
    // "zero". A team-scoped manager gets only the departments their reports
    // are in: the full org list (with each department's head) is data their
    // permissions do not otherwise reach.
    const inScopeNames = new Set(roster.map((e) => e.departmentName));
    const names = scope.isOrgWide
      ? new Set([...allDepartments.map((d) => d.name), ...inScopeNames])
      : inScopeNames;
    const headByName = new Map(
      allDepartments.map((d) => [d.name, d.head ? `${d.head.firstName} ${d.head.lastName}` : '—']),
    );

    const rows = [...names]
      .sort((a, b) => a.localeCompare(b))
      .map((name) => {
        const people = roster.filter((e) => e.departmentName === name);
        const exits = people.filter(
          (e) => e.exitDate && e.exitDate >= scope.from && e.exitDate <= scope.to,
        ).length;
        const joiners = people.filter(
          (e) => e.joinDate >= scope.from && e.joinDate <= scope.to,
        ).length;
        const att = attendanceByDept.get(name);
        const employedOn = (dateKey: string) =>
          people.filter((e) => e.joinDate <= dateKey && (!e.exitDate || e.exitDate >= dateKey))
            .length;
        return {
          department: name,
          head: headByName.get(name) ?? '—',
          headcount: employedOn(scope.to),
          joiners,
          leavers: exits,
          // Same start/end headcounts the employee report uses; estimating the
          // start as "current + exits" ignores joiners and disagrees with it.
          attrition: attritionRate(exits, employedOn(scope.from), employedOn(scope.to)),
          attendanceRate: att ? percentage(att.present, att.working) : 0,
          lateMarks: att?.late ?? 0,
          leaveDays: round1(leaveByDept.get(name) ?? 0),
        };
      });

    // Averaged over departments that actually have people — dividing by every
    // department in the org drags the figure toward zero and contradicts the
    // same number on the attendance tab.
    const staffed = rows.filter((r) => r.headcount > 0);

    return {
      meta: this.meta(scope, 'Department report', roster),
      kpis: [
        { key: 'departments', label: 'Departments with staff', value: staffed.length },
        { key: 'headcount', label: 'Total headcount', value: sum(rows.map((r) => r.headcount)) },
        {
          key: 'largest',
          label: 'Largest department',
          value: Math.max(0, ...rows.map((r) => r.headcount)),
        },
        {
          key: 'rate',
          label: 'Average attendance',
          value: staffed.length
            ? round1(sum(staffed.map((r) => r.attendanceRate)) / staffed.length)
            : 0,
          unit: 'percent',
        },
      ],
      charts: [
        {
          id: 'headcount',
          title: 'Headcount by department',
          kind: 'horizontalBar',
          xKey: 'department',
          series: [{ key: 'headcount', label: 'Employees' }],
          data: rows.map((r) => ({ department: r.department, headcount: r.headcount })),
        },
        {
          id: 'movement',
          title: 'Joiners vs leavers by department',
          kind: 'bar',
          xKey: 'department',
          series: [
            { key: 'joiners', label: 'Joiners' },
            { key: 'leavers', label: 'Leavers' },
          ],
          data: rows.map((r) => ({
            department: r.department,
            joiners: r.joiners,
            leavers: r.leavers,
          })),
        },
        {
          id: 'attendance',
          title: 'Attendance rate by department',
          kind: 'horizontalBar',
          xKey: 'department',
          series: [{ key: 'attendanceRate', label: 'Attendance rate %' }],
          data: rows.map((r) => ({ department: r.department, attendanceRate: r.attendanceRate })),
        },
        {
          id: 'leave',
          title: 'Leave days by department',
          kind: 'horizontalBar',
          xKey: 'department',
          series: [{ key: 'leaveDays', label: 'Leave days' }],
          data: rows.map((r) => ({ department: r.department, leaveDays: r.leaveDays })),
        },
      ],
      columns: [
        { key: 'department', header: 'Department' },
        { key: 'head', header: 'Head' },
        { key: 'headcount', header: 'Headcount', type: 'number' },
        { key: 'joiners', header: 'Joiners', type: 'number' },
        { key: 'leavers', header: 'Leavers', type: 'number' },
        { key: 'attrition', header: 'Attrition %', type: 'number' },
        { key: 'attendanceRate', header: 'Attendance %', type: 'number' },
        { key: 'lateMarks', header: 'Late marks', type: 'number' },
        { key: 'leaveDays', header: 'Leave days', type: 'number' },
      ],
      rows,
    };
  }

  // ── dashboard summary ─────────────────────────────────────────────────

  /** Small payload for the dashboard widget — 6 months of movement only. */
  async summary(claims: AccessTokenClaims) {
    const to = dateKeyOf(new Date());
    const from = `${monthKeyOf(new Date(Date.UTC(Number(to.slice(0, 4)), Number(to.slice(5, 7)) - 6, 1)))}-01`;
    const scope = this.resolveScope(claims, { from, to, format: 'json' });
    const roster = await this.roster(scope);

    const data = monthKeysBetween(from, to).map((month) => ({
      month,
      headcount: roster.filter(
        (e) => e.joinDate <= `${month}-31` && (!e.exitDate || e.exitDate >= `${month}-31`),
      ).length,
      joiners: roster.filter((e) => monthKeyOf(toDate(e.joinDate)) === month).length,
      leavers: roster.filter((e) => e.exitDate && monthKeyOf(toDate(e.exitDate)) === month).length,
    }));

    return { from, to, data };
  }
}

// ── tiny local helpers (used ≥ 2× here, nowhere else) ───────────────────

function sum(values: number[]): number {
  return values.reduce((a, b) => a + b, 0);
}

function countBy<T>(items: T[], key: (item: T) => string): [string, number][] {
  const map = new Map<string, number>();
  for (const item of items) {
    const k = key(item);
    map.set(k, (map.get(k) ?? 0) + 1);
  }
  return [...map.entries()].sort((a, b) => b[1] - a[1]);
}

function groupNumeric<T, V extends Record<string, number>>(
  items: T[],
  key: (item: T) => string,
  value: (item: T) => V,
): [string, V][] {
  const map = new Map<string, V>();
  for (const item of items) {
    const k = key(item);
    const v = value(item);
    const acc = map.get(k);
    if (!acc) {
      map.set(k, { ...v });
      continue;
    }
    for (const field of Object.keys(v)) {
      (acc as Record<string, number>)[field] = (acc[field] ?? 0) + (v[field] ?? 0);
    }
  }
  return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
}

function countJoiners(roster: RosterRow[], scope: ReportScope): number {
  return roster.filter((e) => e.joinDate >= scope.from && e.joinDate <= scope.to).length;
}
