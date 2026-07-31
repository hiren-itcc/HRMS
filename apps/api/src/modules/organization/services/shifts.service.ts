import type { PaginationQuery, ShiftCreateInput, ShiftUpdateInput } from '@hrms/shared';
import { Injectable, NotFoundException } from '@nestjs/common';
import { buildListArgs, searchWhere, toPaginated } from '../../../common/utils/list-query';
import { PrismaService } from '../../../database/prisma.service';
import type { OrgCtx } from '../org-context';
import { auditOrgMutation } from './audit.helper';

const SORTABLE = ['name', 'startTime', 'endTime'] as const;

@Injectable()
export class ShiftsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(orgId: string, query: PaginationQuery) {
    const where = { organizationId: orgId, ...searchWhere(query.search, ['name']) };
    const [data, total] = await this.prisma.$transaction([
      this.prisma.shift.findMany({
        where,
        include: { _count: { select: { employees: true } } },
        ...buildListArgs(query, SORTABLE, 'name'),
      }),
      this.prisma.shift.count({ where }),
    ]);
    return toPaginated(data, total, query);
  }

  async create(ctx: OrgCtx, input: ShiftCreateInput) {
    const row = await this.prisma.shift.create({ data: { ...input, organizationId: ctx.orgId } });
    await auditOrgMutation(this.prisma, ctx, 'org.shift.create', 'Shift', row.id);
    return row;
  }

  async update(ctx: OrgCtx, id: string, input: ShiftUpdateInput) {
    await this.ensureExists(ctx.orgId, id);
    const row = await this.prisma.shift.update({ where: { id }, data: input });
    await auditOrgMutation(this.prisma, ctx, 'org.shift.update', 'Shift', id);
    return row;
  }

  async remove(ctx: OrgCtx, id: string) {
    await this.ensureExists(ctx.orgId, id);
    await this.prisma.shift.delete({ where: { id } });
    await auditOrgMutation(this.prisma, ctx, 'org.shift.delete', 'Shift', id);
  }

  private async ensureExists(orgId: string, id: string) {
    const found = await this.prisma.shift.findFirst({ where: { id, organizationId: orgId } });
    if (!found) throw new NotFoundException('Shift not found');
  }
}
