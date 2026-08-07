import type { AccessTokenClaims } from '@hrms/types';
import { ExpensesService } from './expenses.service';

type Mock = jest.Mock;

/**
 * The claim workflow, and the one thing it does to another module: turn an
 * approved claim into payslip lines.
 *
 * The arithmetic and the transitions are `expense.rules.spec.ts` — pure, and
 * exhaustive there. What is here is the wiring those rules hang off, and the
 * seam into payroll, which is the only place this module can break something
 * that was already working.
 */

const TRAVEL = { id: 'c-travel', componentId: 'comp-reimb' };
const MEALS = { id: 'c-meals', componentId: 'comp-reimb' };
const PHONE = { id: 'c-phone', componentId: 'comp-phone' };

const CLAIM = {
  id: 'ec1',
  organizationId: 'org1',
  employeeId: 'e1',
  title: 'Client visit, Pune',
  status: 'SUBMITTED',
  payrollMonth: null,
  submittedAt: new Date('2026-08-01T00:00:00Z'),
  decidedAt: null,
  decisionNote: null,
  createdAt: new Date('2026-08-01T00:00:00Z'),
  employee: { id: 'e1', firstName: 'Asha', lastName: 'Verma', employeeCode: 'EMP-0005' },
  items: [
    {
      id: 'i1',
      categoryId: 'c-travel',
      spentOn: new Date('2026-07-28T00:00:00Z'),
      amount: 1200,
      description: 'Train',
      receiptId: 'doc1',
      category: { id: 'c-travel', name: 'Travel', code: 'TRAVEL' },
    },
    {
      id: 'i2',
      categoryId: 'c-meals',
      spentOn: new Date('2026-07-28T00:00:00Z'),
      amount: 300,
      description: 'Lunch',
      receiptId: null,
      category: { id: 'c-meals', name: 'Meals', code: 'MEALS' },
    },
  ],
};

function makeService(claim: unknown = CLAIM) {
  // biome-ignore lint/suspicious/noExplicitAny: structural test double
  const prisma: any = {
    expenseClaim: {
      findFirst: jest.fn().mockResolvedValue(claim),
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
      update: jest
        .fn()
        .mockImplementation(({ data }: { data: Record<string, unknown> }) =>
          Promise.resolve({ ...(claim as object), ...data, items: (claim as typeof CLAIM).items }),
        ),
      create: jest.fn().mockResolvedValue(claim),
    },
    expenseCategory: {
      findMany: jest.fn().mockResolvedValue([TRAVEL, MEALS, PHONE]),
      count: jest.fn().mockResolvedValue(2),
    },
    employee: {
      findUnique: jest.fn().mockResolvedValue({ userId: 'u-asha' }),
      findFirst: jest.fn(),
    },
    payrollRun: { findMany: jest.fn().mockResolvedValue([]) },
    auditLog: { create: jest.fn().mockResolvedValue({}) },
    $transaction: jest.fn((ops: unknown[]) => Promise.all(ops as Promise<unknown>[])),
  };
  const adjustments = { upsert: jest.fn().mockResolvedValue({ id: 'adj1' }) };
  const notifications = { notify: jest.fn(), notifyPermission: jest.fn() };
  const service = new ExpensesService(
    prisma,
    // biome-ignore lint/suspicious/noExplicitAny: structural test double
    adjustments as any,
    // biome-ignore lint/suspicious/noExplicitAny: structural test double
    notifications as any,
  );
  return { service, prisma, adjustments, notifications };
}

/** Finance: may approve anybody's claim, and is not the claimant. */
const finance: AccessTokenClaims = {
  sub: 'u-fin',
  orgId: 'org1',
  roleCode: 'FINANCE',
  perms: ['expense.read', 'expense.approve'],
  employeeId: 'e-fin',
};

describe('approving a claim', () => {
  /*
   * The seam. Two categories paying out on one component have to arrive as one
   * figure: PayrollAdjustment is unique per (employee, month, component), and
   * two rows would be two payslip lines with the same code.
   */
  it('groups the payout by pay component, not by category', async () => {
    const { service, adjustments } = makeService();

    await service.decide(finance, 'ec1', 'APPROVED', { payrollMonth: '2026-09' });

    expect(adjustments.upsert).toHaveBeenCalledTimes(1);
    expect(adjustments.upsert).toHaveBeenCalledWith(
      { orgId: 'org1', userId: 'u-fin' },
      expect.objectContaining({
        employeeId: 'e1',
        month: '2026-09',
        componentId: 'comp-reimb',
        amount: 1500,
      }),
      // Adds rather than replaces: a second claim in the same month on the same
      // component is a second thing, and replacing would lose the first.
      { mode: 'add' },
    );
  });

  /*
   * Through the payroll service rather than a direct write, so the statutory
   * refusal and the locked-month check stay in one place. This asserts the
   * refusal propagates rather than being swallowed into a half-approved claim.
   */
  it('does not approve when payroll refuses the month', async () => {
    const { service, adjustments, prisma } = makeService();
    (adjustments.upsert as Mock).mockRejectedValue(new Error('Payroll for 2026-09 is locked'));

    await expect(
      service.decide(finance, 'ec1', 'APPROVED', { payrollMonth: '2026-09' }),
    ).rejects.toThrow(/locked/);
    expect(prisma.expenseClaim.update).not.toHaveBeenCalled();
  });

  it('insists on a month to pay it in', async () => {
    const { service, adjustments } = makeService();
    await expect(service.decide(finance, 'ec1', 'APPROVED', {})).rejects.toThrow(/which month/i);
    expect(adjustments.upsert).not.toHaveBeenCalled();
  });

  it('writes no payroll row when the claim is declined', async () => {
    const { service, adjustments, prisma } = makeService();

    await service.decide(finance, 'ec1', 'REJECTED', { note: 'Not reimbursable' });

    expect(adjustments.upsert).not.toHaveBeenCalled();
    expect(prisma.expenseClaim.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ payrollMonth: null }) }),
    );
  });

  it('tells the claimant either way', async () => {
    const { service, notifications } = makeService();

    await service.decide(finance, 'ec1', 'APPROVED', { payrollMonth: '2026-09' });

    expect(notifications.notify).toHaveBeenCalledWith(
      ['u-asha'],
      expect.objectContaining({ type: 'expense.approved', linkPath: '/expenses/ec1' }),
    );
  });

  /* An approver signing off their own spending is the whole point of approval. */
  it('refuses to let somebody decide their own claim', async () => {
    const { service } = makeService();
    const self: AccessTokenClaims = { ...finance, employeeId: 'e1' };

    await expect(
      service.decide(self, 'ec1', 'APPROVED', { payrollMonth: '2026-09' }),
    ).rejects.toThrow(/your own claim/i);
  });

  it('refuses a claim that has already been decided', async () => {
    const { service } = makeService({ ...CLAIM, status: 'APPROVED' });

    await expect(
      service.decide(finance, 'ec1', 'APPROVED', { payrollMonth: '2026-09' }),
    ).rejects.toThrow(/on its way to payroll/i);
  });
});

describe('who can see a claim', () => {
  /*
   * 404 rather than 403: whether a claim exists is itself information about
   * somebody's spending. Same rule notifications and documents follow.
   */
  it('hides somebody else’s claim behind a 404', async () => {
    const { service } = makeService();
    const stranger: AccessTokenClaims = {
      sub: 'u-x',
      orgId: 'org1',
      roleCode: 'EMPLOYEE',
      perms: ['expense.read.own'],
      employeeId: 'e-other',
    };

    await expect(service.get(stranger, 'ec1')).rejects.toThrow(/not found/i);
  });

  it('lets the claimant see their own', async () => {
    const { service } = makeService();
    const owner: AccessTokenClaims = {
      sub: 'u-asha',
      orgId: 'org1',
      roleCode: 'EMPLOYEE',
      perms: ['expense.read.own'],
      employeeId: 'e1',
    };

    await expect(service.get(owner, 'ec1')).resolves.toMatchObject({ id: 'ec1', total: 1500 });
  });
});

/*
 * `paid` is derived from payroll rather than stored, so it cannot go stale —
 * the same bargain attendance's day-close and announcement expiry make.
 */
describe('whether the money arrived', () => {
  it('is false while the run is unpublished', async () => {
    const { service } = makeService({ ...CLAIM, status: 'APPROVED', payrollMonth: '2026-09' });
    await expect(service.get(finance, 'ec1')).resolves.toMatchObject({ paid: false });
  });

  it('is true once the run for that month is published', async () => {
    const { service, prisma } = makeService({
      ...CLAIM,
      status: 'APPROVED',
      payrollMonth: '2026-09',
    });
    (prisma.payrollRun.findMany as Mock).mockResolvedValue([{ month: '2026-09' }]);

    await expect(service.get(finance, 'ec1')).resolves.toMatchObject({ paid: true });
  });

  /* One query for the page, not one per claim — the N+1 wfh had to have removed. */
  it('asks payroll once for a whole page of claims', async () => {
    const { service, prisma } = makeService();
    (prisma.expenseClaim.findMany as Mock).mockResolvedValue([
      { ...CLAIM, id: 'a', payrollMonth: '2026-09' },
      { ...CLAIM, id: 'b', payrollMonth: '2026-09' },
      { ...CLAIM, id: 'c', payrollMonth: '2026-10' },
    ]);

    await service.list(finance, { page: 1, limit: 20, order: 'asc', scope: 'all' });

    expect(prisma.payrollRun.findMany).toHaveBeenCalledTimes(1);
    expect((prisma.payrollRun.findMany as Mock).mock.calls[0][0].where.month.in.sort()).toEqual([
      '2026-09',
      '2026-10',
    ]);
  });
});
