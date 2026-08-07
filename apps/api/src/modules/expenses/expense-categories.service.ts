import type { ExpenseCategoryCreateInput, ExpenseCategoryUpdateInput } from '@hrms/shared';
import type { AccessTokenClaims } from '@hrms/types';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { auditMutation } from '../../common/utils/audit';
import { PrismaService } from '../../database/prisma.service';
import { mapCategory } from './expenses.mapper';

/**
 * What can be claimed for, and which payslip line it pays out on.
 *
 * The component link is the whole reason this is configuration rather than a
 * fixed list: an organization that reimburses travel and phone bills on
 * separate payslip lines can say so, and one that lumps everything into
 * "Reimbursement" can do that too.
 */
@Injectable()
export class ExpenseCategoriesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(orgId: string, includeInactive = false) {
    const rows = await this.prisma.expenseCategory.findMany({
      where: { organizationId: orgId, ...(includeInactive ? {} : { active: true }) },
      include: { component: { select: { id: true, code: true, name: true, kind: true } } },
      orderBy: [{ order: 'asc' }, { name: 'asc' }],
    });
    return rows.map(mapCategory);
  }

  /**
   * The component must be one a claim can actually pay out on.
   *
   * Statutory components are computed from settings — a hand-entered PF line
   * would disagree with the rules that produced it — and only earnings and
   * deductions reach a payslip at all. `PayrollAdjustmentsService.upsert`
   * refuses both again when the claim is approved; checking here as well is
   * what makes the refusal arrive while somebody is configuring, rather than
   * months later when the first claim is approved against it.
   */
  private async assertPayable(orgId: string, componentId: string) {
    const component = await this.prisma.payComponent.findFirst({
      where: { id: componentId, organizationId: orgId, active: true },
      select: { code: true, kind: true, isStatutory: true, taxable: true },
    });
    if (!component) throw new NotFoundException('Pay component not found');
    if (component.isStatutory) {
      throw new BadRequestException(
        `${component.code} is calculated from your payroll settings and cannot be claimed against`,
      );
    }
    if (component.kind !== 'EARNING' && component.kind !== 'DEDUCTION') {
      throw new BadRequestException('Claims can only pay out on an earning or a deduction');
    }
    return component;
  }

  async create(claims: AccessTokenClaims, input: ExpenseCategoryCreateInput) {
    await this.assertPayable(claims.orgId, input.componentId);

    const clash = await this.prisma.expenseCategory.findFirst({
      where: { organizationId: claims.orgId, code: input.code },
      select: { id: true },
    });
    if (clash)
      throw new BadRequestException(`A category with the code ${input.code} already exists`);

    const row = await this.prisma.expenseCategory.create({
      data: {
        organizationId: claims.orgId,
        code: input.code,
        name: input.name,
        capPerClaim: input.capPerClaim ?? null,
        requiresReceipt: input.requiresReceipt,
        componentId: input.componentId,
        active: input.active,
        order: input.order,
      },
      include: { component: { select: { id: true, code: true, name: true, kind: true } } },
    });
    await auditMutation(
      this.prisma,
      { orgId: claims.orgId, userId: claims.sub },
      'expense.category.create',
      'ExpenseCategory',
      row.id,
      { after: { code: row.code, name: row.name } },
    );
    return mapCategory(row);
  }

  async update(claims: AccessTokenClaims, id: string, input: ExpenseCategoryUpdateInput) {
    const existing = await this.prisma.expenseCategory.findFirst({
      where: { id, organizationId: claims.orgId },
    });
    if (!existing) throw new NotFoundException('Expense category not found');
    if (input.componentId) await this.assertPayable(claims.orgId, input.componentId);

    const row = await this.prisma.expenseCategory.update({
      where: { id },
      data: {
        ...(input.code !== undefined ? { code: input.code } : {}),
        ...(input.name !== undefined ? { name: input.name } : {}),
        // `undefined` means "not sent"; `null` means "cleared" and is a
        // meaningful value here — a category losing its ceiling.
        ...(input.capPerClaim !== undefined ? { capPerClaim: input.capPerClaim } : {}),
        ...(input.requiresReceipt !== undefined ? { requiresReceipt: input.requiresReceipt } : {}),
        ...(input.componentId !== undefined ? { componentId: input.componentId } : {}),
        ...(input.active !== undefined ? { active: input.active } : {}),
        ...(input.order !== undefined ? { order: input.order } : {}),
      },
      include: { component: { select: { id: true, code: true, name: true, kind: true } } },
    });
    await auditMutation(
      this.prisma,
      { orgId: claims.orgId, userId: claims.sub },
      'expense.category.update',
      'ExpenseCategory',
      id,
      { before: { code: existing.code, active: existing.active }, after: input },
    );
    return mapCategory(row);
  }

  /**
   * Deactivates rather than deletes once anything has been claimed against it.
   *
   * A claim keeps its category for the same reason a payslip keeps its figures:
   * an approved claim from March has to still say what it was for in December.
   * The same call the asset register and the structure editor make.
   */
  async remove(claims: AccessTokenClaims, id: string) {
    const existing = await this.prisma.expenseCategory.findFirst({
      where: { id, organizationId: claims.orgId },
      select: { id: true, code: true, _count: { select: { items: true } } },
    });
    if (!existing) throw new NotFoundException('Expense category not found');

    if (existing._count.items > 0) {
      throw new BadRequestException(
        `${existing.code} has been claimed against ${existing._count.items} time(s) — deactivate it instead, so those claims still say what they were for`,
      );
    }

    await this.prisma.expenseCategory.delete({ where: { id } });
    await auditMutation(
      this.prisma,
      { orgId: claims.orgId, userId: claims.sub },
      'expense.category.delete',
      'ExpenseCategory',
      id,
      { before: { code: existing.code } },
    );
    return { id };
  }
}
