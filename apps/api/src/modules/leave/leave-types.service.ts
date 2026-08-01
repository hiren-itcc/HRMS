import type { LeaveTypeCreateInput, LeaveTypeUpdateInput, PaginationQuery } from '@hrms/shared';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { auditMutation } from '../../common/utils/audit';
import { buildListArgs, searchWhere, toPaginated } from '../../common/utils/list-query';
import { PrismaService } from '../../database/prisma.service';
import { toNumber } from './leave.mapper';

const SORTABLE = ['name', 'code', 'daysPerYear'] as const;

@Injectable()
export class LeaveTypesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(orgId: string, query: PaginationQuery) {
    const where = { organizationId: orgId, ...searchWhere(query.search, ['name', 'code']) };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.leaveType.findMany({
        where,
        include: { _count: { select: { requests: true } } },
        ...buildListArgs(query, SORTABLE, 'name'),
      }),
      this.prisma.leaveType.count({ where }),
    ]);
    return toPaginated(rows.map(mapType), total, query);
  }

  /** Flat list used by the apply form. */
  async options(orgId: string) {
    const rows = await this.prisma.leaveType.findMany({
      where: { organizationId: orgId },
      orderBy: { name: 'asc' },
    });
    return rows.map(mapType);
  }

  async create(ctx: { orgId: string; userId: string }, input: LeaveTypeCreateInput) {
    const row = await this.prisma.leaveType.create({
      data: { ...input, organizationId: ctx.orgId },
    });
    await auditMutation(this.prisma, ctx, 'leave.type.create', 'LeaveType', row.id);
    return mapType(row);
  }

  async update(ctx: { orgId: string; userId: string }, id: string, input: LeaveTypeUpdateInput) {
    await this.ensureExists(ctx.orgId, id);
    const row = await this.prisma.leaveType.update({ where: { id }, data: input });
    await auditMutation(this.prisma, ctx, 'leave.type.update', 'LeaveType', id);
    return mapType(row);
  }

  async remove(ctx: { orgId: string; userId: string }, id: string) {
    await this.ensureExists(ctx.orgId, id);
    const used = await this.prisma.leaveRequest.count({ where: { leaveTypeId: id } });
    if (used > 0) {
      throw new BadRequestException(
        'This leave type has requests against it and cannot be deleted',
      );
    }
    await this.prisma.$transaction([
      this.prisma.leaveBalance.deleteMany({ where: { leaveTypeId: id } }),
      this.prisma.leaveType.delete({ where: { id } }),
    ]);
    await auditMutation(this.prisma, ctx, 'leave.type.delete', 'LeaveType', id);
  }

  private async ensureExists(orgId: string, id: string) {
    const found = await this.prisma.leaveType.findFirst({ where: { id, organizationId: orgId } });
    if (!found) throw new NotFoundException('Leave type not found');
  }
}

/*
 * Generic rather than `any`: the caller's own fields keep their types through
 * the spread, and the two Decimal columns this actually converts are checked.
 * `any` meant renaming either column compiled clean and shipped undefined.
 */
export function mapType<T extends { daysPerYear: unknown; maxCarryForward: unknown }>(row: T) {
  return {
    ...row,
    daysPerYear: toNumber(row.daysPerYear),
    maxCarryForward: row.maxCarryForward == null ? null : toNumber(row.maxCarryForward),
  };
}
