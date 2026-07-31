import type { LocationCreateInput, LocationQuery, LocationUpdateInput } from '@hrms/shared';
import { Injectable, NotFoundException } from '@nestjs/common';
import { buildListArgs, searchWhere, toPaginated } from '../../../common/utils/list-query';
import { PrismaService } from '../../../database/prisma.service';
import type { OrgCtx } from '../org-context';
import { auditOrgMutation } from './audit.helper';

const SORTABLE = ['name', 'type', 'city', 'country'] as const;

@Injectable()
export class LocationsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(orgId: string, query: LocationQuery) {
    const where = {
      organizationId: orgId,
      ...(query.type ? { type: query.type } : {}),
      ...searchWhere(query.search, ['name', 'city', 'country']),
    };
    const [data, total] = await this.prisma.$transaction([
      this.prisma.location.findMany({
        where,
        include: { _count: { select: { employees: true, holidays: true } } },
        ...buildListArgs(query, SORTABLE, 'name'),
      }),
      this.prisma.location.count({ where }),
    ]);
    return toPaginated(data, total, query);
  }

  /** Flat list for pickers (holiday form, future employee form). */
  options(orgId: string) {
    return this.prisma.location.findMany({
      where: { organizationId: orgId },
      select: { id: true, name: true, type: true },
      orderBy: { name: 'asc' },
    });
  }

  async create(ctx: OrgCtx, input: LocationCreateInput) {
    const row = await this.prisma.location.create({
      data: { ...input, organizationId: ctx.orgId },
    });
    await auditOrgMutation(this.prisma, ctx, 'org.location.create', 'Location', row.id);
    return row;
  }

  async update(ctx: OrgCtx, id: string, input: LocationUpdateInput) {
    await this.ensureExists(ctx.orgId, id);
    const row = await this.prisma.location.update({ where: { id }, data: input });
    await auditOrgMutation(this.prisma, ctx, 'org.location.update', 'Location', id);
    return row;
  }

  async remove(ctx: OrgCtx, id: string) {
    await this.ensureExists(ctx.orgId, id);
    await this.prisma.location.delete({ where: { id } });
    await auditOrgMutation(this.prisma, ctx, 'org.location.delete', 'Location', id);
  }

  private async ensureExists(orgId: string, id: string) {
    const found = await this.prisma.location.findFirst({ where: { id, organizationId: orgId } });
    if (!found) throw new NotFoundException('Location not found');
  }
}
