import type { AccessTokenClaims } from '@hrms/types';
import { Injectable } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { auditMutation } from '../../common/utils/audit';
import { addDays, dateKeyOf, toDate } from '../../common/utils/calendar';
import { PrismaService } from '../../database/prisma.service';
import type { Prisma } from '../../generated/prisma/client';
import { EMPLOYED_AND_LIVE } from '../employees/employee-scopes';
import { OffboardingsService } from '../offboarding/offboardings.service';
import { effectiveProbationEnd } from './lifecycle.rules';
import { LifecyclePolicyService } from './lifecycle-policy.service';

/** One `Setting` row per organization, outside the typed registry. */
const LAST_RUN_KEY = 'lifecycle.lastRunAt';

/** How far ahead the dashboard counts as "soon". */
const PROBATION_SOON_DAYS = 30;
const LEAVING_SOON_DAYS = 30;

export interface LifecycleStats {
  today: string;
  /**
   * People who actually work here: everyone but those who have left and those
   * who have not started.
   *
   * The dashboard used to take this from the employee list's `meta.total`,
   * which filters on nothing but the soft delete — so it counted leavers, and
   * a company of two that had lost one still read "2 · Active records".
   */
  headcount: number | null;
  /** Null when the caller may not see that figure — the tile is not rendered. */
  onProbation: number | null;
  probationEndingSoon: number | null;
  probationOverdue: number | null;
  pendingResignations: number | null;
  activeNoticePeriods: number | null;
  offboardingInProgress: number | null;
  upcomingLastWorkingDates: {
    id: string;
    name: string;
    employeeCode: string;
    lastWorkingDate: string | null;
  }[];
}

export interface LifecycleRunResult {
  ranAt: string;
  today: string;
  confirmed: number;
  exited: number;
  /** Ids that failed, with why — one bad row must not stop the rest. */
  failures: { id: string; reason: string }[];
}

/**
 * The two things that happen to somebody without anybody pressing a button:
 * a probation ends, and a notice period runs out.
 *
 * **This is not the source of truth for either.** Probation state and notice
 * elapse are derived on every read from the dates, so a screen is right
 * whether or not this has run today. What this does is the *writing* —
 * stamping `confirmedOn`, and closing an offboarding so the sign-in is
 * actually suspended. Nothing displayed depends on it.
 *
 * That split is not an aesthetic choice. The API runs on a plan where the
 * instance sleeps after fifteen idle minutes, so an `@Cron('0 0 * * *')` would
 * silently not fire on any night nobody happened to be using the product — and
 * it would fail invisibly, with no error and no log. Deriving on read means
 * the worst a missed tick can cause is a login that stays live a few hours
 * longer than it should, which is visible and fixable, rather than a page that
 * quietly says the wrong thing.
 *
 * Every operation is idempotent, so running it twice concurrently is harmless:
 * confirmation only touches rows where `confirmedOn` is null, and completion
 * only touches offboardings that are still IN_PROGRESS.
 */
@Injectable()
export class LifecycleService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly policy: LifecyclePolicyService,
    private readonly offboardings: OffboardingsService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(LifecycleService.name);
  }

  async run(orgId: string, actorId: string | null = null): Promise<LifecycleRunResult> {
    const ctx = await this.policy.contextFor(orgId);
    const failures: LifecycleRunResult['failures'] = [];

    const confirmed = ctx.policy.autoConfirmOnProbationEnd
      ? await this.confirmDueProbations(orgId, ctx.todayKey, actorId, failures)
      : 0;

    const exited = ctx.policy.autoExitOnLastWorkingDate
      ? await this.completeDueOffboardings(orgId, ctx.todayKey, actorId, failures)
      : 0;

    const ranAt = new Date().toISOString();
    await this.prisma.setting.upsert({
      where: { organizationId_key: { organizationId: orgId, key: LAST_RUN_KEY } },
      update: { value: { ranAt, today: ctx.todayKey } },
      create: { organizationId: orgId, key: LAST_RUN_KEY, value: { ranAt, today: ctx.todayKey } },
    });

    if (confirmed || exited || failures.length) {
      this.logger.info({ orgId, confirmed, exited, failures: failures.length }, 'lifecycle tick');
    }
    return { ranAt, today: ctx.todayKey, confirmed, exited, failures };
  }

  /**
   * Runs at most once a day per organization, and never blocks the caller.
   *
   * Called from `/auth/me`, which every session hits on load — one call site
   * rather than an interceptor on every request. It is deliberately not
   * awaited by the handler: a slow or failing tick must not make signing in
   * slow or failing.
   */
  async tickIfDue(orgId: string): Promise<void> {
    try {
      const ctx = await this.policy.contextFor(orgId);
      const row = await this.prisma.setting.findUnique({
        where: { organizationId_key: { organizationId: orgId, key: LAST_RUN_KEY } },
        select: { value: true },
      });
      const lastToday = (row?.value as { today?: string } | null)?.today;
      if (lastToday === ctx.todayKey) return;
      await this.run(orgId, null);
    } catch (err) {
      // Swallowed on purpose. The read paths do not depend on this having run,
      // so a failure here is a delay rather than a wrong answer — and it must
      // never be the reason somebody cannot sign in.
      this.logger.warn({ err, orgId }, 'lifecycle tick failed; state is still derived on read');
    }
  }

  /**
   * The dashboard numbers, in one query set rather than six list calls that
   * each fetch a row to read `meta.total` off the envelope.
   *
   * Every figure is null when the caller cannot see it, so the dashboard
   * renders the tiles it is allowed to rather than a row of zeroes that look
   * like facts. A manager gets the same shape as HR, narrowed to their own
   * reports by the `'__none__'` sentinel — one endpoint, two dashboards.
   */
  async stats(claims: AccessTokenClaims): Promise<LifecycleStats> {
    const perms = new Set(claims.perms);
    const orgId = claims.orgId;
    const ctx = await this.policy.contextFor(orgId);
    const today = toDate(ctx.todayKey);
    const soon = toDate(addDays(ctx.todayKey, PROBATION_SOON_DAYS));

    const seesPeople = perms.has('employee.read') || perms.has('employee.read.team');
    const seesResignations = perms.has('resignation.read') || perms.has('resignation.read.team');
    const seesExits = perms.has('employee.offboard');

    // The scope, resolved once. `'__none__'` makes a manager with no employee
    // record match nothing rather than everything.
    const teamOnly = !perms.has('employee.read');
    const scope: Prisma.EmployeeWhereInput = {
      organizationId: orgId,
      deletedAt: null,
      ...(teamOnly ? { managerId: claims.employeeId ?? '__none__' } : {}),
    };
    const resignationScope: Prisma.ResignationWhereInput = {
      organizationId: orgId,
      ...(perms.has('resignation.read')
        ? {}
        : { employee: { managerId: claims.employeeId ?? '__none__' } }),
    };

    /** Unconfirmed, with a probation end date, whichever one is in force. */
    const onProbation: Prisma.EmployeeWhereInput = {
      ...scope,
      confirmedOn: null,
      status: { notIn: ['ONBOARDING', 'EXITED'] },
      OR: [{ probationExtendedTo: { not: null } }, { probationEndDate: { not: null } }],
    };

    const [
      headcount,
      onProbationCount,
      probationEndingSoon,
      probationOverdue,
      pendingResignations,
      activeNoticePeriods,
      offboardingInProgress,
    ] = await Promise.all([
      // EMPLOYED_AND_LIVE is the shared definition of "works here" — imported
      // rather than retyped, which is the whole reason it exists.
      seesPeople
        ? this.prisma.employee.count({
            where: { ...scope, ...EMPLOYED_AND_LIVE, status: { notIn: ['ONBOARDING', 'EXITED'] } },
          })
        : null,
      seesPeople ? this.prisma.employee.count({ where: onProbation }) : null,
      seesPeople
        ? this.prisma.employee.count({
            where: { ...onProbation, ...this.probationEndBetween(today, soon) },
          })
        : null,
      seesPeople
        ? this.prisma.employee.count({
            where: { ...onProbation, ...this.probationEndBefore(today) },
          })
        : null,
      seesResignations
        ? this.prisma.resignation.count({
            where: { ...resignationScope, status: { in: ['SUBMITTED', 'MANAGER_APPROVED'] } },
          })
        : null,
      seesPeople ? this.prisma.employee.count({ where: { ...scope, status: 'ON_NOTICE' } }) : null,
      seesExits
        ? this.prisma.offboarding.count({ where: { organizationId: orgId, status: 'IN_PROGRESS' } })
        : null,
    ]);

    const upcomingLastWorkingDates = seesPeople
      ? await this.prisma.employee.findMany({
          where: {
            ...scope,
            status: 'ON_NOTICE',
            exitDate: { gte: today, lte: toDate(addDays(ctx.todayKey, LEAVING_SOON_DAYS)) },
          },
          select: { id: true, firstName: true, lastName: true, employeeCode: true, exitDate: true },
          orderBy: { exitDate: 'asc' },
          take: 8,
        })
      : [];

    return {
      today: ctx.todayKey,
      headcount,
      onProbation: onProbationCount,
      probationEndingSoon,
      probationOverdue,
      pendingResignations,
      activeNoticePeriods,
      offboardingInProgress,
      upcomingLastWorkingDates: upcomingLastWorkingDates.map((e) => ({
        id: e.id,
        name: `${e.firstName} ${e.lastName}`,
        employeeCode: e.employeeCode,
        lastWorkingDate: e.exitDate ? dateKeyOf(e.exitDate) : null,
      })),
    };
  }

  /**
   * "Probation ends between these dates", honouring an extension.
   *
   * Split out because the OR shape is written three times and getting it wrong
   * silently counts extended probations twice — once on their original date
   * and once on the new one.
   */
  private probationEndBetween(from: Date, to: Date): Prisma.EmployeeWhereInput {
    return {
      OR: [
        { probationExtendedTo: { gte: from, lte: to } },
        { probationExtendedTo: null, probationEndDate: { gte: from, lte: to } },
      ],
    };
  }

  private probationEndBefore(before: Date): Prisma.EmployeeWhereInput {
    return {
      OR: [
        { probationExtendedTo: { lt: before } },
        { probationExtendedTo: null, probationEndDate: { lt: before } },
      ],
    };
  }

  async status(orgId: string) {
    const [ctx, row] = await Promise.all([
      this.policy.contextFor(orgId),
      this.prisma.setting.findUnique({
        where: { organizationId_key: { organizationId: orgId, key: LAST_RUN_KEY } },
        select: { value: true },
      }),
    ]);
    const last = (row?.value as { ranAt?: string; today?: string } | null) ?? null;
    return {
      today: ctx.todayKey,
      lastRunAt: last?.ranAt ?? null,
      lastRunDate: last?.today ?? null,
      dueToday: last?.today !== ctx.todayKey,
      policy: ctx.policy,
    };
  }

  /**
   * Confirmed **as at the day their probation ended**, not as at today.
   *
   * Somebody whose probation ended on the 1st and whose confirmation is
   * written on the 9th because nobody opened the app over a weekend was
   * permanent from the 1st. Dating it today would quietly move the fact to fit
   * when the job happened to notice — which is exactly the class of error
   * deriving-on-read exists to avoid.
   */
  private async confirmDueProbations(
    orgId: string,
    todayKey: string,
    actorId: string | null,
    failures: LifecycleRunResult['failures'],
  ): Promise<number> {
    const due = await this.prisma.employee.findMany({
      where: {
        organizationId: orgId,
        deletedAt: null,
        confirmedOn: null,
        // Somebody serving notice is still confirmed off probation if the date
        // has passed; only people who never started are excluded.
        status: { notIn: ['ONBOARDING'] },
        OR: [
          { probationExtendedTo: { not: null, lt: toDate(todayKey) } },
          { probationExtendedTo: null, probationEndDate: { not: null, lt: toDate(todayKey) } },
        ],
      },
      select: {
        id: true,
        joinDate: true,
        probationMonths: true,
        probationEndDate: true,
        probationExtendedTo: true,
        confirmedOn: true,
        noticePeriodDays: true,
      },
      // Bounded so one very stale organization cannot turn a page load into a
      // thousand writes. The rest are picked up by the next tick.
      take: 200,
    });

    let count = 0;
    for (const employee of due) {
      const endedOn = effectiveProbationEnd(employee);
      if (!endedOn) continue;
      try {
        await this.prisma.employee.update({
          where: { id: employee.id },
          data: { confirmedOn: toDate(endedOn) },
        });
        await auditMutation(
          this.prisma,
          { orgId, userId: actorId },
          'employee.confirm',
          'Employee',
          employee.id,
          { after: { confirmedOn: endedOn }, automatic: true },
        );
        count++;
      } catch (err) {
        failures.push({ id: employee.id, reason: (err as Error).message });
      }
    }
    return count;
  }

  /** Their last day has passed: close the offboarding, which is what exits them. */
  private async completeDueOffboardings(
    orgId: string,
    todayKey: string,
    actorId: string | null,
    failures: LifecycleRunResult['failures'],
  ): Promise<number> {
    const due = await this.offboardings.dueForCompletion(orgId, todayKey);
    let count = 0;
    for (const { id } of due) {
      try {
        await this.offboardings.complete({ orgId, userId: actorId }, id, {});
        count++;
      } catch (err) {
        /*
         * Most likely the last-admin guard: the only person who can administer
         * the organization has a notice period that just ran out. Refusing is
         * right — silently locking everybody out would be worse — and it is
         * reported rather than swallowed so somebody can fix it.
         */
        failures.push({ id, reason: (err as Error).message });
      }
    }
    return count;
  }
}
