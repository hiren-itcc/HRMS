import type { HolidayCreateInput, HolidayQuery, HolidayUpdateInput } from '@hrms/shared';
import { Injectable, NotFoundException } from '@nestjs/common';
import { buildListArgs, searchWhere, toPaginated } from '../../../common/utils/list-query';
import { PrismaService } from '../../../database/prisma.service';
import type { OrgCtx } from '../org-context';
import { auditOrgMutation } from './audit.helper';

const SORTABLE = ['date', 'name'] as const;
const INCLUDE = { location: { select: { id: true, name: true } } } as const;

@Injectable()
export class HolidaysService {
  constructor(private readonly prisma: PrismaService) {}

  async list(orgId: string, query: HolidayQuery) {
    const where = {
      organizationId: orgId,
      ...(query.year
        ? {
            date: { gte: new Date(`${query.year}-01-01`), lt: new Date(`${query.year + 1}-01-01`) },
          }
        : {}),
      ...(query.locationId ? { locationId: query.locationId } : {}),
      ...searchWhere(query.search, ['name']),
    };
    const [data, total] = await this.prisma.$transaction([
      this.prisma.holiday.findMany({
        where,
        include: INCLUDE,
        ...buildListArgs(query, SORTABLE, 'date'),
      }),
      this.prisma.holiday.count({ where }),
    ]);
    return toPaginated(data, total, query);
  }

  async create(ctx: OrgCtx, input: HolidayCreateInput) {
    if (input.locationId) await this.ensureLocation(ctx.orgId, input.locationId);
    const row = await this.prisma.holiday.create({
      data: { ...input, date: new Date(input.date), organizationId: ctx.orgId },
      include: INCLUDE,
    });
    await auditOrgMutation(this.prisma, ctx, 'org.holiday.create', 'Holiday', row.id);
    return row;
  }

  async update(ctx: OrgCtx, id: string, input: HolidayUpdateInput) {
    await this.ensureExists(ctx.orgId, id);
    if (input.locationId) await this.ensureLocation(ctx.orgId, input.locationId);
    const row = await this.prisma.holiday.update({
      where: { id },
      data: { ...input, ...(input.date ? { date: new Date(input.date) } : {}) },
      include: INCLUDE,
    });
    await auditOrgMutation(this.prisma, ctx, 'org.holiday.update', 'Holiday', id);
    return row;
  }

  async remove(ctx: OrgCtx, id: string) {
    await this.ensureExists(ctx.orgId, id);
    await this.prisma.holiday.delete({ where: { id } });
    await auditOrgMutation(this.prisma, ctx, 'org.holiday.delete', 'Holiday', id);
  }

  private async ensureExists(orgId: string, id: string) {
    const found = await this.prisma.holiday.findFirst({ where: { id, organizationId: orgId } });
    if (!found) throw new NotFoundException('Holiday not found');
  }

  private async ensureLocation(orgId: string, locationId: string) {
    const found = await this.prisma.location.findFirst({
      where: { id: locationId, organizationId: orgId },
    });
    if (!found) throw new NotFoundException('Location not found');
  }
}
