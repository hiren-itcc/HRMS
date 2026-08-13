import type {
  TimesheetDecisionInput,
  TimesheetQuery,
  TimesheetStatusCode,
  TimesheetWeekInput,
} from '@hrms/shared';
import type { AccessTokenClaims } from '@hrms/types';
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { auditMutation } from '../../common/utils/audit';
import { toDate } from '../../common/utils/calendar';
import { toPaginated } from '../../common/utils/list-query';
import { PrismaService } from '../../database/prisma.service';
import type { Prisma } from '../../generated/prisma/client';
import { NotificationsService } from '../notifications/notifications.service';
import { dateKey, hoursOf, mapTimesheet } from './projects.mapper';
import {
  canDecide,
  canEdit,
  canSubmit,
  canWithdraw,
  decisionError,
  editError,
  isWeekStart,
  submissionProblems,
  weekDays,
  weekStartOf,
} from './projects.rules';

const PERSON = { id: true, firstName: true, lastName: true, employeeCode: true } as const;

const INCLUDE = {
  entries: {
    include: { project: { select: { id: true, code: true, name: true, status: true } } },
    orderBy: [{ workedOn: 'asc' }],
  },
  employee: { select: PERSON },
} as const satisfies Prisma.TimesheetInclude;

@Injectable()
export class TimesheetsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  private requireEmployee(claims: AccessTokenClaims): string {
    if (!claims.employeeId) {
      throw new BadRequestException('No employee record is linked to this account');
    }
    return claims.employeeId;
  }

  /**
   * Which weeks this token may see.
   *
   * `'__none__'` for somebody with no employee record is the sentinel every
   * other scoped list uses: it matches nothing, where `undefined` would have
   * silently matched everything.
   */
  private scopeWhere(
    claims: AccessTokenClaims,
    scope: 'own' | 'team' | 'all',
  ): Prisma.TimesheetWhereInput {
    const perms = new Set(claims.perms);
    if (scope === 'all' && perms.has('timesheet.read')) return {};
    if (
      scope === 'team' &&
      (perms.has('timesheet.read.team') ||
        perms.has('timesheet.approve.team') ||
        perms.has('timesheet.read'))
    ) {
      return { employee: { managerId: claims.employeeId ?? '__none__' } };
    }
    return { employeeId: claims.employeeId ?? '__none__' };
  }

  async list(claims: AccessTokenClaims, query: TimesheetQuery) {
    const where: Prisma.TimesheetWhereInput = {
      organizationId: claims.orgId,
      ...(query.status ? { status: query.status } : {}),
      ...(query.employeeId ? { employeeId: query.employeeId } : {}),
      ...(query.from || query.to
        ? {
            weekStart: {
              ...(query.from ? { gte: toDate(query.from) } : {}),
              ...(query.to ? { lte: toDate(query.to) } : {}),
            },
          }
        : {}),
      ...this.scopeWhere(claims, query.scope),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.timesheet.findMany({
        where,
        include: INCLUDE,
        orderBy: [{ weekStart: 'desc' }],
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      this.prisma.timesheet.count({ where }),
    ]);
    return toPaginated(rows.map(mapTimesheet), total, query);
  }

  async get(claims: AccessTokenClaims, id: string) {
    return mapTimesheet(await this.readable(claims, id));
  }

  private async readable(claims: AccessTokenClaims, id: string) {
    const row = await this.prisma.timesheet.findFirst({
      where: { id, organizationId: claims.orgId },
      include: INCLUDE,
    });
    if (!row) throw new NotFoundException('Timesheet not found');

    const perms = new Set(claims.perms);
    if (row.employeeId === claims.employeeId || perms.has('timesheet.read')) return row;

    if (perms.has('timesheet.read.team') || perms.has('timesheet.approve.team')) {
      const managed = await this.prisma.employee.findFirst({
        where: { id: row.employeeId, managerId: claims.employeeId ?? '__none__' },
        select: { id: true },
      });
      if (managed) return row;
    }
    // 404 rather than 403: what somebody worked on is theirs, and whether a
    // week exists is already an answer about them.
    throw new NotFoundException('Timesheet not found');
  }

  /**
   * My week, and the projects I may log against in it.
   *
   * Nothing is created here. A GET that writes would leave an empty DRAFT for
   * everybody who ever opened the screen, and `saveWeek` has to handle the
   * not-yet-existing case anyway — so this returns `null` and the grid renders
   * empty. The row appears the first time somebody actually types an hour.
   */
  async week(claims: AccessTokenClaims, weekStartKey: string) {
    const employeeId = this.requireEmployee(claims);
    if (!isWeekStart(weekStartKey)) {
      throw new BadRequestException(
        `A timesheet week runs Monday to Sunday — try ${weekStartOf(weekStartKey)}`,
      );
    }

    const [row, memberships] = await Promise.all([
      this.prisma.timesheet.findUnique({
        where: { employeeId_weekStart: { employeeId, weekStart: toDate(weekStartKey) } },
        include: INCLUDE,
      }),
      this.prisma.projectMember.findMany({
        where: {
          employeeId,
          project: { organizationId: claims.orgId, status: { in: ['ACTIVE', 'ON_HOLD'] } },
        },
        include: {
          project: {
            select: {
              id: true,
              code: true,
              name: true,
              status: true,
              startsOn: true,
              endsOn: true,
            },
          },
        },
        orderBy: { joinedOn: 'asc' },
      }),
    ]);

    return {
      weekStart: weekStartKey,
      days: weekDays(weekStartKey),
      timesheet: row ? mapTimesheet(row) : null,
      projects: memberships.map((member) => ({
        id: member.project.id,
        code: member.project.code,
        name: member.project.name,
        status: member.project.status,
        startsOn: dateKey(member.project.startsOn),
        endsOn: member.project.endsOn ? dateKey(member.project.endsOn) : null,
        joinedOn: dateKey(member.joinedOn),
        leftOn: member.leftOn ? dateKey(member.leftOn) : null,
      })),
    };
  }

  /**
   * The whole week, replaced.
   *
   * A grid is filled as one thing and saved as one thing, so a half-saved week
   * is a state that cannot happen — the same call expense claim lines make.
   *
   * Saving is deliberately more permissive than submitting. This refuses only
   * what would corrupt the row: a non-Monday start, a day outside the week, the
   * same project twice on one day, a project from another organization. Whether
   * the week is *right* — membership windows, closed projects, a 30-hour
   * Tuesday — is `submit`'s question, because a draft is a scratchpad and being
   * blocked mid-thought is how people stop using a timesheet.
   */
  async saveWeek(claims: AccessTokenClaims, input: TimesheetWeekInput) {
    const employeeId = this.requireEmployee(claims);
    if (!isWeekStart(input.weekStart)) {
      throw new BadRequestException(
        `A timesheet week runs Monday to Sunday — try ${weekStartOf(input.weekStart)}`,
      );
    }

    const days = new Set(weekDays(input.weekStart));
    const seen = new Set<string>();
    for (const entry of input.entries) {
      if (!days.has(entry.workedOn)) {
        throw new BadRequestException(
          `${entry.workedOn} is not in the week beginning ${input.weekStart}`,
        );
      }
      const key = `${entry.projectId}:${entry.workedOn}`;
      if (seen.has(key)) {
        throw new BadRequestException('One project has two entries on the same day');
      }
      seen.add(key);
    }

    const projectIds = [...new Set(input.entries.map((entry) => entry.projectId))];
    if (projectIds.length > 0) {
      const found = await this.prisma.project.count({
        where: { organizationId: claims.orgId, id: { in: projectIds } },
      });
      if (found !== projectIds.length) {
        throw new BadRequestException('One of those projects no longer exists');
      }
    }

    const existing = await this.prisma.timesheet.findUnique({
      where: { employeeId_weekStart: { employeeId, weekStart: toDate(input.weekStart) } },
      select: { id: true, status: true },
    });
    if (existing && !canEdit(existing.status as TimesheetStatusCode)) {
      throw new BadRequestException(editError(existing.status as TimesheetStatusCode));
    }

    const entryData = input.entries.map((entry) => ({
      projectId: entry.projectId,
      workedOn: toDate(entry.workedOn),
      hours: entry.hours,
      note: entry.note ?? null,
    }));

    // The unique on (employeeId, weekStart) is what makes this safe against two
    // requests racing to open the same week: they collide rather than producing
    // two sheets each holding half the hours.
    const row = await this.prisma.timesheet.upsert({
      where: { employeeId_weekStart: { employeeId, weekStart: toDate(input.weekStart) } },
      create: {
        organizationId: claims.orgId,
        employeeId,
        weekStart: toDate(input.weekStart),
        entries: { create: entryData },
      },
      update: {
        // A rejected week edited again is a draft again, and the note stays so
        // the person can still read what they were asked to change.
        status: 'DRAFT',
        entries: { deleteMany: {}, create: entryData },
      },
      include: INCLUDE,
    });
    await auditMutation(
      this.prisma,
      { orgId: claims.orgId, userId: claims.sub },
      'timesheet.save',
      'Timesheet',
      row.id,
      { after: { weekStart: input.weekStart, entries: entryData.length } },
    );
    return mapTimesheet(row);
  }

  async submit(claims: AccessTokenClaims, id: string) {
    const row = await this.readable(claims, id);
    if (row.employeeId !== claims.employeeId) {
      throw new ForbiddenException('Only the person who filled a week can submit it');
    }
    if (!canSubmit(row.status as TimesheetStatusCode)) {
      throw new BadRequestException(editError(row.status as TimesheetStatusCode));
    }

    const weekStartKey = dateKey(row.weekStart);
    const projectIds = [...new Set(row.entries.map((entry) => entry.projectId))];
    const [projects, memberships] = await Promise.all([
      this.prisma.project.findMany({
        where: { organizationId: claims.orgId, id: { in: projectIds } },
        select: { id: true, code: true, status: true, startsOn: true, endsOn: true },
      }),
      this.prisma.projectMember.findMany({
        where: { employeeId: row.employeeId, projectId: { in: projectIds } },
        select: { projectId: true, joinedOn: true, leftOn: true },
      }),
    ]);

    const { problems, total } = submissionProblems(
      row.entries.map((entry) => ({
        projectId: entry.projectId,
        workedOn: dateKey(entry.workedOn),
        hours: hoursOf(entry.hours),
      })),
      projects.map((project) => ({
        id: project.id,
        code: project.code,
        status: project.status,
        startsOn: dateKey(project.startsOn),
        endsOn: project.endsOn ? dateKey(project.endsOn) : null,
      })),
      memberships.map((member) => ({
        projectId: member.projectId,
        joinedOn: dateKey(member.joinedOn),
        leftOn: member.leftOn ? dateKey(member.leftOn) : null,
      })),
      weekStartKey,
    );
    // Every problem at once. Being told about one, fixing it, and only then
    // hearing about the next is what makes people abandon a form.
    if (problems.length > 0) throw new BadRequestException(problems.join(' · '));

    const updated = await this.prisma.timesheet.update({
      where: { id },
      data: { status: 'SUBMITTED', submittedAt: new Date() },
      include: INCLUDE,
    });
    await auditMutation(
      this.prisma,
      { orgId: claims.orgId, userId: claims.sub },
      'timesheet.submit',
      'Timesheet',
      id,
      { after: { weekStart: weekStartKey, total } },
    );

    const manager = await this.prisma.employee.findUnique({
      where: { id: row.employeeId },
      select: { manager: { select: { userId: true } } },
    });
    const who = `${row.employee.firstName} ${row.employee.lastName}`;
    await this.notifications.notify(manager?.manager?.userId ? [manager.manager.userId] : [], {
      type: 'timesheet.submitted',
      title: `${who} submitted ${total} hours`,
      body: `Week beginning ${weekStartKey}.`,
      linkPath: '/projects/approvals',
    });
    return mapTimesheet(updated);
  }

  /** Pulling a week back before anybody has decided it. Never a delete. */
  async withdraw(claims: AccessTokenClaims, id: string) {
    const row = await this.readable(claims, id);
    if (row.employeeId !== claims.employeeId) {
      throw new ForbiddenException('Only the person who filled a week can withdraw it');
    }
    if (!canWithdraw(row.status as TimesheetStatusCode)) {
      throw new BadRequestException(editError(row.status as TimesheetStatusCode));
    }
    const updated = await this.prisma.timesheet.update({
      where: { id },
      data: { status: 'DRAFT', submittedAt: null },
      include: INCLUDE,
    });
    await auditMutation(
      this.prisma,
      { orgId: claims.orgId, userId: claims.sub },
      'timesheet.withdraw',
      'Timesheet',
      id,
    );
    return mapTimesheet(updated);
  }

  /**
   * The manager's answer.
   *
   * A rejection must carry a note. Sending a week back without saying why only
   * produces the same week again, and the person filling it has no way to guess
   * which line was wrong.
   */
  async decide(
    claims: AccessTokenClaims,
    id: string,
    decision: 'APPROVED' | 'REJECTED',
    input: TimesheetDecisionInput,
  ) {
    const row = await this.readable(claims, id);
    if (!canDecide(row.status as TimesheetStatusCode)) {
      throw new BadRequestException(decisionError(row.status as TimesheetStatusCode));
    }
    if (row.employeeId === claims.employeeId) {
      throw new ForbiddenException('You cannot decide your own week');
    }
    await this.assertMayDecide(claims, row.employeeId);
    if (decision === 'REJECTED' && !input.note?.trim()) {
      throw new BadRequestException('Say what needs changing before sending a week back');
    }

    const updated = await this.prisma.timesheet.update({
      where: { id },
      data: {
        status: decision,
        decidedById: claims.sub,
        decidedAt: new Date(),
        decisionNote: input.note ?? null,
      },
      include: INCLUDE,
    });
    await auditMutation(
      this.prisma,
      { orgId: claims.orgId, userId: claims.sub },
      `timesheet.${decision.toLowerCase()}`,
      'Timesheet',
      id,
      { after: { note: input.note ?? null } },
    );

    const employee = await this.prisma.employee.findUnique({
      where: { id: row.employeeId },
      select: { userId: true },
    });
    const weekStartKey = dateKey(row.weekStart);
    await this.notifications.notify(employee?.userId ? [employee.userId] : [], {
      type: `timesheet.${decision.toLowerCase()}`,
      title:
        decision === 'APPROVED' ? 'Your timesheet was approved' : 'Your timesheet was sent back',
      body: `Week beginning ${weekStartKey}.${input.note ? ` ${input.note}` : ''}`,
      linkPath: '/projects/timesheet',
    });
    return mapTimesheet(updated);
  }

  private async assertMayDecide(claims: AccessTokenClaims, employeeId: string) {
    if (claims.perms.includes('timesheet.approve.team')) {
      const managed = await this.prisma.employee.findFirst({
        where: { id: employeeId, managerId: claims.employeeId ?? '__none__' },
        select: { id: true },
      });
      if (managed) return;
    }
    throw new ForbiddenException('You cannot decide this week');
  }
}
