import type { PayComponentCreateInput, PayComponentUpdateInput } from '@hrms/shared';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { auditMutation } from '../../common/utils/audit';
import { PrismaService } from '../../database/prisma.service';
import { deleteBlockedReason, editBlockedReason } from './pay-components.guardrails';

type ComponentRow = {
  id: string;
  code: string;
  name: string;
  kind: string;
  taxable: boolean;
  isStatutory: boolean;
  isSystem: boolean;
  order: number;
  active: boolean;
};

function map(row: ComponentRow) {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    kind: row.kind,
    taxable: row.taxable,
    isStatutory: row.isStatutory,
    isSystem: row.isSystem,
    order: row.order,
    active: row.active,
  };
}

/**
 * The pay component catalogue.
 *
 * See `pay-components.guardrails.ts` for the hazard this exists to contain:
 * component codes are looked up by name across the calculation engine, and
 * every lookup falls back to `0` or `undefined` rather than throwing. `code`
 * is therefore immutable after creation for every component — the update
 * schema simply has no `code` field, so a stale client that still sends one
 * is silently dropped rather than 400'd. `name`, by contrast, is editable
 * even on seeded components: the engine only ever displays it.
 */
@Injectable()
export class PayComponentsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Moved here from `SalaryStructuresService` — component CRUD and the
   * component read now live together, and the guardrails this module adds
   * apply to reads too (`includeInactive` is gated by the caller's
   * permission in the controller). Existing callers pass nothing and see the
   * same active-only list they always have.
   */
  async list(orgId: string, includeInactive = false) {
    const rows = await this.prisma.payComponent.findMany({
      where: { organizationId: orgId, ...(includeInactive ? {} : { active: true }) },
      orderBy: { order: 'asc' },
    });
    return rows.map((row) => map(row as ComponentRow));
  }

  async create(ctx: { orgId: string; userId: string }, input: PayComponentCreateInput) {
    const clash = await this.prisma.payComponent.findFirst({
      where: { organizationId: ctx.orgId, code: input.code },
      select: { id: true },
    });
    if (clash) {
      throw new BadRequestException(`A component with the code ${input.code} already exists`);
    }

    const row = await this.prisma.payComponent.create({
      data: {
        organizationId: ctx.orgId,
        code: input.code,
        name: input.name,
        kind: input.kind,
        taxable: input.taxable,
        isStatutory: input.isStatutory,
        order: input.order,
        active: input.active,
      },
    });
    await auditMutation(this.prisma, ctx, 'payroll.component.create', 'PayComponent', row.id, {
      after: { code: row.code, name: row.name, kind: row.kind },
    });
    return map(row as ComponentRow);
  }

  async update(ctx: { orgId: string; userId: string }, id: string, input: PayComponentUpdateInput) {
    const existing = await this.prisma.payComponent.findFirst({
      where: { id, organizationId: ctx.orgId },
    });
    if (!existing) throw new NotFoundException('Pay component not found');

    const blocked = editBlockedReason(existing, input);
    if (blocked) throw new BadRequestException(blocked);

    const row = await this.prisma.payComponent.update({
      where: { id },
      data: {
        ...(input.name === undefined ? {} : { name: input.name }),
        ...(input.kind === undefined ? {} : { kind: input.kind }),
        ...(input.taxable === undefined ? {} : { taxable: input.taxable }),
        ...(input.isStatutory === undefined ? {} : { isStatutory: input.isStatutory }),
        ...(input.order === undefined ? {} : { order: input.order }),
        ...(input.active === undefined ? {} : { active: input.active }),
      },
    });
    await auditMutation(this.prisma, ctx, 'payroll.component.update', 'PayComponent', id, {
      before: { name: existing.name, kind: existing.kind, active: existing.active },
      after: input,
    });
    return map(row as ComponentRow);
  }

  /**
   * Deletes a component nothing references.
   *
   * `StructureLine`, `PayrollAdjustment` and `ExpenseCategory` all FK to
   * `PayComponent` with Prisma's default `Restrict`, and nothing catches
   * P2003 for this model — the `_count` select is the pre-flight that turns
   * what would otherwise be a raw 500 into a readable sentence naming each
   * reference type. Ownership is checked in the same query the counts come
   * from, so another organization's row 404s before any count is even read.
   */
  async remove(ctx: { orgId: string; userId: string }, id: string) {
    const existing = await this.prisma.payComponent.findFirst({
      where: { id, organizationId: ctx.orgId },
      select: {
        id: true,
        code: true,
        _count: { select: { structureLines: true, adjustments: true, expenseCategories: true } },
      },
    });
    if (!existing) throw new NotFoundException('Pay component not found');

    const blocked = deleteBlockedReason(existing, {
      structureLines: existing._count.structureLines,
      adjustments: existing._count.adjustments,
      expenseCategories: existing._count.expenseCategories,
    });
    if (blocked) throw new BadRequestException(blocked);

    await this.prisma.payComponent.delete({ where: { id } });
    await auditMutation(this.prisma, ctx, 'payroll.component.delete', 'PayComponent', id, {
      before: { code: existing.code },
    });
    return { id };
  }
}
