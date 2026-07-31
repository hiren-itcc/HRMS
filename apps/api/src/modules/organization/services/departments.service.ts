import type { DepartmentCreateInput, DepartmentUpdateInput, PaginationQuery } from '@hrms/shared';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { buildListArgs, searchWhere, toPaginated } from '../../../common/utils/list-query';
import { PrismaService } from '../../../database/prisma.service';
import type { OrgCtx } from '../org-context';
import { auditOrgMutation } from './audit.helper';

const SORTABLE = ['name', 'code'] as const;
const INCLUDE = {
  parent: { select: { id: true, name: true } },
  _count: { select: { children: true, employees: true } },
} as const;

@Injectable()
export class DepartmentsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(orgId: string, query: PaginationQuery) {
    const where = { organizationId: orgId, ...searchWhere(query.search, ['name', 'code']) };
    const [data, total] = await this.prisma.$transaction([
      this.prisma.department.findMany({
        where,
        include: INCLUDE,
        ...buildListArgs(query, SORTABLE, 'name'),
      }),
      this.prisma.department.count({ where }),
    ]);
    return toPaginated(data, total, query);
  }

  /** Flat list for parent pickers — no pagination. */
  options(orgId: string) {
    return this.prisma.department.findMany({
      where: { organizationId: orgId },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    });
  }

  async create(ctx: OrgCtx, input: DepartmentCreateInput) {
    if (input.parentId) await this.ensureExists(ctx.orgId, input.parentId);
    const dept = await this.prisma.department.create({
      data: { ...input, organizationId: ctx.orgId },
      include: INCLUDE,
    });
    await auditOrgMutation(this.prisma, ctx, 'org.department.create', 'Department', dept.id);
    return dept;
  }

  async update(ctx: OrgCtx, id: string, input: DepartmentUpdateInput) {
    await this.ensureExists(ctx.orgId, id);
    if (input.parentId) {
      if (input.parentId === id)
        throw new BadRequestException('A department cannot be its own parent');
      await this.ensureExists(ctx.orgId, input.parentId);
      await this.ensureNoCycle(id, input.parentId);
    }
    const dept = await this.prisma.department.update({
      where: { id },
      data: input,
      include: INCLUDE,
    });
    await auditOrgMutation(this.prisma, ctx, 'org.department.update', 'Department', id);
    return dept;
  }

  async remove(ctx: OrgCtx, id: string) {
    await this.ensureExists(ctx.orgId, id);
    await this.prisma.department.delete({ where: { id } });
    await auditOrgMutation(this.prisma, ctx, 'org.department.delete', 'Department', id);
  }

  private async ensureExists(orgId: string, id: string) {
    const found = await this.prisma.department.findFirst({ where: { id, organizationId: orgId } });
    if (!found) throw new NotFoundException('Department not found');
  }

  /** Rejects a parent that is the department itself or any of its descendants. */
  private async ensureNoCycle(id: string, proposedParentId: string) {
    let cursor: string | null = proposedParentId;
    for (let depth = 0; cursor && depth < 100; depth++) {
      if (cursor === id) {
        throw new BadRequestException('Cannot move a department under one of its sub-departments');
      }
      const parent: { parentId: string | null } | null = await this.prisma.department.findUnique({
        where: { id: cursor },
        select: { parentId: true },
      });
      cursor = parent?.parentId ?? null;
    }
  }
}
