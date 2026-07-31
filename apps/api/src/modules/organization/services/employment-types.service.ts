import type {
  EmploymentTypeCreateInput,
  EmploymentTypeUpdateInput,
  PaginationQuery,
} from '@hrms/shared';
import { Injectable, NotFoundException } from '@nestjs/common';
import { buildListArgs, searchWhere, toPaginated } from '../../../common/utils/list-query';
import { PrismaService } from '../../../database/prisma.service';
import type { OrgCtx } from '../org-context';
import { auditOrgMutation } from './audit.helper';

const SORTABLE = ['name', 'code'] as const;

@Injectable()
export class EmploymentTypesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(orgId: string, query: PaginationQuery) {
    const where = { organizationId: orgId, ...searchWhere(query.search, ['name', 'code']) };
    const [data, total] = await this.prisma.$transaction([
      this.prisma.employmentType.findMany({
        where,
        include: { _count: { select: { employees: true } } },
        ...buildListArgs(query, SORTABLE, 'name'),
      }),
      this.prisma.employmentType.count({ where }),
    ]);
    return toPaginated(data, total, query);
  }

  async create(ctx: OrgCtx, input: EmploymentTypeCreateInput) {
    const row = await this.prisma.employmentType.create({
      data: { ...input, organizationId: ctx.orgId },
    });
    await auditOrgMutation(this.prisma, ctx, 'org.employmentType.create', 'EmploymentType', row.id);
    return row;
  }

  async update(ctx: OrgCtx, id: string, input: EmploymentTypeUpdateInput) {
    await this.ensureExists(ctx.orgId, id);
    const row = await this.prisma.employmentType.update({ where: { id }, data: input });
    await auditOrgMutation(this.prisma, ctx, 'org.employmentType.update', 'EmploymentType', id);
    return row;
  }

  async remove(ctx: OrgCtx, id: string) {
    await this.ensureExists(ctx.orgId, id);
    await this.prisma.employmentType.delete({ where: { id } });
    await auditOrgMutation(this.prisma, ctx, 'org.employmentType.delete', 'EmploymentType', id);
  }

  private async ensureExists(orgId: string, id: string) {
    const found = await this.prisma.employmentType.findFirst({
      where: { id, organizationId: orgId },
    });
    if (!found) throw new NotFoundException('Employment type not found');
  }
}
