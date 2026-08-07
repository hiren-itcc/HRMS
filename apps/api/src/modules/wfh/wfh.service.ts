import type {
  WfhAmendInput,
  WfhApplyInput,
  WfhDecisionInput,
  WfhPreview,
  WfhPreviewQuery,
  WfhQuery,
} from '@hrms/shared';
import type { AccessTokenClaims } from '@hrms/types';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { auditMutation } from '../../common/utils/audit';
import { addDays, dateKeyOf, displayDate, toDate } from '../../common/utils/calendar';
import { buildListArgs, toPaginated } from '../../common/utils/list-query';
import { PrismaService } from '../../database/prisma.service';
import type { Prisma } from '../../generated/prisma/client';
import { dateKeyInTz } from '../attendance/attendance.util';
import { calculateLeaveDays } from '../leave/leave.util';
import { NotificationsService } from '../notifications/notifications.service';
import { SettingsService } from '../settings/settings.service';
import { capBreaches, effectiveWeeklyCap, weekKeyOf } from './wfh.rules';

const SORTABLE = ['startDate', 'createdAt', 'status'] as const;

const INCLUDE = {
  employee: {
    select: {
      id: true,
      firstName: true,
      lastName: true,
      employeeCode: true,
      avatarUrl: true,
      managerId: true,
    },
  },
} as const;

/** Statuses that still hold days against the cap. */
const BLOCKING = ['PENDING', 'APPROVED'] as const;

interface Ctx {
  orgId: string;
  userId: string | null;
}

/**
 * Permission to work remotely.
 *
 * Deliberately only the forward half. Attendance already detects who worked
 * from home and needs no help doing it; nothing here is consulted at clock-in,
 * and no attendance row is ever written by this service.
 */
@Injectable()
export class WfhService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly notifications: NotificationsService,
  ) {}

  // ── the flag ──────────────────────────────────────────────────────────

  /**
   * Which employee-days were agreed in advance, as `"employeeId|dateKey"`.
   *
   * The one thing attendance asks this module. It is a read, called once for a
   * range the caller is already fetching, and its absence is what "worked from
   * home without approval" means on screen — there is no column anywhere
   * recording that, on purpose.
   */
  async approvedDaysIn(
    orgId: string,
    employeeIds: string[],
    fromKey: string,
    toKey: string,
    /**
     * The working week and holidays, when the caller has already fetched them.
     *
     * Attendance always has: it reads both for the very range it is asking
     * about. Without this, every month view and every team day view paid for
     * the same two queries twice — on the screen everybody opens daily.
     */
    known?: { weekOffDays: number[]; holidays: Set<string> },
  ): Promise<Set<string>> {
    if (employeeIds.length === 0) return new Set();

    const rows = await this.prisma.remoteWorkRequest.findMany({
      where: {
        organizationId: orgId,
        employeeId: { in: employeeIds },
        status: 'APPROVED',
        // Overlaps the window, rather than sits inside it.
        startDate: { lte: toDate(toKey) },
        endDate: { gte: toDate(fromKey) },
      },
      select: { employeeId: true, startDate: true, endDate: true },
    });

    const weekOff = known?.weekOffDays ?? (await this.settings.get(orgId)).workingWeek.weekOffDays;
    const holidays = known?.holidays ?? (await this.holidayKeys(orgId, fromKey, toKey));

    const approved = new Set<string>();
    for (const row of rows) {
      const { workingDays } = calculateLeaveDays(
        dateKeyOf(row.startDate),
        dateKeyOf(row.endDate),
        holidays,
        null,
        weekOff,
      );
      for (const day of workingDays) {
        if (day >= fromKey && day <= toKey) approved.add(`${row.employeeId}|${day}`);
      }
    }
    return approved;
  }

  // ── preview ───────────────────────────────────────────────────────────

  /** What the form is told before anything is filed. */
  async preview(claims: AccessTokenClaims, query: WfhPreviewQuery): Promise<WfhPreview> {
    const employeeId = this.requireEmployee(claims);
    const { workingDays, skipped } = await this.breakdown(
      claims.orgId,
      query.startDate,
      query.endDate,
    );
    const { cap, weekStartsOn } = await this.policyFor(claims.orgId, employeeId);
    const held = await this.heldDays(claims.orgId, employeeId, workingDays, weekStartsOn);

    return {
      workingDays,
      skipped,
      cap,
      breaches: capBreaches(workingDays, held, cap, weekStartsOn),
    };
  }

  // ── file, amend, cancel ───────────────────────────────────────────────

  async apply(claims: AccessTokenClaims, input: WfhApplyInput) {
    const ctx: Ctx = { orgId: claims.orgId, userId: claims.sub };
    const employeeId = this.requireEmployee(claims);
    const config = (await this.settings.get(ctx.orgId)).wfh;
    if (!config.enabled) {
      throw new BadRequestException('Remote working is switched off for this organization');
    }

    const workingDays = await this.assertBookable(claims, employeeId, input, null);

    // Approved as filed when the company treats remote days as a matter of
    // record rather than permission — the same switch the lifecycle module
    // offers for routing resignations past a manager.
    const auto = !config.requireApproval;

    const created = await this.prisma.remoteWorkRequest.create({
      data: {
        organizationId: ctx.orgId,
        employeeId,
        startDate: toDate(input.startDate),
        endDate: toDate(input.endDate),
        days: workingDays.length,
        reason: input.reason,
        ...(auto
          ? { status: 'APPROVED' as const, approverId: ctx.userId, actedAt: new Date() }
          : {}),
      },
      include: INCLUDE,
    });

    await auditMutation(this.prisma, ctx, 'wfh.apply', 'RemoteWorkRequest', created.id, {
      after: {
        startDate: input.startDate,
        endDate: input.endDate,
        days: workingDays.length,
        status: created.status,
      },
      note: input.reason,
    });

    if (!auto) await this.tellApprover(created);
    return created;
  }

  /** Amending is the employee's own, and only while nobody has decided. */
  async amend(claims: AccessTokenClaims, id: string, input: WfhAmendInput) {
    const ctx: Ctx = { orgId: claims.orgId, userId: claims.sub };
    const request = await this.require(ctx.orgId, id);
    if (request.employeeId !== claims.employeeId) {
      throw new ForbiddenException('This is not your request');
    }
    if (request.status !== 'PENDING') {
      throw new BadRequestException('This request has already been decided');
    }

    const workingDays = await this.assertBookable(claims, request.employeeId, input, id);

    const updated = await this.prisma.remoteWorkRequest.update({
      where: { id },
      data: {
        startDate: toDate(input.startDate),
        endDate: toDate(input.endDate),
        days: workingDays.length,
        reason: input.reason,
      },
      include: INCLUDE,
    });

    await auditMutation(this.prisma, ctx, 'wfh.amend', 'RemoteWorkRequest', id, {
      before: {
        startDate: dateKeyOf(request.startDate),
        endDate: dateKeyOf(request.endDate),
        days: Number(request.days),
      },
      after: { startDate: input.startDate, endDate: input.endDate, days: workingDays.length },
    });
    return updated;
  }

  /**
   * Withdrawing. Their own, pending or still to come — cancelling a day
   * already worked would make the attendance flag disagree with a decision
   * somebody acted on at the time.
   */
  async cancel(claims: AccessTokenClaims, id: string) {
    const ctx: Ctx = { orgId: claims.orgId, userId: claims.sub };
    const request = await this.require(ctx.orgId, id);

    const perms = new Set(claims.perms);
    const isOwn = request.employeeId === claims.employeeId;
    if (!isOwn && !perms.has('wfh.approve')) {
      throw new ForbiddenException('You cannot cancel this request');
    }
    if (request.status !== 'PENDING' && request.status !== 'APPROVED') {
      throw new BadRequestException('This request is already closed');
    }
    const todayKey = await this.todayKey(ctx.orgId);
    const startKey = dateKeyOf(request.startDate);
    const endKey = dateKeyOf(request.endDate);

    if (request.status === 'APPROVED' && endKey < todayKey) {
      throw new BadRequestException('Those days have already passed');
    }

    /*
     * A range that straddles today is **truncated, not voided**.
     *
     * Withdrawing a Monday-to-Friday request on the Wednesday must not unapprove
     * the Monday and Tuesday somebody already worked — attendance would re-read
     * those days as unplanned, disagreeing with a decision that was made and
     * acted on at the time. Only the part still ahead is given up.
     */
    const straddles = request.status === 'APPROVED' && startKey < todayKey && endKey >= todayKey;

    const updated = straddles
      ? await this.prisma.remoteWorkRequest.update({
          where: { id },
          data: {
            endDate: toDate(addDays(todayKey, -1)),
            days: (await this.workingDaysOf(ctx.orgId, startKey, addDays(todayKey, -1))).length,
            approverNote: [request.approverNote, `Remaining days withdrawn on ${todayKey}`]
              .filter(Boolean)
              .join(' · '),
          },
          include: INCLUDE,
        })
      : await this.prisma.remoteWorkRequest.update({
          where: { id },
          data: { status: 'CANCELLED', actedAt: new Date() },
          include: INCLUDE,
        });

    await auditMutation(this.prisma, ctx, 'wfh.cancel', 'RemoteWorkRequest', id, {
      before: { status: request.status, startDate: startKey, endDate: endKey },
      after: straddles
        ? { status: 'APPROVED', endDate: addDays(todayKey, -1), truncated: true }
        : { status: 'CANCELLED' },
    });
    return updated;
  }

  // ── decide ────────────────────────────────────────────────────────────

  async decide(claims: AccessTokenClaims, id: string, approved: boolean, input: WfhDecisionInput) {
    const ctx: Ctx = { orgId: claims.orgId, userId: claims.sub };
    const request = await this.prisma.remoteWorkRequest.findFirst({
      where: { id, organizationId: ctx.orgId },
      include: INCLUDE,
    });
    if (!request) throw new NotFoundException('Request not found');
    if (request.status !== 'PENDING') {
      throw new BadRequestException('This request has already been decided');
    }

    const perms = new Set(claims.perms);
    const isTeam =
      request.employee.managerId != null && request.employee.managerId === claims.employeeId;
    if (!perms.has('wfh.approve') && !(perms.has('wfh.approve.team') && isTeam)) {
      throw new ForbiddenException('You cannot act on this request');
    }
    if (request.employeeId === claims.employeeId) {
      throw new ForbiddenException('You cannot approve your own remote days');
    }

    /*
     * The cap is re-checked here, not only at submission. Two requests can both
     * pass on the way in and only collide once one is approved — the first
     * decision is what makes the days real.
     */
    if (approved) {
      const { cap, weekStartsOn } = await this.policyFor(ctx.orgId, request.employeeId);
      const days = await this.workingDaysOf(
        ctx.orgId,
        dateKeyOf(request.startDate),
        dateKeyOf(request.endDate),
      );
      const held = await this.heldDays(ctx.orgId, request.employeeId, days, weekStartsOn, id, [
        'APPROVED',
      ]);
      const breaches = capBreaches(days, held, cap, weekStartsOn);
      if (breaches.length > 0) throw new ConflictException(this.breachMessage(breaches));
    }

    const updated = await this.prisma.remoteWorkRequest.update({
      where: { id },
      data: {
        status: approved ? 'APPROVED' : 'REJECTED',
        approverId: ctx.userId,
        actedAt: new Date(),
        approverNote: input.note ?? null,
      },
      include: INCLUDE,
    });

    await auditMutation(
      this.prisma,
      ctx,
      approved ? 'wfh.approve' : 'wfh.reject',
      'RemoteWorkRequest',
      id,
      {
        before: { status: 'PENDING' },
        after: { status: updated.status },
        note: input.note ?? null,
      },
    );

    await this.notifications.notify(await this.usersOf([request.employeeId]), {
      type: approved ? 'wfh.approved' : 'wfh.rejected',
      title: approved ? 'Remote days approved' : 'Remote days declined',
      body: `${displayDate(dateKeyOf(request.startDate))} to ${displayDate(dateKeyOf(request.endDate))}`,
      linkPath: '/attendance/remote',
    });
    return updated;
  }

  // ── reads ─────────────────────────────────────────────────────────────

  async list(claims: AccessTokenClaims, query: WfhQuery) {
    const perms = new Set(claims.perms);
    const where: Prisma.RemoteWorkRequestWhereInput = {
      organizationId: claims.orgId,
      ...this.scopeWhere(claims, query.scope, perms),
      ...(query.status ? { status: query.status } : {}),
      ...(query.scope === 'inbox' && !query.status ? { status: 'PENDING' as const } : {}),
      ...(query.from ? { endDate: { gte: toDate(query.from) } } : {}),
      ...(query.to ? { startDate: { lte: toDate(query.to) } } : {}),
    };

    const [data, total] = await this.prisma.$transaction([
      this.prisma.remoteWorkRequest.findMany({
        where,
        include: INCLUDE,
        ...buildListArgs(query, SORTABLE, 'startDate'),
      }),
      this.prisma.remoteWorkRequest.count({ where }),
    ]);
    return toPaginated(data, total, query);
  }

  async detail(claims: AccessTokenClaims, id: string) {
    const request = await this.prisma.remoteWorkRequest.findFirst({
      where: { id, organizationId: claims.orgId },
      include: INCLUDE,
    });
    if (!request) throw new NotFoundException('Request not found');

    const perms = new Set(claims.perms);
    const isOwn = request.employeeId === claims.employeeId;
    const isTeam =
      request.employee.managerId != null && request.employee.managerId === claims.employeeId;
    const mayRead =
      isOwn ||
      perms.has('wfh.read') ||
      (perms.has('wfh.read.team') && isTeam) ||
      (perms.has('wfh.approve.team') && isTeam);
    if (!mayRead) throw new ForbiddenException('You cannot read this request');
    return request;
  }

  // ── internals ─────────────────────────────────────────────────────────

  /**
   * Today where the company is, not where the server is.
   *
   * UTC would be wrong for any organization ahead of it: at 03:00 in Mumbai it
   * is still yesterday in UTC, so a request "for today" would be accepted for a
   * day that has already gone — which is the one thing this check exists to
   * refuse. Attendance already reckons its days this way.
   */
  private async todayKey(orgId: string): Promise<string> {
    const org = await this.prisma.organization.findUniqueOrThrow({
      where: { id: orgId },
      select: { timezone: true },
    });
    return dateKeyInTz(new Date(), org.timezone);
  }

  private requireEmployee(claims: AccessTokenClaims): string {
    if (!claims.employeeId) {
      throw new BadRequestException('No employee record is linked to this account');
    }
    return claims.employeeId;
  }

  private async holidayKeys(orgId: string, startKey: string, endKey: string) {
    const rows = await this.prisma.holiday.findMany({
      where: { organizationId: orgId, date: { gte: toDate(startKey), lte: toDate(endKey) } },
      select: { date: true },
    });
    return new Set(rows.map((h) => dateKeyOf(h.date)));
  }

  /** Working days a range covers — the same reckoning leave uses. */
  private async breakdown(orgId: string, startKey: string, endKey: string) {
    const settings = await this.settings.get(orgId);
    const holidays = await this.holidayKeys(orgId, startKey, endKey);
    return calculateLeaveDays(startKey, endKey, holidays, null, settings.workingWeek.weekOffDays);
  }

  private async workingDaysOf(orgId: string, startKey: string, endKey: string) {
    return (await this.breakdown(orgId, startKey, endKey)).workingDays;
  }

  private async policyFor(orgId: string, employeeId: string) {
    const settings = await this.settings.get(orgId);
    const employee = await this.prisma.employee.findFirst({
      where: { id: employeeId, organizationId: orgId },
      select: { remoteDaysPerWeek: true },
    });
    if (!employee) throw new NotFoundException('Employee not found');

    return {
      cap: effectiveWeeklyCap(employee, settings.wfh),
      weekStartsOn: settings.workingWeek.weekStartsOn,
    };
  }

  /**
   * Days already spoken for in the weeks a request touches.
   *
   * Pending requests count as well as approved ones on the way in — two
   * requests that each fit but together do not should be caught when the
   * second is filed, not left for whoever approves them.
   */
  private async heldDays(
    orgId: string,
    employeeId: string,
    around: string[],
    weekStartsOn: number,
    exceptId: string | null = null,
    statuses: readonly string[] = BLOCKING,
  ): Promise<string[]> {
    if (around.length === 0) return [];

    /*
     * Widened to whole weeks, and that is load-bearing. The cap is per week, so
     * a request for Monday has to see an approved Friday in the same week —
     * and Friday is outside the requested range. Querying only the range's own
     * span made the check silently pass and the week go over.
     */
    const sorted = [...around].sort();
    const from = weekKeyOf(sorted[0] as string, weekStartsOn);
    const to = addDays(weekKeyOf(sorted[sorted.length - 1] as string, weekStartsOn), 6);

    const rows = await this.prisma.remoteWorkRequest.findMany({
      where: {
        organizationId: orgId,
        employeeId,
        status: { in: statuses as Prisma.EnumApprovalStatusFilter['in'] },
        startDate: { lte: toDate(to) },
        endDate: { gte: toDate(from) },
        ...(exceptId ? { id: { not: exceptId } } : {}),
      },
      select: { startDate: true, endDate: true },
    });

    if (rows.length === 0) return [];

    /*
     * One settings read and one holiday read for all of them.
     *
     * This used to call `workingDaysOf` per row, and that method fetches the
     * settings *and* the holiday calendar every time — two queries per
     * overlapping request, on every apply and every amend, all asking the same
     * organization about overlapping dates. Somebody with four requests in the
     * surrounding weeks paid eight round trips to answer one question.
     *
     * The span is widened to the rows' own extremes rather than reusing
     * `[from, to]`: a request that starts before the window or ends after it
     * still matched, and a holiday calendar that stopped at the window edge
     * would count its outlying holidays as working days — which shows up as a
     * cap refusal nobody can explain.
     */
    const starts = rows.map((r) => dateKeyOf(r.startDate));
    const ends = rows.map((r) => dateKeyOf(r.endDate));
    const spanFrom = [from, ...starts].sort()[0] as string;
    const spanTo = [to, ...ends].sort().at(-1) as string;

    const settings = await this.settings.get(orgId);
    const holidays = await this.holidayKeys(orgId, spanFrom, spanTo);

    return rows.flatMap(
      (row) =>
        calculateLeaveDays(
          dateKeyOf(row.startDate),
          dateKeyOf(row.endDate),
          holidays,
          null,
          settings.workingWeek.weekOffDays,
        ).workingDays,
    );
  }

  /** Every refusal a new or amended request can earn, each saying why. */
  private async assertBookable(
    claims: AccessTokenClaims,
    employeeId: string,
    input: WfhApplyInput,
    exceptId: string | null,
  ): Promise<string[]> {
    if (input.startDate < (await this.todayKey(claims.orgId))) {
      throw new BadRequestException('Remote days are agreed in advance, not afterwards');
    }

    const { workingDays } = await this.breakdown(claims.orgId, input.startDate, input.endDate);
    if (workingDays.length === 0) {
      throw new BadRequestException('That range is all weekends and holidays');
    }

    const overlap = await this.prisma.remoteWorkRequest.findFirst({
      where: {
        organizationId: claims.orgId,
        employeeId,
        status: { in: [...BLOCKING] },
        startDate: { lte: toDate(input.endDate) },
        endDate: { gte: toDate(input.startDate) },
        ...(exceptId ? { id: { not: exceptId } } : {}),
      },
      select: { startDate: true, endDate: true },
    });
    if (overlap) {
      throw new ConflictException(
        `You already have a request covering ${displayDate(dateKeyOf(overlap.startDate))} to ${displayDate(dateKeyOf(overlap.endDate))}`,
      );
    }

    const { cap, weekStartsOn } = await this.policyFor(claims.orgId, employeeId);
    const held = await this.heldDays(claims.orgId, employeeId, workingDays, weekStartsOn, exceptId);
    const breaches = capBreaches(workingDays, held, cap, weekStartsOn);
    if (breaches.length > 0) throw new BadRequestException(this.breachMessage(breaches));

    return workingDays;
  }

  /** Names the week and the count. "Over your limit" sends nobody anywhere. */
  private breachMessage(breaches: { weekKey: string; would: number; cap: number }[]): string {
    const first = breaches[0] as { weekKey: string; would: number; cap: number };
    const allowance =
      first.cap === 0
        ? 'no remote days'
        : `${first.cap} remote day${first.cap === 1 ? '' : 's'} a week`;
    return `That would be ${first.would} in the week of ${displayDate(first.weekKey)}, and you have ${allowance}`;
  }

  /** An employee record is not a login; only some of them have one. */
  private async usersOf(employeeIds: (string | null | undefined)[]): Promise<string[]> {
    const ids = employeeIds.filter((v): v is string => Boolean(v));
    if (ids.length === 0) return [];
    const rows = await this.prisma.employee.findMany({
      where: { id: { in: ids }, userId: { not: null } },
      select: { userId: true },
    });
    return rows.map((row) => row.userId as string);
  }

  private async require(orgId: string, id: string) {
    const request = await this.prisma.remoteWorkRequest.findFirst({
      where: { id, organizationId: orgId },
    });
    if (!request) throw new NotFoundException('Request not found');
    return request;
  }

  private async tellApprover(request: {
    employeeId: string;
    employee: { managerId: string | null };
  }) {
    // Their manager, if they have one. Somebody with none is left to whoever
    // holds the org-wide code, which is the inbox they already watch.
    if (!request.employee.managerId) return;
    await this.notifications.notify(await this.usersOf([request.employee.managerId]), {
      type: 'wfh.requested',
      title: 'A remote-work request needs you',
      body: 'Waiting on your decision.',
      linkPath: '/attendance/remote',
    });
  }

  private scopeWhere(
    claims: AccessTokenClaims,
    scope: WfhQuery['scope'],
    perms: Set<string>,
  ): Prisma.RemoteWorkRequestWhereInput {
    if (scope === 'own') return { employeeId: claims.employeeId ?? '__none__' };
    if (scope === 'inbox') {
      return perms.has('wfh.approve')
        ? { employee: { deletedAt: null } }
        : { employee: { managerId: claims.employeeId ?? '__none__' } };
    }
    return perms.has('wfh.read')
      ? { employee: { deletedAt: null } }
      : { employee: { managerId: claims.employeeId ?? '__none__' } };
  }
}
