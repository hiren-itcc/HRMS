import type { AccessTokenClaims } from '@hrms/types';
import { Injectable } from '@nestjs/common';
import { addDays, dateKeyOf, toDate } from '../../common/utils/calendar';
import { PrismaService } from '../../database/prisma.service';
import type { Prisma } from '../../generated/prisma/client';
import { LifecyclePolicyService } from '../lifecycle/lifecycle-policy.service';

/**
 * Works here: not gone, not yet started.
 *
 * Deliberately written out rather than spread from `EMPLOYED_AND_LIVE` and
 * then narrowed — spreading it and writing `status` again *replaces* its
 * `not: 'ONBOARDING'` instead of adding to it, which is how somebody who has
 * not started their first day ends up in the birthday panel.
 */
const WORKS_HERE = {
  deletedAt: null,
  status: { notIn: ['ONBOARDING', 'EXITED'] },
} satisfies Pick<Prisma.EmployeeWhereInput, 'status' | 'deletedAt'>;
const LEAVING_SOON_DAYS = 30;
const CELEBRATION_WINDOW_DAYS = 30;

export interface Celebrant {
  id: string;
  name: string;
  avatarUrl: string | null;
  /** `"MM-DD"`. Never a year — see the note on `celebrations()`. */
  monthDay: string;
  /** Days from today, so the client never re-derives the ordering. */
  inDays: number;
}

export interface DashboardSummary {
  today: string;
  headcount: number | null;
  onProbation: number | null;
  probationOverdue: number | null;
  exits: {
    /** People actually on their way out — the tile. */
    leaving: number;
    /** Asked, not yet decided. The actionable half, and the hint. */
    pendingResignations: number;
    offboardingInProgress: number;
  } | null;
  approvals: {
    total: number;
    leave: number;
    attendance: number;
    remoteWork: number;
  } | null;
  payroll: {
    total: number;
    runsNeedingAction: number;
    settlementsToApprove: number;
    settlementsToPay: number;
  } | null;
  upcomingLastWorkingDates: {
    id: string;
    name: string;
    employeeCode: string;
    lastWorkingDate: string | null;
  }[];
  celebrations: {
    birthdays: Celebrant[];
    anniversaries: (Celebrant & { years: number })[];
  };
}

/**
 * The dashboard's numbers, in one call.
 *
 * This module exists because the screen's question — "is anything waiting on
 * me?" — is not any one domain's question. It reads other modules' tables
 * through Prisma directly, which is the pattern `SettlementsService` and
 * `AssetClearanceService` already use, rather than importing five services to
 * ask each for a count.
 *
 * **Every figure is null when the caller may not see it.** The tile checks for
 * null rather than for a permission, so authorization is decided once, here,
 * and the page cannot drift from it. A zero would be a lie — it reads as
 * "nothing is waiting" when the truth is "you may not know".
 */
@Injectable()
export class DashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly policy: LifecyclePolicyService,
  ) {}

  async summary(claims: AccessTokenClaims): Promise<DashboardSummary> {
    const perms = new Set(claims.perms);
    const orgId = claims.orgId;
    const ctx = await this.policy.contextFor(orgId);
    const today = toDate(ctx.todayKey);

    const seesPeople = perms.has('employee.read') || perms.has('employee.read.team');
    const seesResignations = perms.has('resignation.read') || perms.has('resignation.read.team');
    const seesExits = perms.has('employee.offboard');

    // `'__none__'` makes a manager with no employee record match nothing
    // rather than everything — the sentinel this codebase uses throughout.
    const me = claims.employeeId ?? '__none__';
    const teamOnly = !perms.has('employee.read');
    const scope: Prisma.EmployeeWhereInput = {
      organizationId: orgId,
      deletedAt: null,
      ...(teamOnly ? { managerId: me } : {}),
    };

    const [people, exits, approvals, payroll, upcoming, celebrations] = await Promise.all([
      seesPeople ? this.people(scope, today) : null,
      this.exits(perms, orgId, scope, seesResignations, seesExits, me),
      this.approvals(perms, orgId, me),
      this.payroll(perms, orgId),
      seesPeople ? this.upcomingExits(scope, today, ctx.todayKey) : Promise.resolve([]),
      this.celebrations(perms, orgId, ctx.todayKey),
    ]);

    return {
      today: ctx.todayKey,
      headcount: people?.headcount ?? null,
      onProbation: people?.onProbation ?? null,
      probationOverdue: people?.probationOverdue ?? null,
      exits,
      approvals,
      payroll,
      upcomingLastWorkingDates: upcoming,
      celebrations,
    };
  }

  // ── people ────────────────────────────────────────────────────────────

  private async people(scope: Prisma.EmployeeWhereInput, today: Date) {
    /** Unconfirmed, with a probation end date, whichever one is in force. */
    const onProbation: Prisma.EmployeeWhereInput = {
      ...scope,
      confirmedOn: null,
      status: { notIn: ['ONBOARDING', 'EXITED'] },
      OR: [{ probationExtendedTo: { not: null } }, { probationEndDate: { not: null } }],
    };

    const [headcount, onProbationCount, probationOverdue] = await Promise.all([
      this.prisma.employee.count({
        where: { ...scope, ...WORKS_HERE },
      }),
      this.prisma.employee.count({ where: onProbation }),
      this.prisma.employee.count({
        where: { ...onProbation, ...this.probationEndBefore(today) },
      }),
    ]);
    return { headcount, onProbation: onProbationCount, probationOverdue };
  }

  /**
   * "Probation ended before this date", honouring an extension.
   *
   * The OR shape matters: without the `probationExtendedTo: null` guard an
   * extended probation counts twice, once on its original date and once on the
   * new one.
   */
  private probationEndBefore(before: Date): Prisma.EmployeeWhereInput {
    return {
      OR: [
        { probationExtendedTo: { lt: before } },
        { probationExtendedTo: null, probationEndDate: { lt: before } },
      ],
    };
  }

  // ── exits, as one story ───────────────────────────────────────────────

  private async exits(
    perms: Set<string>,
    orgId: string,
    scope: Prisma.EmployeeWhereInput,
    seesResignations: boolean,
    seesExits: boolean,
    me: string,
  ): Promise<DashboardSummary['exits']> {
    const seesPeople = perms.has('employee.read') || perms.has('employee.read.team');
    if (!seesResignations && !seesExits && !seesPeople) return null;

    const resignationScope: Prisma.ResignationWhereInput = {
      organizationId: orgId,
      ...(perms.has('resignation.read') ? {} : { employee: { managerId: me } }),
    };

    const [pendingResignations, servingNotice, offboardingInProgress] = await Promise.all([
      seesResignations
        ? this.prisma.resignation.count({
            where: { ...resignationScope, status: { in: ['SUBMITTED', 'MANAGER_APPROVED'] } },
          })
        : 0,
      seesPeople ? this.prisma.employee.count({ where: { ...scope, status: 'ON_NOTICE' } }) : 0,
      seesExits
        ? this.prisma.offboarding.count({ where: { organizationId: orgId, status: 'IN_PROGRESS' } })
        : 0,
    ]);

    /*
     * Not a sum. Somebody serving notice almost always has an offboarding open
     * too, so adding the three would count most people twice — and a pending
     * resignation is somebody who has *asked*, not somebody who is leaving.
     * The headline is who is on their way out; the decision waiting is the hint.
     */
    return { leaving: servingNotice, pendingResignations, offboardingInProgress };
  }

  private async upcomingExits(scope: Prisma.EmployeeWhereInput, today: Date, todayKey: string) {
    const rows = await this.prisma.employee.findMany({
      where: {
        ...scope,
        status: 'ON_NOTICE',
        exitDate: { gte: today, lte: toDate(addDays(todayKey, LEAVING_SOON_DAYS)) },
      },
      select: { id: true, firstName: true, lastName: true, employeeCode: true, exitDate: true },
      orderBy: { exitDate: 'asc' },
      take: 8,
    });
    return rows.map((e) => ({
      id: e.id,
      name: `${e.firstName} ${e.lastName}`,
      employeeCode: e.employeeCode,
      lastWorkingDate: e.exitDate ? dateKeyOf(e.exitDate) : null,
    }));
  }

  // ── waiting on me ─────────────────────────────────────────────────────

  /**
   * The three things somebody approves, counted against the same scope each
   * inbox uses: the org-wide code sees everything, the `.team` code sees only
   * direct reports.
   */
  private async approvals(
    perms: Set<string>,
    orgId: string,
    me: string,
  ): Promise<DashboardSummary['approvals']> {
    const canLeave = perms.has('leave.approve') || perms.has('leave.approve.team');
    const canAttendance = perms.has('attendance.approve') || perms.has('attendance.approve.team');
    const canWfh = perms.has('wfh.approve') || perms.has('wfh.approve.team');
    if (!canLeave && !canAttendance && !canWfh) return null;

    /** Org-wide, or their own reports. */
    const reach = (orgWide: boolean): Prisma.EmployeeWhereInput =>
      orgWide ? { organizationId: orgId, deletedAt: null } : { managerId: me };

    const [leave, attendance, remoteWork] = await Promise.all([
      canLeave
        ? this.prisma.leaveRequest.count({
            where: { status: 'PENDING', employee: reach(perms.has('leave.approve')) },
          })
        : 0,
      canAttendance
        ? this.prisma.attendanceRequest.count({
            where: { status: 'PENDING', employee: reach(perms.has('attendance.approve')) },
          })
        : 0,
      canWfh
        ? this.prisma.remoteWorkRequest.count({
            where: {
              organizationId: orgId,
              status: 'PENDING',
              employee: reach(perms.has('wfh.approve')),
            },
          })
        : 0,
    ]);

    return { total: leave + attendance + remoteWork, leave, attendance, remoteWork };
  }

  // ── money that is stuck ───────────────────────────────────────────────

  private async payroll(perms: Set<string>, orgId: string): Promise<DashboardSummary['payroll']> {
    const canApprove = perms.has('payroll.approve');
    const canPay = perms.has('payroll.pay');
    if (!canApprove && !canPay) return null;

    const [runsNeedingAction, settlementsToApprove, settlementsToPay] = await Promise.all([
      canApprove
        ? this.prisma.payrollRun.count({
            where: { organizationId: orgId, status: { in: ['IN_REVIEW', 'APPROVED'] } },
          })
        : 0,
      canApprove
        ? this.prisma.settlement.count({ where: { organizationId: orgId, status: 'DRAFT' } })
        : 0,
      canPay
        ? this.prisma.settlement.count({ where: { organizationId: orgId, status: 'APPROVED' } })
        : 0,
    ]);

    return {
      total: runsNeedingAction + settlementsToApprove + settlementsToPay,
      runsNeedingAction,
      settlementsToApprove,
      settlementsToPay,
    };
  }

  // ── celebrations ──────────────────────────────────────────────────────

  /**
   * Birthdays and work anniversaries in the next 30 days.
   *
   * **No year ever leaves this method for a birthday.** `monthDay` is
   * `"MM-DD"`, so age cannot be read off the response even by somebody looking
   * at the network tab. Anniversaries do carry `years`, because "5 years today"
   * is the entire point of one.
   *
   * Filtered in JS rather than SQL: "within 30 days, ignoring the year" wraps
   * around 31 December and Prisma cannot express it. That means selecting six
   * columns for every employed person on each dashboard load — fine at this
   * product's scale, and the same bargain the holidays panel already makes. If
   * an organization ever grows past the point where that is cheap, the upgrade
   * is a raw query on `EXTRACT(MONTH FROM …)`, not a redesign.
   */
  private async celebrations(
    perms: Set<string>,
    orgId: string,
    todayKey: string,
  ): Promise<DashboardSummary['celebrations']> {
    const empty = { birthdays: [], anniversaries: [] };
    // Every seeded role holds this; somebody in a custom role without it sees
    // no colleagues anywhere, so they should not see them here either.
    if (!perms.has('directory.read')) return empty;

    const rows = await this.prisma.employee.findMany({
      where: { organizationId: orgId, ...WORKS_HERE },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        avatarUrl: true,
        dateOfBirth: true,
        joinDate: true,
      },
    });

    const birthdays: Celebrant[] = [];
    const anniversaries: (Celebrant & { years: number })[] = [];

    for (const row of rows) {
      const name = `${row.firstName} ${row.lastName}`;
      const base = { id: row.id, name, avatarUrl: row.avatarUrl };

      if (row.dateOfBirth) {
        const inDays = this.daysUntilAnniversaryOf(dateKeyOf(row.dateOfBirth), todayKey);
        if (inDays !== null) {
          birthdays.push({ ...base, monthDay: dateKeyOf(row.dateOfBirth).slice(5), inDays });
        }
      }

      const joinKey = dateKeyOf(row.joinDate);
      const inDays = this.daysUntilAnniversaryOf(joinKey, todayKey);
      // A first anniversary is one that has come round, so somebody who joined
      // this month is not "0 years" — they are simply not celebrating yet.
      const years = Number(todayKey.slice(0, 4)) - Number(joinKey.slice(0, 4));
      if (inDays !== null && years > 0) {
        anniversaries.push({ ...base, monthDay: joinKey.slice(5), inDays, years });
      }
    }

    const soonest = (a: { inDays: number }, b: { inDays: number }) => a.inDays - b.inDays;
    return {
      birthdays: birthdays.sort(soonest),
      anniversaries: anniversaries.sort(soonest),
    };
  }

  /**
   * How many days until this date comes round again, or null if that is more
   * than the window away.
   *
   * Wrapping is the whole difficulty: read in December, a January birthday is
   * days away and a January *date* is months behind. Comparing month-day
   * strings gets that wrong, so the next occurrence is built explicitly and
   * rolled into next year when it has already gone.
   */
  private daysUntilAnniversaryOf(dateKey: string, todayKey: string): number | null {
    const monthDay = dateKey.slice(5);
    const thisYear = Number(todayKey.slice(0, 4));

    // 29 February lands on 1 March in a common year, which is when people
    // celebrate it anyway.
    const occurrence = (year: number) => {
      const [month, day] = monthDay.split('-').map(Number) as [number, number];
      return new Date(Date.UTC(year, month - 1, day));
    };

    let next = occurrence(thisYear);
    if (dateKeyOf(next) < todayKey) next = occurrence(thisYear + 1);

    const days = Math.round((next.getTime() - toDate(todayKey).getTime()) / 86_400_000);
    return days >= 0 && days <= CELEBRATION_WINDOW_DAYS ? days : null;
  }
}
