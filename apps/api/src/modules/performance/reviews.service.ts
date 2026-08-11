import type {
  ReviewAcknowledgeInput,
  ReviewManagerInput,
  ReviewNoteInput,
  ReviewQuery,
  ReviewReassignInput,
  ReviewSelfInput,
  ReviewStatusCode,
} from '@hrms/shared';
import type { AccessTokenClaims } from '@hrms/types';
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { auditMutation } from '../../common/utils/audit';
import { dateKeyOf } from '../../common/utils/calendar';
import { toPaginated } from '../../common/utils/list-query';
import { PrismaService } from '../../database/prisma.service';
import type { Prisma } from '../../generated/prisma/client';
import { NotificationsService } from '../notifications/notifications.service';
import { goalSummary, mapGoal, mapReview } from './performance.mapper';
import {
  managerSubmissionProblems,
  nextStatus,
  type ReviewAction,
  reviewError,
  selfSubmissionProblems,
} from './performance.rules';

const INCLUDE = {
  employee: {
    select: {
      id: true,
      firstName: true,
      lastName: true,
      employeeCode: true,
      department: { select: { name: true } },
    },
  },
  reviewer: { select: { id: true, firstName: true, lastName: true } },
  cycle: true,
} as const satisfies Prisma.PerformanceReviewInclude;

@Injectable()
export class ReviewsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  private today(): string {
    return dateKeyOf(new Date());
  }

  /**
   * Which reviews this token may see.
   *
   * `team` resolves on **`reviewerId`**, not on the current reporting line —
   * that is the snapshot doing its job. A manager who inherits a report
   * mid-cycle does not silently acquire a half-written review about somebody
   * they have not worked with; they get them on the next cycle. Goals do the
   * opposite, and deliberately: see `GoalsService.scopeWhere`.
   */
  private scopeWhere(
    claims: AccessTokenClaims,
    scope: 'own' | 'team' | 'all',
  ): Prisma.PerformanceReviewWhereInput {
    const perms = new Set(claims.perms);
    if (scope === 'all' && perms.has('performance.read')) return {};
    if (scope === 'team' && (perms.has('performance.read.team') || perms.has('performance.read'))) {
      return { reviewerId: claims.employeeId ?? '__none__' };
    }
    return { employeeId: claims.employeeId ?? '__none__' };
  }

  async list(claims: AccessTokenClaims, query: ReviewQuery) {
    const where: Prisma.PerformanceReviewWhereInput = {
      organizationId: claims.orgId,
      ...(query.cycleId ? { cycleId: query.cycleId } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.employeeId ? { employeeId: query.employeeId } : {}),
      ...this.scopeWhere(claims, query.scope),
      ...(query.awaitingMe === 'true' ? { status: 'PENDING_MANAGER' as const } : {}),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.performanceReview.findMany({
        where,
        include: INCLUDE,
        orderBy: [{ createdAt: 'desc' }],
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      this.prisma.performanceReview.count({ where }),
    ]);
    const todayKey = this.today();
    return toPaginated(
      rows.map((row) => mapReview(row, claims, todayKey)),
      total,
      query,
    );
  }

  /**
   * One review, if this caller may see it at all.
   *
   * Not found rather than forbidden when they may not: whether a review exists
   * is itself information about somebody's standing, and a 403 confirms it
   * where a 404 does not. Same rule expenses and documents follow.
   */
  private async require(claims: AccessTokenClaims, id: string) {
    const perms = new Set(claims.perms);
    const visible: Prisma.PerformanceReviewWhereInput = perms.has('performance.read')
      ? {}
      : {
          OR: [
            { employeeId: claims.employeeId ?? '__none__' },
            { reviewerId: claims.employeeId ?? '__none__' },
          ],
        };
    const row = await this.prisma.performanceReview.findFirst({
      where: { id, organizationId: claims.orgId, ...visible },
      include: INCLUDE,
    });
    if (!row) throw new NotFoundException('Review not found');
    return row;
  }

  async get(claims: AccessTokenClaims, id: string) {
    const row = await this.require(claims, id);
    const goals = await this.prisma.performanceGoal.findMany({
      where: { cycleId: row.cycleId, employeeId: row.employeeId },
      orderBy: { createdAt: 'asc' },
    });
    const todayKey = this.today();
    return {
      ...mapReview(row, claims, todayKey),
      goals: goals.map((goal) => mapGoal(goal, todayKey)),
      goalSummary: goalSummary(goals),
    };
  }

  /** Every transition goes through here, so the machine is consulted exactly once. */
  private assertCan(status: string, action: ReviewAction): ReviewStatusCode {
    const next = nextStatus(status as ReviewStatusCode, action);
    if (!next) throw new BadRequestException(reviewError(status as ReviewStatusCode, action));
    return next;
  }

  private assertIsSubject(claims: AccessTokenClaims, employeeId: string) {
    if (employeeId !== claims.employeeId) {
      throw new ForbiddenException('This is not your review');
    }
  }

  /**
   * Who may write the manager half: the named reviewer, or — when there is
   * none, which happens for whoever is at the top of the chart — somebody
   * holding `performance.manage`.
   */
  private assertIsReviewer(claims: AccessTokenClaims, review: { reviewerId: string | null }) {
    const perms = new Set(claims.perms);
    if (review.reviewerId && review.reviewerId === claims.employeeId) return;
    if (!review.reviewerId && perms.has('performance.manage')) return;
    throw new ForbiddenException('This review is not yours to write');
  }

  async saveSelf(claims: AccessTokenClaims, id: string, input: ReviewSelfInput) {
    const review = await this.require(claims, id);
    this.assertIsSubject(claims, review.employeeId);
    this.assertCan(review.status, 'saveSelf');

    const row = await this.prisma.performanceReview.update({
      where: { id },
      data: {
        selfRating: input.selfRating ?? null,
        selfComment: input.selfComment ?? null,
      },
      include: INCLUDE,
    });
    return mapReview(row, claims, this.today());
  }

  async submitSelf(claims: AccessTokenClaims, id: string, input: ReviewSelfInput) {
    const review = await this.require(claims, id);
    this.assertIsSubject(claims, review.employeeId);
    const next = this.assertCan(review.status, 'submitSelf');

    const goals = await this.prisma.performanceGoal.findMany({
      where: { cycleId: review.cycleId, employeeId: review.employeeId },
      select: { weight: true },
    });
    const problems = selfSubmissionProblems(
      { selfRating: input.selfRating ?? null, selfComment: input.selfComment ?? null },
      goals,
    );
    if (problems.length) throw new BadRequestException(problems.join(' '));

    const row = await this.prisma.performanceReview.update({
      where: { id },
      data: {
        selfRating: input.selfRating ?? null,
        selfComment: input.selfComment ?? null,
        selfSubmittedAt: new Date(),
        status: next,
      },
      include: INCLUDE,
    });
    await auditMutation(
      this.prisma,
      { orgId: claims.orgId, userId: claims.sub },
      'performance.review.self_submit',
      'PerformanceReview',
      id,
    );
    await this.tellReviewer(claims, row);
    return mapReview(row, claims, this.today());
  }

  /**
   * Tell whoever has to answer it. When nobody is named — the top of the chart,
   * or a manager who has since left — this falls to whoever can assign one,
   * rather than the review sitting silently on nobody's desk.
   */
  private async tellReviewer(
    claims: AccessTokenClaims,
    review: {
      id: string;
      reviewerId: string | null;
      employee: { firstName: string; lastName: string };
    },
  ) {
    const who = `${review.employee.firstName} ${review.employee.lastName}`;
    const input = {
      type: 'performance.self.submitted',
      title: `${who} submitted their self-assessment`,
      body: 'Your half of the review is next.',
      linkPath: `/performance/reviews/${review.id}`,
    };
    if (!review.reviewerId) {
      await this.notifications.notifyPermission(claims.orgId, 'performance.manage', {
        ...input,
        title: `${who} submitted a self-assessment with no reviewer`,
        body: 'Nobody is assigned to answer it — assign a reviewer to move it on.',
      });
      return;
    }
    const reviewer = await this.prisma.employee.findUnique({
      where: { id: review.reviewerId },
      select: { userId: true },
    });
    if (reviewer?.userId) await this.notifications.notify([reviewer.userId], input);
  }

  /** HR moves past a self-assessment nobody is ever going to write. */
  async skipSelf(claims: AccessTokenClaims, id: string, input: ReviewNoteInput) {
    const review = await this.require(claims, id);
    const next = this.assertCan(review.status, 'skipSelf');
    const row = await this.prisma.performanceReview.update({
      where: { id },
      data: { status: next, reopenNote: input.note },
      include: INCLUDE,
    });
    await auditMutation(
      this.prisma,
      { orgId: claims.orgId, userId: claims.sub },
      'performance.review.skip_self',
      'PerformanceReview',
      id,
      { note: input.note },
    );
    await this.tellReviewer(claims, row);
    return mapReview(row, claims, this.today());
  }

  async saveManager(claims: AccessTokenClaims, id: string, input: ReviewManagerInput) {
    const review = await this.require(claims, id);
    this.assertIsReviewer(claims, review);
    this.assertCan(review.status, 'saveManager');

    const row = await this.prisma.performanceReview.update({
      where: { id },
      data: {
        managerRating: input.managerRating ?? null,
        managerComment: input.managerComment ?? null,
        managerActions: input.managerActions ?? null,
      },
      include: INCLUDE,
    });
    return mapReview(row, claims, this.today());
  }

  async share(claims: AccessTokenClaims, id: string, input: ReviewManagerInput) {
    const review = await this.require(claims, id);
    this.assertIsReviewer(claims, review);
    /*
     * Cannot arise from `open`, which never names somebody as their own
     * reviewer — but the guard is one comparison and the alternative is
     * trusting a data invariant nothing enforces. Same call expenses makes
     * about approving your own claim.
     */
    if (review.employeeId === claims.employeeId) {
      throw new ForbiddenException('You cannot write your own review');
    }
    const next = this.assertCan(review.status, 'share');

    const problems = managerSubmissionProblems({
      managerRating: input.managerRating ?? null,
      managerComment: input.managerComment ?? null,
    });
    if (problems.length) throw new BadRequestException(problems.join(' '));

    const row = await this.prisma.performanceReview.update({
      where: { id },
      data: {
        managerRating: input.managerRating ?? null,
        managerComment: input.managerComment ?? null,
        managerActions: input.managerActions ?? null,
        managerSubmittedAt: new Date(),
        sharedAt: new Date(),
        status: next,
      },
      include: INCLUDE,
    });
    await auditMutation(
      this.prisma,
      { orgId: claims.orgId, userId: claims.sub },
      'performance.review.share',
      'PerformanceReview',
      id,
      { after: { managerRating: row.managerRating } },
    );

    const employee = await this.prisma.employee.findUnique({
      where: { id: row.employeeId },
      select: { userId: true },
    });
    if (employee?.userId) {
      await this.notifications.notify([employee.userId], {
        type: 'performance.review.shared',
        title: 'Your review is ready to read',
        body: 'Have a look, and sign it off when you have.',
        linkPath: `/performance/reviews/${id}`,
      });
    }
    return mapReview(row, claims, this.today());
  }

  async acknowledge(claims: AccessTokenClaims, id: string, input: ReviewAcknowledgeInput) {
    const review = await this.require(claims, id);
    this.assertIsSubject(claims, review.employeeId);
    const next = this.assertCan(review.status, 'acknowledge');

    const row = await this.prisma.performanceReview.update({
      where: { id },
      data: { status: next, acknowledgedAt: new Date(), acknowledgeNote: input.note ?? null },
      include: INCLUDE,
    });
    await auditMutation(
      this.prisma,
      { orgId: claims.orgId, userId: claims.sub },
      'performance.review.acknowledge',
      'PerformanceReview',
      id,
    );
    if (row.reviewerId) {
      const reviewer = await this.prisma.employee.findUnique({
        where: { id: row.reviewerId },
        select: { userId: true },
      });
      if (reviewer?.userId) {
        await this.notifications.notify([reviewer.userId], {
          type: 'performance.review.acknowledged',
          title: `${row.employee.firstName} ${row.employee.lastName} signed off their review`,
          linkPath: `/performance/reviews/${id}`,
        });
      }
    }
    return mapReview(row, claims, this.today());
  }

  async reopen(claims: AccessTokenClaims, id: string, input: ReviewNoteInput) {
    const review = await this.require(claims, id);
    const next = this.assertCan(review.status, 'reopen');
    const row = await this.prisma.performanceReview.update({
      where: { id },
      data: {
        status: next,
        reopenNote: input.note,
        // Cleared, because they describe a review that is no longer finished.
        // The audit row is what remembers that it once was.
        sharedAt: null,
        acknowledgedAt: null,
        acknowledgeNote: null,
      },
      include: INCLUDE,
    });
    await auditMutation(
      this.prisma,
      { orgId: claims.orgId, userId: claims.sub },
      'performance.review.reopen',
      'PerformanceReview',
      id,
      { before: { status: review.status }, note: input.note },
    );
    return mapReview(row, claims, this.today());
  }

  async cancel(claims: AccessTokenClaims, id: string, input: ReviewNoteInput) {
    const review = await this.require(claims, id);
    const next = this.assertCan(review.status, 'cancel');
    const row = await this.prisma.performanceReview.update({
      where: { id },
      data: { status: next, cancelNote: input.note },
      include: INCLUDE,
    });
    await auditMutation(
      this.prisma,
      { orgId: claims.orgId, userId: claims.sub },
      'performance.review.cancel',
      'PerformanceReview',
      id,
      { before: { status: review.status }, note: input.note },
    );
    return mapReview(row, claims, this.today());
  }

  /**
   * Give a review a different reviewer.
   *
   * This is the answer to both cases that would otherwise strand a review — the
   * top of the chart having no manager, and a manager leaving mid-cycle — and
   * it is deliberately the answer rather than letting HR type into the manager's
   * box. "Your manager wrote this" has to stay true.
   */
  async reassign(claims: AccessTokenClaims, id: string, input: ReviewReassignInput) {
    const review = await this.require(claims, id);
    if (review.status === 'CANCELLED') {
      throw new BadRequestException('This review was dropped. Reopening it is not possible.');
    }
    if (input.reviewerId === review.employeeId) {
      throw new BadRequestException('Somebody cannot be their own reviewer');
    }
    const reviewer = await this.prisma.employee.findFirst({
      where: { id: input.reviewerId, organizationId: claims.orgId },
      select: { id: true, userId: true },
    });
    if (!reviewer) throw new NotFoundException('Employee not found');

    const row = await this.prisma.performanceReview.update({
      where: { id },
      data: { reviewerId: reviewer.id },
      include: INCLUDE,
    });
    await auditMutation(
      this.prisma,
      { orgId: claims.orgId, userId: claims.sub },
      'performance.review.reassign',
      'PerformanceReview',
      id,
      {
        before: { reviewerId: review.reviewerId },
        after: { reviewerId: reviewer.id },
        note: input.note,
      },
    );
    if (reviewer.userId && row.status === 'PENDING_MANAGER') {
      await this.notifications.notify([reviewer.userId], {
        type: 'performance.review.reassigned',
        title: `You have been asked to review ${row.employee.firstName} ${row.employee.lastName}`,
        linkPath: `/performance/reviews/${id}`,
      });
    }
    return mapReview(row, claims, this.today());
  }
}
