import type { GoalCreateInput, GoalQuery, GoalStatusCode, GoalUpdateInput } from '@hrms/shared';
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
import { NotificationsService } from '../notifications/notifications.service';
import { mapGoal } from './performance.mapper';
import { canEditGoal, goalEditError } from './performance.rules';

const INCLUDE = {
  employee: { select: { id: true, firstName: true, lastName: true, employeeCode: true } },
} as const satisfies Prisma.PerformanceGoalInclude;

@Injectable()
export class GoalsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  private today(): string {
    return dateKeyOf(new Date());
  }

  /**
   * Which goals this token may see.
   *
   * `'__none__'` for a caller with no employee record is the sentinel every
   * scoped list here uses: it matches nothing, where `undefined` would have
   * silently matched everything.
   *
   * Note `team` resolves on `employee.managerId` — **live**, unlike reviews,
   * which resolve on the reviewer snapshot. A goal is a forward-looking thing
   * and the current manager is the right person to see it; a review is a record
   * of a conversation and belongs to whoever was there. Do not "fix" this into
   * agreeing with reviews.
   */
  private scopeWhere(
    claims: AccessTokenClaims,
    scope: 'own' | 'team' | 'all',
  ): Prisma.PerformanceGoalWhereInput {
    const perms = new Set(claims.perms);
    if (scope === 'all' && perms.has('performance.read')) return {};
    if (scope === 'team' && (perms.has('performance.read.team') || perms.has('performance.read'))) {
      return { employee: { managerId: claims.employeeId ?? '__none__' } };
    }
    return { employeeId: claims.employeeId ?? '__none__' };
  }

  /** Whether this caller may write goals for that employee. */
  private async assertMayWriteFor(claims: AccessTokenClaims, employeeId: string) {
    if (employeeId === claims.employeeId) return;

    const perms = new Set(claims.perms);
    if (!perms.has('performance.goal.team')) {
      throw new ForbiddenException('You can only set your own goals');
    }
    const employee = await this.prisma.employee.findFirst({
      where: { id: employeeId, organizationId: claims.orgId },
      select: { managerId: true },
    });
    // 404 rather than 403 for a stranger: whether somebody works here is not
    // something an error message should confirm.
    if (!employee) throw new NotFoundException('Employee not found');
    if (employee.managerId !== claims.employeeId && !perms.has('performance.read')) {
      throw new ForbiddenException('You can only set goals for the people who report to you');
    }
  }

  async list(claims: AccessTokenClaims, query: GoalQuery) {
    const where: Prisma.PerformanceGoalWhereInput = {
      organizationId: claims.orgId,
      ...(query.cycleId ? { cycleId: query.cycleId } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.employeeId ? { employeeId: query.employeeId } : {}),
      ...this.scopeWhere(claims, query.scope),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.performanceGoal.findMany({
        where,
        include: INCLUDE,
        orderBy: [{ createdAt: 'asc' }],
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      this.prisma.performanceGoal.count({ where }),
    ]);
    const todayKey = this.today();
    return toPaginated(
      rows.map((row) => mapGoal(row, todayKey)),
      total,
      query,
    );
  }

  private async require(claims: AccessTokenClaims, id: string) {
    const row = await this.prisma.performanceGoal.findFirst({
      where: { id, organizationId: claims.orgId, ...this.scopeWhere(claims, 'all') },
      include: { ...INCLUDE, cycle: { select: { status: true } } },
    });
    if (row) return row;

    // Fall back to the caller's own scope, so a goal they may genuinely read is
    // still found when they do not hold the org-wide code.
    const scoped = await this.prisma.performanceGoal.findFirst({
      where: {
        id,
        organizationId: claims.orgId,
        OR: [
          { employeeId: claims.employeeId ?? '__none__' },
          { employee: { managerId: claims.employeeId ?? '__none__' } },
        ],
      },
      include: { ...INCLUDE, cycle: { select: { status: true } } },
    });
    if (!scoped) throw new NotFoundException('Goal not found');
    return scoped;
  }

  async get(claims: AccessTokenClaims, id: string) {
    return mapGoal(await this.require(claims, id), this.today());
  }

  async create(claims: AccessTokenClaims, input: GoalCreateInput) {
    const employeeId = input.employeeId ?? claims.employeeId;
    if (!employeeId) {
      throw new BadRequestException('No employee record is linked to this account');
    }
    await this.assertMayWriteFor(claims, employeeId);

    const cycle = await this.prisma.reviewCycle.findFirst({
      where: { id: input.cycleId, organizationId: claims.orgId },
      select: { id: true, status: true },
    });
    if (!cycle) throw new NotFoundException('Review cycle not found');
    if (cycle.status !== 'OPEN') {
      throw new BadRequestException(
        cycle.status === 'DRAFT'
          ? 'That cycle has not opened yet, so there is nothing to set goals against.'
          : 'That cycle is closed. Its goals are a record of what happened and cannot change.',
      );
    }

    const row = await this.prisma.performanceGoal.create({
      data: {
        organizationId: claims.orgId,
        cycleId: input.cycleId,
        employeeId,
        title: input.title,
        description: input.description ?? null,
        target: input.target ?? null,
        progress: input.progress,
        weight: input.weight,
        status: input.status,
        dueOn: input.dueOn ? toDate(input.dueOn) : null,
        createdById: claims.sub,
      },
      include: INCLUDE,
    });
    await auditMutation(
      this.prisma,
      { orgId: claims.orgId, userId: claims.sub },
      'performance.goal.create',
      'PerformanceGoal',
      row.id,
    );

    // Only when somebody else wrote it. A bell for a goal you just typed
    // yourself is noise, and this module has enough of those to be careful.
    if (employeeId !== claims.employeeId) await this.tellEmployee(employeeId, row.title);

    return mapGoal(row, this.today());
  }

  private async tellEmployee(employeeId: string, title: string) {
    const employee = await this.prisma.employee.findUnique({
      where: { id: employeeId },
      select: { userId: true },
    });
    if (!employee?.userId) return;
    await this.notifications.notify([employee.userId], {
      type: 'performance.goal.assigned',
      title: 'A goal was added to your review',
      body: title,
      linkPath: '/performance',
    });
  }

  async update(claims: AccessTokenClaims, id: string, input: GoalUpdateInput) {
    const existing = await this.require(claims, id);
    await this.assertMayWriteFor(claims, existing.employeeId);
    if (!canEditGoal(existing.cycle.status as never, existing.status as GoalStatusCode)) {
      throw new BadRequestException(goalEditError(existing.cycle.status as never));
    }

    const row = await this.prisma.performanceGoal.update({
      where: { id },
      data: {
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.description !== undefined ? { description: input.description ?? null } : {}),
        ...(input.target !== undefined ? { target: input.target ?? null } : {}),
        ...(input.progress !== undefined ? { progress: input.progress } : {}),
        ...(input.weight !== undefined ? { weight: input.weight } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
        ...(input.dueOn !== undefined ? { dueOn: input.dueOn ? toDate(input.dueOn) : null } : {}),
      },
      include: INCLUDE,
    });
    await auditMutation(
      this.prisma,
      { orgId: claims.orgId, userId: claims.sub },
      'performance.goal.update',
      'PerformanceGoal',
      id,
      { before: { progress: existing.progress, weight: existing.weight }, after: input },
    );
    return mapGoal(row, this.today());
  }

  async remove(claims: AccessTokenClaims, id: string) {
    const existing = await this.require(claims, id);
    await this.assertMayWriteFor(claims, existing.employeeId);
    if (!canEditGoal(existing.cycle.status as never, existing.status as GoalStatusCode)) {
      throw new BadRequestException(goalEditError(existing.cycle.status as never));
    }
    await this.prisma.performanceGoal.delete({ where: { id } });
    await auditMutation(
      this.prisma,
      { orgId: claims.orgId, userId: claims.sub },
      'performance.goal.delete',
      'PerformanceGoal',
      id,
    );
    return { id };
  }
}
