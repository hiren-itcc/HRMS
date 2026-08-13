import type {
  ProjectCreateInput,
  ProjectMemberCreateInput,
  ProjectMemberUpdateInput,
  ProjectQuery,
  ProjectUpdateInput,
  UtilisationQuery,
} from '@hrms/shared';
import type { AccessTokenClaims } from '@hrms/types';
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { auditMutation } from '../../common/utils/audit';
import { daysBetween, toDate } from '../../common/utils/calendar';
import { toPaginated } from '../../common/utils/list-query';
import { PrismaService } from '../../database/prisma.service';
import type { Prisma } from '../../generated/prisma/client';
import { hoursOf, mapMember, mapProject } from './projects.mapper';
import {
  capacityHours,
  deleteBlockedReason,
  memberRemovalBlockedReason,
  round2,
  utilisationPercent,
} from './projects.rules';

const PERSON = { id: true, firstName: true, lastName: true, employeeCode: true } as const;

const INCLUDE = {
  manager: { select: PERSON },
  members: {
    include: { employee: { select: PERSON } },
    orderBy: [{ leftOn: 'asc' }, { joinedOn: 'asc' }],
  },
  _count: { select: { members: true, entries: true } },
} as const satisfies Prisma.ProjectInclude;

const LIST_INCLUDE = {
  manager: { select: PERSON },
  _count: { select: { members: true, entries: true } },
} as const satisfies Prisma.ProjectInclude;

/**
 * A utilisation range is bounded because the report aggregates in memory.
 *
 * Prisma's `groupBy` cannot group by a field on a related row, and the grouping
 * this report needs is employee × project — employee lives on `Timesheet`, not
 * on the entry. A year is a generous ceiling for a question nobody asks across
 * more than a quarter.
 */
const MAX_REPORT_DAYS = 366;

@Injectable()
export class ProjectsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Which projects this token may see.
   *
   * `'__none__'` for somebody with no employee record is the same sentinel every
   * other scoped list uses: it matches nothing, where `undefined` would have
   * silently matched everything.
   *
   * There is no `team` scope. "Mine" already means "I am on it or I run it",
   * which is every project a manager has standing in; a project their report is
   * on that they neither run nor work on is not theirs to read.
   */
  private scopeWhere(claims: AccessTokenClaims, scope: 'own' | 'all'): Prisma.ProjectWhereInput {
    if (scope === 'all' && claims.perms.includes('project.read')) return {};
    const me = claims.employeeId ?? '__none__';
    return { OR: [{ managerId: me }, { members: { some: { employeeId: me } } }] };
  }

  async list(claims: AccessTokenClaims, query: ProjectQuery) {
    const where: Prisma.ProjectWhereInput = {
      organizationId: claims.orgId,
      ...(query.status ? { status: query.status } : {}),
      ...(query.search
        ? {
            OR: [
              { code: { contains: query.search, mode: 'insensitive' } },
              { name: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
      ...this.scopeWhere(claims, query.scope),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.project.findMany({
        where,
        include: LIST_INCLUDE,
        orderBy: [{ status: 'asc' }, { startsOn: 'desc' }],
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      this.prisma.project.count({ where }),
    ]);
    return toPaginated(rows.map(mapProject), total, query);
  }

  async get(claims: AccessTokenClaims, id: string) {
    return mapProject(await this.readable(claims, id));
  }

  /** The row, or a 404 — after checking this token is allowed to see it. */
  private async readable(claims: AccessTokenClaims, id: string) {
    const row = await this.prisma.project.findFirst({
      where: { id, organizationId: claims.orgId },
      include: INCLUDE,
    });
    if (!row) throw new NotFoundException('Project not found');

    if (claims.perms.includes('project.read')) return row;
    const me = claims.employeeId ?? '__none__';
    if (row.managerId === me) return row;
    if (row.members.some((member) => member.employeeId === me)) return row;

    // 404 rather than 403, the same rule every other module here follows:
    // whether a project exists is itself information about what the company
    // is working on.
    throw new NotFoundException('Project not found');
  }

  /**
   * Staffing is the one thing a project's own manager may do without holding
   * `project.manage`.
   *
   * The alternative is every membership change routing through HR, which is how
   * a register stops matching reality. Creating and deleting a project still
   * need the permission — those are register-level acts, not staffing.
   */
  private assertMayManage(claims: AccessTokenClaims, project: { managerId: string }) {
    if (claims.perms.includes('project.manage')) return;
    if (project.managerId === claims.employeeId) return;
    throw new ForbiddenException('Only this project’s manager or HR can change it');
  }

  private assertDates(startsOn: string, endsOn: string | null | undefined) {
    if (endsOn && endsOn < startsOn) {
      throw new BadRequestException('The end date is before the start date');
    }
  }

  async create(claims: AccessTokenClaims, input: ProjectCreateInput) {
    this.assertDates(input.startsOn, input.endsOn);
    await this.assertManagerExists(claims.orgId, input.managerId);

    const clash = await this.prisma.project.findFirst({
      where: { organizationId: claims.orgId, code: input.code },
      select: { id: true },
    });
    if (clash) throw new BadRequestException(`A project already uses the code ${input.code}`);

    const row = await this.prisma.project.create({
      data: {
        organizationId: claims.orgId,
        code: input.code,
        name: input.name,
        description: input.description ?? null,
        status: input.status,
        startsOn: toDate(input.startsOn),
        endsOn: input.endsOn ? toDate(input.endsOn) : null,
        managerId: input.managerId,
      },
      include: INCLUDE,
    });
    await auditMutation(
      this.prisma,
      { orgId: claims.orgId, userId: claims.sub },
      'project.create',
      'Project',
      row.id,
      { after: { code: row.code, name: row.name } },
    );
    return mapProject(row);
  }

  private async assertManagerExists(orgId: string, managerId: string) {
    const manager = await this.prisma.employee.findFirst({
      where: { id: managerId, organizationId: orgId },
      select: { id: true },
    });
    if (!manager) throw new BadRequestException('That person is not in this organization');
  }

  async update(claims: AccessTokenClaims, id: string, input: ProjectUpdateInput) {
    const row = await this.readable(claims, id);
    this.assertMayManage(claims, row);

    const startsOn = input.startsOn ?? row.startsOn.toISOString().slice(0, 10);
    const endsOn =
      input.endsOn === undefined ? row.endsOn?.toISOString().slice(0, 10) : input.endsOn;
    this.assertDates(startsOn, endsOn);

    if (input.managerId) await this.assertManagerExists(claims.orgId, input.managerId);
    if (input.code && input.code !== row.code) {
      const clash = await this.prisma.project.findFirst({
        where: { organizationId: claims.orgId, code: input.code, id: { not: id } },
        select: { id: true },
      });
      if (clash) throw new BadRequestException(`A project already uses the code ${input.code}`);
    }

    const updated = await this.prisma.project.update({
      where: { id },
      data: {
        ...(input.code !== undefined ? { code: input.code } : {}),
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.description !== undefined ? { description: input.description ?? null } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
        ...(input.startsOn !== undefined ? { startsOn: toDate(input.startsOn) } : {}),
        ...(input.endsOn !== undefined
          ? { endsOn: input.endsOn ? toDate(input.endsOn) : null }
          : {}),
        ...(input.managerId !== undefined ? { managerId: input.managerId } : {}),
      },
      include: INCLUDE,
    });
    await auditMutation(
      this.prisma,
      { orgId: claims.orgId, userId: claims.sub },
      'project.update',
      'Project',
      id,
      { after: { status: updated.status, name: updated.name } },
    );
    return mapProject(updated);
  }

  /**
   * Deleting the register entry, which is rarer than it sounds.
   *
   * The `_count` pre-flight is not decoration: `TimesheetEntry.projectId` is
   * RESTRICT, so without it the database refuses as a raw Prisma error and the
   * caller gets a 500 with no sentence in it.
   */
  async remove(claims: AccessTokenClaims, id: string) {
    const row = await this.readable(claims, id);
    if (!claims.perms.includes('project.manage')) {
      throw new ForbiddenException('Only HR can delete a project');
    }
    const blocked = deleteBlockedReason(row._count.entries);
    if (blocked) throw new BadRequestException(blocked);

    await this.prisma.project.delete({ where: { id } });
    await auditMutation(
      this.prisma,
      { orgId: claims.orgId, userId: claims.sub },
      'project.delete',
      'Project',
      id,
      { before: { code: row.code, name: row.name } },
    );
    return { id };
  }

  // ── Members ─────────────────────────────────────────────────────────

  async addMember(claims: AccessTokenClaims, projectId: string, input: ProjectMemberCreateInput) {
    const project = await this.readable(claims, projectId);
    this.assertMayManage(claims, project);
    if (input.leftOn && input.leftOn < input.joinedOn) {
      throw new BadRequestException('The leaving date is before the joining date');
    }

    const employee = await this.prisma.employee.findFirst({
      where: { id: input.employeeId, organizationId: claims.orgId },
      select: { id: true },
    });
    if (!employee) throw new BadRequestException('That person is not in this organization');

    const existing = await this.prisma.projectMember.findFirst({
      where: { projectId, employeeId: input.employeeId },
      select: { id: true },
    });
    if (existing) throw new BadRequestException('They are already on this project');

    const row = await this.prisma.projectMember.create({
      data: {
        projectId,
        employeeId: input.employeeId,
        role: input.role ?? null,
        allocation: input.allocation,
        joinedOn: toDate(input.joinedOn),
        leftOn: input.leftOn ? toDate(input.leftOn) : null,
      },
      include: { employee: { select: PERSON } },
    });
    await auditMutation(
      this.prisma,
      { orgId: claims.orgId, userId: claims.sub },
      'project.member.add',
      'ProjectMember',
      row.id,
      { after: { projectId, employeeId: input.employeeId } },
    );
    return mapMember(row);
  }

  async updateMember(claims: AccessTokenClaims, memberId: string, input: ProjectMemberUpdateInput) {
    const member = await this.memberOr404(claims, memberId);
    this.assertMayManage(claims, member.project);

    const joinedOn = input.joinedOn ?? member.joinedOn.toISOString().slice(0, 10);
    const leftOn =
      input.leftOn === undefined ? member.leftOn?.toISOString().slice(0, 10) : input.leftOn;
    if (leftOn && leftOn < joinedOn) {
      throw new BadRequestException('The leaving date is before the joining date');
    }

    const row = await this.prisma.projectMember.update({
      where: { id: memberId },
      data: {
        ...(input.role !== undefined ? { role: input.role ?? null } : {}),
        ...(input.allocation !== undefined ? { allocation: input.allocation } : {}),
        ...(input.joinedOn !== undefined ? { joinedOn: toDate(input.joinedOn) } : {}),
        ...(input.leftOn !== undefined
          ? { leftOn: input.leftOn ? toDate(input.leftOn) : null }
          : {}),
      },
      include: { employee: { select: PERSON } },
    });
    await auditMutation(
      this.prisma,
      { orgId: claims.orgId, userId: claims.sub },
      'project.member.update',
      'ProjectMember',
      memberId,
    );
    return mapMember(row);
  }

  /**
   * Taking somebody off, which is only allowed while they have logged nothing.
   *
   * Once there are hours, the honest record is a leaving date: they were on the
   * project, and deleting the membership would leave those hours belonging to
   * somebody the register says was never there.
   */
  async removeMember(claims: AccessTokenClaims, memberId: string) {
    const member = await this.memberOr404(claims, memberId);
    this.assertMayManage(claims, member.project);

    const logged = await this.prisma.timesheetEntry.count({
      where: {
        projectId: member.projectId,
        timesheet: { employeeId: member.employeeId },
      },
    });
    const blocked = memberRemovalBlockedReason(logged);
    if (blocked) throw new BadRequestException(blocked);

    await this.prisma.projectMember.delete({ where: { id: memberId } });
    await auditMutation(
      this.prisma,
      { orgId: claims.orgId, userId: claims.sub },
      'project.member.remove',
      'ProjectMember',
      memberId,
      { before: { projectId: member.projectId, employeeId: member.employeeId } },
    );
    return { id: memberId };
  }

  private async memberOr404(claims: AccessTokenClaims, memberId: string) {
    const member = await this.prisma.projectMember.findFirst({
      where: { id: memberId, project: { organizationId: claims.orgId } },
      include: { project: { select: { id: true, managerId: true } } },
    });
    if (!member) throw new NotFoundException('Project member not found');
    return member;
  }

  // ── Utilisation ─────────────────────────────────────────────────────

  /**
   * Hours per person per project over a range, and what that is of capacity.
   *
   * DRAFT and REJECTED weeks are excluded. A utilisation figure built from hours
   * nobody has stood behind is a figure that changes when somebody finally opens
   * their timesheet, and the report is read as if it were settled.
   */
  async utilisation(claims: AccessTokenClaims, query: UtilisationQuery) {
    if (query.to < query.from) throw new BadRequestException('The end date is before the start');
    const days = daysBetween(query.from, query.to) + 1;
    if (days > MAX_REPORT_DAYS) {
      throw new BadRequestException('Choose a range of a year or less');
    }

    const rows = await this.prisma.timesheetEntry.findMany({
      where: {
        workedOn: { gte: toDate(query.from), lte: toDate(query.to) },
        ...(query.projectId ? { projectId: query.projectId } : {}),
        timesheet: {
          organizationId: claims.orgId,
          status: { in: ['SUBMITTED', 'APPROVED'] },
        },
      },
      select: {
        hours: true,
        projectId: true,
        project: { select: { code: true, name: true } },
        timesheet: { select: { employeeId: true, employee: { select: PERSON } } },
      },
    });

    const cells = new Map<
      string,
      {
        employeeId: string;
        employee: { id: string; firstName: string; lastName: string; employeeCode: string };
        projectId: string;
        projectCode: string;
        projectName: string;
        hours: number;
      }
    >();
    const perEmployee = new Map<
      string,
      {
        employeeId: string;
        employee: { id: string; firstName: string; lastName: string; employeeCode: string };
        hours: number;
      }
    >();
    const perProject = new Map<
      string,
      { projectId: string; code: string; name: string; hours: number }
    >();

    for (const row of rows) {
      const hours = hoursOf(row.hours);
      const employeeId = row.timesheet.employeeId;
      const key = `${employeeId}:${row.projectId}`;

      const cell = cells.get(key);
      if (cell) cell.hours = round2(cell.hours + hours);
      else
        cells.set(key, {
          employeeId,
          employee: row.timesheet.employee,
          projectId: row.projectId,
          projectCode: row.project.code,
          projectName: row.project.name,
          hours,
        });

      const person = perEmployee.get(employeeId);
      if (person) person.hours = round2(person.hours + hours);
      else perEmployee.set(employeeId, { employeeId, employee: row.timesheet.employee, hours });

      const project = perProject.get(row.projectId);
      if (project) project.hours = round2(project.hours + hours);
      else
        perProject.set(row.projectId, {
          projectId: row.projectId,
          code: row.project.code,
          name: row.project.name,
          hours,
        });
    }

    const weeks = days / 7;
    const capacity = capacityHours(weeks);
    const byEmployee = [...perEmployee.values()]
      .map((person) => ({ ...person, utilisation: utilisationPercent(person.hours, capacity) }))
      .sort((a, b) => b.hours - a.hours);

    return {
      from: query.from,
      to: query.to,
      days,
      capacityHours: capacity,
      totalHours: round2([...perProject.values()].reduce((sum, p) => sum + p.hours, 0)),
      rows: [...cells.values()].sort((a, b) => b.hours - a.hours),
      byEmployee,
      byProject: [...perProject.values()].sort((a, b) => b.hours - a.hours),
    };
  }
}
