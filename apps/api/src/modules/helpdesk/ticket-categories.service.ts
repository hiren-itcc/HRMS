import type { TicketCategoryCreateInput, TicketCategoryUpdateInput } from '@hrms/shared';
import type { AccessTokenClaims } from '@hrms/types';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { auditMutation } from '../../common/utils/audit';
import { PrismaService } from '../../database/prisma.service';
import { assertWorksTheDesk } from './helpdesk.agents';
import { mapCategory } from './helpdesk.mapper';

const ASSIGNEE_SELECT = {
  select: { id: true, firstName: true, lastName: true, employeeCode: true },
} as const;

/**
 * The desks. `defaultAssigneeId` is the whole routing engine in this module,
 * deliberately — rules engines, round-robin and load balancing are what a
 * second product does, and one named person per category is enough for one
 * desk.
 */
@Injectable()
export class TicketCategoriesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(orgId: string, activeOnly?: boolean) {
    const rows = await this.prisma.ticketCategory.findMany({
      where: { organizationId: orgId, ...(activeOnly ? { active: true } : {}) },
      include: { defaultAssignee: ASSIGNEE_SELECT, _count: { select: { tickets: true } } },
      orderBy: [{ active: 'desc' }, { name: 'asc' }],
    });
    return rows.map(mapCategory);
  }

  /** The one a ticket is being raised against — active only, and in this org. */
  async requireActive(orgId: string, id: string) {
    const category = await this.prisma.ticketCategory.findFirst({
      where: { id, organizationId: orgId, active: true },
      select: { id: true, name: true, defaultAssigneeId: true },
    });
    if (!category) throw new NotFoundException('Category not found');
    return category;
  }

  async create(claims: AccessTokenClaims, input: TicketCategoryCreateInput) {
    if (input.defaultAssigneeId) {
      await assertWorksTheDesk(
        this.prisma,
        claims.orgId,
        input.defaultAssigneeId,
        'That person cannot work the helpdesk. Give their role `helpdesk.respond` first, or leave the category unassigned.',
      );
    }
    const existing = await this.prisma.ticketCategory.findFirst({
      where: { organizationId: claims.orgId, name: input.name },
      select: { id: true },
    });
    if (existing) throw new BadRequestException('A category with that name already exists');

    const row = await this.prisma.ticketCategory.create({
      data: {
        organizationId: claims.orgId,
        name: input.name,
        description: input.description ?? null,
        defaultAssigneeId: input.defaultAssigneeId ?? null,
        active: input.active,
      },
      include: { defaultAssignee: ASSIGNEE_SELECT },
    });
    await auditMutation(
      this.prisma,
      this.ctx(claims),
      'helpdesk.category.create',
      'TicketCategory',
      row.id,
      {
        after: { name: row.name, defaultAssigneeId: row.defaultAssigneeId },
      },
    );
    return mapCategory(row);
  }

  async update(claims: AccessTokenClaims, id: string, input: TicketCategoryUpdateInput) {
    const before = await this.prisma.ticketCategory.findFirst({
      where: { id, organizationId: claims.orgId },
    });
    if (!before) throw new NotFoundException('Category not found');

    if (input.defaultAssigneeId) {
      await assertWorksTheDesk(
        this.prisma,
        claims.orgId,
        input.defaultAssigneeId,
        'That person cannot work the helpdesk. Give their role `helpdesk.respond` first, or leave the category unassigned.',
      );
    }

    const row = await this.prisma.ticketCategory.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.description !== undefined ? { description: input.description ?? null } : {}),
        ...(input.defaultAssigneeId !== undefined
          ? { defaultAssigneeId: input.defaultAssigneeId ?? null }
          : {}),
        ...(input.active !== undefined ? { active: input.active } : {}),
      },
      include: { defaultAssignee: ASSIGNEE_SELECT },
    });
    await auditMutation(
      this.prisma,
      this.ctx(claims),
      'helpdesk.category.update',
      'TicketCategory',
      id,
      {
        before: {
          name: before.name,
          active: before.active,
          defaultAssigneeId: before.defaultAssigneeId,
        },
        after: { name: row.name, active: row.active, defaultAssigneeId: row.defaultAssigneeId },
      },
    );
    return mapCategory(row);
  }

  /**
   * Refused while anything references it, and the message says to deactivate
   * instead. The foreign key is `RESTRICT` as well, so the database agrees
   * rather than merely being trusted to.
   */
  async remove(claims: AccessTokenClaims, id: string) {
    const category = await this.prisma.ticketCategory.findFirst({
      where: { id, organizationId: claims.orgId },
      include: { _count: { select: { tickets: true } } },
    });
    if (!category) throw new NotFoundException('Category not found');
    if (category._count.tickets > 0) {
      throw new BadRequestException(
        `${category._count.tickets} ticket${category._count.tickets === 1 ? '' : 's'} still reference this category. Deactivate it instead — the history stays readable that way.`,
      );
    }
    await this.prisma.ticketCategory.delete({ where: { id } });
    await auditMutation(
      this.prisma,
      this.ctx(claims),
      'helpdesk.category.delete',
      'TicketCategory',
      id,
      {
        before: { name: category.name },
      },
    );
    return { ok: true };
  }

  private ctx(claims: AccessTokenClaims) {
    return { orgId: claims.orgId, userId: claims.sub };
  }
}
