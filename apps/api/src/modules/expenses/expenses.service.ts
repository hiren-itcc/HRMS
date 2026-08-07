import type {
  ExpenseClaimCreateInput,
  ExpenseClaimQuery,
  ExpenseClaimStatusCode,
  ExpenseClaimUpdateInput,
  ExpenseDecisionInput,
} from '@hrms/shared';
import type { AccessTokenClaims } from '@hrms/types';
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { auditMutation } from '../../common/utils/audit';
import { toDate } from '../../common/utils/calendar';
import { toPaginated } from '../../common/utils/list-query';
import { PrismaService } from '../../database/prisma.service';
import type { Prisma } from '../../generated/prisma/client';
import { NotificationsService } from '../notifications/notifications.service';
import { PayrollAdjustmentsService } from '../payroll/payroll-adjustments.service';
import {
  canDecide,
  canEdit,
  canSubmit,
  canWithdraw,
  editError,
  payoutByComponent,
  submissionProblems,
} from './expense.rules';
import { mapClaim, money } from './expenses.mapper';

const INCLUDE = {
  items: {
    include: { category: { select: { id: true, name: true, code: true } } },
    orderBy: { spentOn: 'asc' },
  },
  employee: { select: { id: true, firstName: true, lastName: true, employeeCode: true } },
} as const satisfies Prisma.ExpenseClaimInclude;

@Injectable()
export class ExpensesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly adjustments: PayrollAdjustmentsService,
    private readonly notifications: NotificationsService,
  ) {}

  private requireEmployee(claims: AccessTokenClaims): string {
    if (!claims.employeeId) {
      throw new BadRequestException('No employee record is linked to this account');
    }
    return claims.employeeId;
  }

  /**
   * Which claims this token may see.
   *
   * `'__none__'` for a manager with no employee record of their own is the same
   * sentinel every other scoped list uses: it matches nothing, where an
   * `undefined` would have silently matched everything.
   */
  private scopeWhere(
    claims: AccessTokenClaims,
    scope: 'own' | 'team' | 'all',
  ): Prisma.ExpenseClaimWhereInput {
    const perms = new Set(claims.perms);
    if (scope === 'all' && perms.has('expense.read')) return {};
    if (scope === 'team' && (perms.has('expense.read.team') || perms.has('expense.read'))) {
      return { employee: { managerId: claims.employeeId ?? '__none__' } };
    }
    return { employeeId: claims.employeeId ?? '__none__' };
  }

  /**
   * Which of these months payroll has already paid.
   *
   * One query for the whole page rather than one per claim — the N+1 that
   * `wfh.service.ts` had to have removed after it shipped.
   */
  private async publishedMonths(orgId: string, months: (string | null)[]) {
    const wanted = [...new Set(months.filter((month): month is string => !!month))];
    if (wanted.length === 0) return new Set<string>();
    const runs = await this.prisma.payrollRun.findMany({
      where: { organizationId: orgId, month: { in: wanted }, status: 'PUBLISHED' },
      select: { month: true },
    });
    return new Set(runs.map((run) => run.month));
  }

  async list(claims: AccessTokenClaims, query: ExpenseClaimQuery) {
    const where: Prisma.ExpenseClaimWhereInput = {
      organizationId: claims.orgId,
      ...(query.status ? { status: query.status } : {}),
      ...(query.employeeId ? { employeeId: query.employeeId } : {}),
      ...this.scopeWhere(claims, query.scope),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.expenseClaim.findMany({
        where,
        include: INCLUDE,
        orderBy: [{ createdAt: 'desc' }],
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      this.prisma.expenseClaim.count({ where }),
    ]);
    const paid = await this.publishedMonths(
      claims.orgId,
      rows.map((row) => row.payrollMonth),
    );
    return toPaginated(
      rows.map((row) => mapClaim(row, paid)),
      total,
      query,
    );
  }

  async get(claims: AccessTokenClaims, id: string) {
    const row = await this.readable(claims, id);
    const paid = await this.publishedMonths(claims.orgId, [row.payrollMonth]);
    return mapClaim(row, paid);
  }

  /** The row, or a 404 — after checking this token is allowed to see it. */
  private async readable(claims: AccessTokenClaims, id: string) {
    const row = await this.prisma.expenseClaim.findFirst({
      where: { id, organizationId: claims.orgId },
      include: INCLUDE,
    });
    if (!row) throw new NotFoundException('Claim not found');

    const perms = new Set(claims.perms);
    const isOwn = row.employeeId === claims.employeeId;
    if (isOwn || perms.has('expense.read')) return row;

    if (perms.has('expense.read.team') || perms.has('expense.approve.team')) {
      const managed = await this.prisma.employee.findFirst({
        where: { id: row.employeeId, managerId: claims.employeeId ?? '__none__' },
        select: { id: true },
      });
      if (managed) return row;
    }
    // 404 rather than 403: whether a claim exists is itself information about
    // somebody's spending, and the same rule notifications and documents follow.
    throw new NotFoundException('Claim not found');
  }

  /** The categories a claim's lines reference, in the shape the rules want. */
  private async categoriesFor(orgId: string, categoryIds: string[]) {
    const rows = await this.prisma.expenseCategory.findMany({
      where: { organizationId: orgId, id: { in: [...new Set(categoryIds)] } },
      select: {
        id: true,
        name: true,
        capPerClaim: true,
        requiresReceipt: true,
        active: true,
        componentId: true,
      },
    });
    return rows.map((row) => ({
      ...row,
      capPerClaim: row.capPerClaim === null ? null : money(row.capPerClaim),
    }));
  }

  async create(claims: AccessTokenClaims, input: ExpenseClaimCreateInput) {
    const employeeId = this.requireEmployee(claims);
    await this.assertCategoriesUsable(
      claims.orgId,
      input.items.map((item) => item.categoryId),
    );

    const row = await this.prisma.expenseClaim.create({
      data: {
        organizationId: claims.orgId,
        employeeId,
        title: input.title,
        items: { create: input.items.map((item) => this.itemData(item)) },
      },
      include: INCLUDE,
    });
    await auditMutation(
      this.prisma,
      { orgId: claims.orgId, userId: claims.sub },
      'expense.claim.create',
      'ExpenseClaim',
      row.id,
    );
    return mapClaim(row, new Set());
  }

  private itemData(item: ExpenseClaimCreateInput['items'][number]) {
    return {
      categoryId: item.categoryId,
      spentOn: toDate(item.spentOn),
      amount: item.amount,
      description: item.description,
      receiptId: item.receiptId ?? null,
    };
  }

  private async assertCategoriesUsable(orgId: string, categoryIds: string[]) {
    if (categoryIds.length === 0) return;
    const usable = await this.prisma.expenseCategory.count({
      where: { organizationId: orgId, active: true, id: { in: [...new Set(categoryIds)] } },
    });
    if (usable !== new Set(categoryIds).size) {
      throw new BadRequestException('One of those categories is not available');
    }
  }

  /**
   * Lines are replaced wholesale rather than patched one at a time.
   *
   * A claim is edited as one thing, so a half-saved claim is a state that
   * cannot happen — the same call emergency contacts make. It also means the
   * cap and receipt rules only ever see a complete claim.
   */
  async update(claims: AccessTokenClaims, id: string, input: ExpenseClaimUpdateInput) {
    const row = await this.readable(claims, id);
    if (row.employeeId !== claims.employeeId) {
      throw new ForbiddenException('Only the person who raised a claim can edit it');
    }
    if (!canEdit(row.status as ExpenseClaimStatusCode)) {
      throw new BadRequestException(editError(row.status as ExpenseClaimStatusCode));
    }
    if (input.items) {
      await this.assertCategoriesUsable(
        claims.orgId,
        input.items.map((item) => item.categoryId),
      );
    }

    const updated = await this.prisma.expenseClaim.update({
      where: { id },
      data: {
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.items
          ? { items: { deleteMany: {}, create: input.items.map((item) => this.itemData(item)) } }
          : {}),
      },
      include: INCLUDE,
    });
    await auditMutation(
      this.prisma,
      { orgId: claims.orgId, userId: claims.sub },
      'expense.claim.update',
      'ExpenseClaim',
      id,
    );
    return mapClaim(updated, new Set());
  }

  async submit(claims: AccessTokenClaims, id: string) {
    const row = await this.readable(claims, id);
    if (row.employeeId !== claims.employeeId) {
      throw new ForbiddenException('Only the person who raised a claim can submit it');
    }
    if (!canSubmit(row.status as ExpenseClaimStatusCode)) {
      throw new BadRequestException(editError(row.status as ExpenseClaimStatusCode));
    }

    const categories = await this.categoriesFor(
      claims.orgId,
      row.items.map((item) => item.categoryId),
    );
    const items = row.items.map((item) => ({
      categoryId: item.categoryId,
      amount: money(item.amount),
      receiptId: item.receiptId,
    }));
    const { problems, total } = submissionProblems(items, categories);
    // Every problem at once. Being told about a missing receipt, fixing it, and
    // only then hearing about the cap is what makes people abandon a form.
    if (problems.length > 0) throw new BadRequestException(problems.join(' · '));

    const updated = await this.prisma.expenseClaim.update({
      where: { id },
      data: { status: 'SUBMITTED', submittedAt: new Date() },
      include: INCLUDE,
    });
    await auditMutation(
      this.prisma,
      { orgId: claims.orgId, userId: claims.sub },
      'expense.claim.submit',
      'ExpenseClaim',
      id,
      { after: { total } },
    );

    const who = `${row.employee.firstName} ${row.employee.lastName}`;
    await this.notifications.notifyPermission(
      claims.orgId,
      'expense.approve',
      {
        type: 'expense.submitted',
        title: `${who} claimed ${total}`,
        body: row.title,
        linkPath: `/expenses/${id}`,
      },
      { except: claims.sub },
    );
    return mapClaim(updated, new Set());
  }

  /** The claimant pulling it back. Not a delete — see `canWithdraw`. */
  async withdraw(claims: AccessTokenClaims, id: string) {
    const row = await this.readable(claims, id);
    if (row.employeeId !== claims.employeeId) {
      throw new ForbiddenException('Only the person who raised a claim can withdraw it');
    }
    if (!canWithdraw(row.status as ExpenseClaimStatusCode)) {
      throw new BadRequestException(editError(row.status as ExpenseClaimStatusCode));
    }
    const updated = await this.prisma.expenseClaim.update({
      where: { id },
      data: { status: 'CANCELLED' },
      include: INCLUDE,
    });
    await auditMutation(
      this.prisma,
      { orgId: claims.orgId, userId: claims.sub },
      'expense.claim.withdraw',
      'ExpenseClaim',
      id,
    );
    return mapClaim(updated, new Set());
  }

  /**
   * Approve or decline, and — on approval — turn the claim into payslip lines.
   *
   * The adjustment goes through `PayrollAdjustmentsService` rather than a
   * direct write, so the statutory-component refusal and the locked-month check
   * live in one place. `mode: 'add'` because a second claim in the same month
   * on the same component is a second thing, not a correction: replacing would
   * silently lose the first one's money.
   */
  async decide(
    claims: AccessTokenClaims,
    id: string,
    decision: 'APPROVED' | 'REJECTED',
    input: ExpenseDecisionInput,
  ) {
    const row = await this.readable(claims, id);
    if (!canDecide(row.status as ExpenseClaimStatusCode)) {
      throw new BadRequestException(editError(row.status as ExpenseClaimStatusCode));
    }
    await this.assertMayDecide(claims, row.employeeId);
    if (row.employeeId === claims.employeeId) {
      throw new ForbiddenException('You cannot decide your own claim');
    }

    if (decision === 'APPROVED') {
      if (!input.payrollMonth) {
        throw new BadRequestException('Choose which month this is paid in');
      }
      await this.payOut(claims, row, input.payrollMonth);
    }

    const updated = await this.prisma.expenseClaim.update({
      where: { id },
      data: {
        status: decision,
        payrollMonth: decision === 'APPROVED' ? input.payrollMonth : null,
        decidedById: claims.sub,
        decidedAt: new Date(),
        decisionNote: input.note ?? null,
      },
      include: INCLUDE,
    });
    await auditMutation(
      this.prisma,
      { orgId: claims.orgId, userId: claims.sub },
      `expense.claim.${decision.toLowerCase()}`,
      'ExpenseClaim',
      id,
      { after: { payrollMonth: updated.payrollMonth, note: input.note ?? null } },
    );

    const employee = await this.prisma.employee.findUnique({
      where: { id: row.employeeId },
      select: { userId: true },
    });
    await this.notifications.notify(employee?.userId ? [employee.userId] : [], {
      type: `expense.${decision.toLowerCase()}`,
      title:
        decision === 'APPROVED' ? 'Your expense claim was approved' : 'Your claim was declined',
      body:
        decision === 'APPROVED'
          ? `${row.title} — paid with ${input.payrollMonth} payroll.`
          : `${row.title}.${input.note ? ` ${input.note}` : ''}`,
      linkPath: `/expenses/${id}`,
    });

    const paid = await this.publishedMonths(claims.orgId, [updated.payrollMonth]);
    return mapClaim(updated, paid);
  }

  private async assertMayDecide(claims: AccessTokenClaims, employeeId: string) {
    const perms = new Set(claims.perms);
    if (perms.has('expense.approve')) return;
    if (perms.has('expense.approve.team')) {
      const managed = await this.prisma.employee.findFirst({
        where: { id: employeeId, managerId: claims.employeeId ?? '__none__' },
        select: { id: true },
      });
      if (managed) return;
    }
    throw new ForbiddenException('You cannot decide this claim');
  }

  private async payOut(
    claims: AccessTokenClaims,
    row: { id: string; employeeId: string; items: { categoryId: string; amount: unknown }[] },
    month: string,
  ) {
    const categories = await this.prisma.expenseCategory.findMany({
      where: { organizationId: claims.orgId, id: { in: row.items.map((i) => i.categoryId) } },
      select: { id: true, componentId: true },
    });
    const payouts = payoutByComponent(
      row.items.map((item) => ({ categoryId: item.categoryId, amount: money(item.amount) })),
      categories,
    );

    for (const [componentId, amount] of payouts) {
      await this.adjustments.upsert(
        { orgId: claims.orgId, userId: claims.sub },
        { employeeId: row.employeeId, month, componentId, amount, note: `Expense claim ${row.id}` },
        { mode: 'add' },
      );
    }
  }
}
