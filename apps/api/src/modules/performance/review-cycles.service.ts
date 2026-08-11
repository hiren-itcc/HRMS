import type {
  CycleCloseInput,
  ReviewCycleCreateInput,
  ReviewCycleQuery,
  ReviewCycleStatusCode,
} from '@hrms/shared';
import type { AccessTokenClaims } from '@hrms/types';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { auditMutation } from '../../common/utils/audit';
import { dateKeyOf, toDate } from '../../common/utils/calendar';
import { toPaginated } from '../../common/utils/list-query';
import { PrismaService } from '../../database/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { mapCycle } from './performance.mapper';
import {
  blocksClose,
  canCloseCycle,
  canDeleteCycle,
  canEditCycle,
  canOpenCycle,
  closeProblems,
  cycleCoverage,
  cycleError,
  eligibleFor,
  overlapsExistingCycle,
  periodProblems,
} from './performance.rules';

/**
 * Bounded like `confirmDueProbations` — a company with more employees than this
 * has bigger problems than an unenrolled cycle, and an unbounded read here
 * would be the one query that fell over on a large tenant.
 */
const MAX_ENROL = 2000;

@Injectable()
export class ReviewCyclesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  private today(): string {
    return dateKeyOf(new Date());
  }

  async list(claims: AccessTokenClaims, query: ReviewCycleQuery) {
    const where = {
      organizationId: claims.orgId,
      ...(query.status ? { status: query.status } : {}),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.reviewCycle.findMany({
        where,
        orderBy: [{ periodStart: 'desc' }],
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      this.prisma.reviewCycle.count({ where }),
    ]);
    const todayKey = this.today();
    return toPaginated(
      rows.map((row) => mapCycle(row, todayKey)),
      total,
      query,
    );
  }

  /** The cycle everything defaults to. `null` rather than a 404 — "none open" is an answer. */
  async active(claims: AccessTokenClaims) {
    const row = await this.prisma.reviewCycle.findFirst({
      where: { organizationId: claims.orgId, status: 'OPEN' },
      orderBy: { periodStart: 'desc' },
    });
    return row ? mapCycle(row, this.today()) : null;
  }

  private async require(orgId: string, id: string) {
    const row = await this.prisma.reviewCycle.findFirst({ where: { id, organizationId: orgId } });
    if (!row) throw new NotFoundException('Review cycle not found');
    return row;
  }

  async get(claims: AccessTokenClaims, id: string) {
    const row = await this.require(claims.orgId, id);
    const reviews = await this.prisma.performanceReview.findMany({
      where: { cycleId: id },
      select: { status: true },
    });
    const coverage = cycleCoverage(reviews as { status: never }[]);
    return { ...mapCycle(row, this.today()), coverage };
  }

  private async assertDatesUsable(
    orgId: string,
    input: ReviewCycleCreateInput,
    excludeId?: string,
  ) {
    const problems = periodProblems(
      { periodStart: input.periodStart, periodEnd: input.periodEnd },
      input.dueOn ?? null,
    );
    if (problems.length) throw new BadRequestException(problems.join(' '));

    /*
     * Only live cycles are checked. Two DRAFT cycles covering the same dates is
     * somebody planning two options and picking one, which is not a mistake —
     * and refusing it would make that impossible.
     */
    const live = await this.prisma.reviewCycle.findMany({
      where: {
        organizationId: orgId,
        status: { in: ['OPEN', 'CLOSED'] },
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
      select: { periodStart: true, periodEnd: true },
    });
    const overlaps = overlapsExistingCycle(
      { periodStart: input.periodStart, periodEnd: input.periodEnd },
      live.map((c) => ({
        periodStart: dateKeyOf(c.periodStart),
        periodEnd: dateKeyOf(c.periodEnd),
      })),
    );
    if (overlaps) {
      throw new BadRequestException(
        'Another cycle already covers these dates. Two cycles over one period would ask everybody the same question twice.',
      );
    }
  }

  async create(claims: AccessTokenClaims, input: ReviewCycleCreateInput) {
    await this.assertDatesUsable(claims.orgId, input);
    const row = await this.prisma.reviewCycle.create({
      data: {
        organizationId: claims.orgId,
        name: input.name,
        periodStart: toDate(input.periodStart),
        periodEnd: toDate(input.periodEnd),
        dueOn: input.dueOn ? toDate(input.dueOn) : null,
        minServiceDays: input.minServiceDays,
        createdById: claims.sub,
      },
    });
    await auditMutation(
      this.prisma,
      { orgId: claims.orgId, userId: claims.sub },
      'performance.cycle.create',
      'ReviewCycle',
      row.id,
    );
    return mapCycle(row, this.today());
  }

  async update(claims: AccessTokenClaims, id: string, input: ReviewCycleCreateInput) {
    const existing = await this.require(claims.orgId, id);
    if (!canEditCycle(existing.status as ReviewCycleStatusCode)) {
      throw new BadRequestException(cycleError(existing.status as ReviewCycleStatusCode, 'edit'));
    }
    await this.assertDatesUsable(claims.orgId, input, id);
    const row = await this.prisma.reviewCycle.update({
      where: { id },
      data: {
        name: input.name,
        periodStart: toDate(input.periodStart),
        periodEnd: toDate(input.periodEnd),
        dueOn: input.dueOn ? toDate(input.dueOn) : null,
        minServiceDays: input.minServiceDays,
      },
    });
    await auditMutation(
      this.prisma,
      { orgId: claims.orgId, userId: claims.sub },
      'performance.cycle.update',
      'ReviewCycle',
      id,
    );
    return mapCycle(row, this.today());
  }

  /**
   * Open the cycle, and enrol everybody eligible.
   *
   * Idempotent by construction: `skipDuplicates` against the
   * `(cycleId, employeeId)` unique means re-running enrols whoever has joined
   * since and touches nobody else. That is also how a late joiner gets in — a
   * second `open`, not a special case.
   *
   * `reviewerId` is written **here**, from the reporting line as it stands
   * today, and never read live again. A reorg in April must not hand a
   * half-written H1 review to somebody who has never met the person.
   */
  async open(claims: AccessTokenClaims, id: string) {
    const cycle = await this.require(claims.orgId, id);
    if (!canOpenCycle(cycle.status as ReviewCycleStatusCode)) {
      throw new BadRequestException(cycleError(cycle.status as ReviewCycleStatusCode, 'open'));
    }

    const employees = await this.prisma.employee.findMany({
      where: { organizationId: claims.orgId, status: { notIn: ['ONBOARDING', 'EXITED'] } },
      select: { id: true, status: true, joinDate: true, managerId: true, userId: true },
      take: MAX_ENROL,
    });
    const eligible = eligibleFor(
      employees.map((e) => ({ ...e, joinDate: dateKeyOf(e.joinDate) })),
      { periodEnd: dateKeyOf(cycle.periodEnd), minServiceDays: cycle.minServiceDays },
    );

    const { count } = await this.prisma.performanceReview.createMany({
      data: eligible.map((employee) => ({
        organizationId: claims.orgId,
        cycleId: id,
        employeeId: employee.id,
        reviewerId: employee.managerId,
      })),
      skipDuplicates: true,
    });

    const row = await this.prisma.reviewCycle.update({
      where: { id },
      data: { status: 'OPEN', openedAt: new Date(), closedAt: null },
    });

    await auditMutation(
      this.prisma,
      { orgId: claims.orgId, userId: claims.sub },
      'performance.cycle.open',
      'ReviewCycle',
      id,
      { after: { enrolled: count, eligible: eligible.length, considered: employees.length } },
    );

    /*
     * A bell for everybody, and deliberately no email: `{ email: false }`.
     * Opening a cycle would otherwise send one message per employee in a burst,
     * which is the kind of thing that gets a sending domain rate-limited and
     * teaches people to filter the product's mail.
     */
    const userIds = eligible
      .map((employee) => employees.find((e) => e.id === employee.id)?.userId)
      .filter((userId): userId is string => !!userId);
    await this.notifications.notify(
      userIds,
      {
        type: 'performance.cycle.opened',
        title: `${cycle.name} is open`,
        body: 'Set your goals and, when the time comes, write your self-assessment.',
        linkPath: '/performance',
      },
      { email: false },
    );

    return { ...mapCycle(row, this.today()), enrolled: count };
  }

  async close(claims: AccessTokenClaims, id: string, input: CycleCloseInput) {
    const cycle = await this.require(claims.orgId, id);
    if (!canCloseCycle(cycle.status as ReviewCycleStatusCode)) {
      throw new BadRequestException(cycleError(cycle.status as ReviewCycleStatusCode, 'close'));
    }

    const reviews = await this.prisma.performanceReview.findMany({
      where: { cycleId: id },
      select: { status: true },
    });
    const coverage = cycleCoverage(reviews as { status: never }[]);
    if (blocksClose(coverage) && !input.force) {
      throw new BadRequestException(
        `${closeProblems(coverage).join(' ')} Close anyway if that is genuinely where this ended.`,
      );
    }

    const row = await this.prisma.reviewCycle.update({
      where: { id },
      data: { status: 'CLOSED', closedAt: new Date() },
    });
    await auditMutation(
      this.prisma,
      { orgId: claims.orgId, userId: claims.sub },
      'performance.cycle.close',
      'ReviewCycle',
      id,
      // The coverage goes in the log precisely when it was overridden, so
      // "why does H1 have four unwritten reviews" is answerable later.
      { after: { coverage, forced: input.force } },
    );
    return mapCycle(row, this.today());
  }

  async remove(claims: AccessTokenClaims, id: string) {
    const cycle = await this.require(claims.orgId, id);
    const reviewCount = await this.prisma.performanceReview.count({ where: { cycleId: id } });
    if (!canDeleteCycle(cycle.status as ReviewCycleStatusCode, reviewCount)) {
      throw new BadRequestException(cycleError(cycle.status as ReviewCycleStatusCode, 'delete'));
    }
    await this.prisma.reviewCycle.delete({ where: { id } });
    await auditMutation(
      this.prisma,
      { orgId: claims.orgId, userId: claims.sub },
      'performance.cycle.delete',
      'ReviewCycle',
      id,
    );
    return { id };
  }
}
