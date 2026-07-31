import type { DesignationCreateInput, DesignationUpdateInput, PaginationQuery } from '@hrms/shared';
import { Injectable, NotFoundException } from '@nestjs/common';
import { buildListArgs, searchWhere, toPaginated } from '../../../common/utils/list-query';
import { PrismaService } from '../../../database/prisma.service';
import type { OrgCtx } from '../org-context';
import { auditOrgMutation } from './audit.helper';

const SORTABLE = ['title', 'level'] as const;

@Injectable()
export class DesignationsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(orgId: string, query: PaginationQuery) {
    const where = { organizationId: orgId, ...searchWhere(query.search, ['title']) };
    const [data, total] = await this.prisma.$transaction([
      this.prisma.designation.findMany({
        where,
        include: { _count: { select: { employees: true } } },
        ...buildListArgs(query, SORTABLE, 'title'),
      }),
      this.prisma.designation.count({ where }),
    ]);
    return toPaginated(data, total, query);
  }

  /** Flat list for pickers. */
  options(orgId: string) {
    return this.prisma.designation.findMany({
      where: { organizationId: orgId },
      select: { id: true, title: true },
      orderBy: { title: 'asc' },
    });
  }

  async create(ctx: OrgCtx, input: DesignationCreateInput) {
    const row = await this.prisma.designation.create({
      data: { ...input, organizationId: ctx.orgId },
    });
    await auditOrgMutation(this.prisma, ctx, 'org.designation.create', 'Designation', row.id);
    return row;
  }

  async update(ctx: OrgCtx, id: string, input: DesignationUpdateInput) {
    await this.ensureExists(ctx.orgId, id);
    const row = await this.prisma.designation.update({ where: { id }, data: input });
    await auditOrgMutation(this.prisma, ctx, 'org.designation.update', 'Designation', id);
    return row;
  }

  async remove(ctx: OrgCtx, id: string) {
    await this.ensureExists(ctx.orgId, id);
    await this.prisma.designation.delete({ where: { id } });
    await auditOrgMutation(this.prisma, ctx, 'org.designation.delete', 'Designation', id);
  }

  private async ensureExists(orgId: string, id: string) {
    const found = await this.prisma.designation.findFirst({ where: { id, organizationId: orgId } });
    if (!found) throw new NotFoundException('Designation not found');
  }
}
