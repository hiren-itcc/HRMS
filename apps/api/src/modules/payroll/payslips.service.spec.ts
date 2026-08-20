import type { AccessTokenClaims } from '@hrms/types';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { PayslipsService } from './payslips.service';

type Mock = jest.Mock;

const payslipRow = (over: Partial<Record<string, unknown>> = {}) => ({
  id: 'p1',
  runId: 'r1',
  organizationId: 'org1',
  employeeId: 'e1',
  employeeCode: 'EMP001',
  employeeName: 'Asha Verma',
  departmentName: 'Engineering',
  designationName: 'Engineer',
  structureName: 'Standard',
  bankName: 'HDFC',
  accountNumberMasked: '**** 1234',
  ifsc: 'HDFC0000001',
  workingDays: 31,
  lopDays: 0,
  payableDays: 31,
  grossEarnings: 50_000,
  totalDeductions: 2_000,
  employerContribution: 0,
  netPay: 48_000,
  carriedShortfall: 0,
  paymentStatus: 'PENDING',
  paymentMethod: 'BANK_TRANSFER',
  paidAt: null,
  paymentRef: null,
  failureReason: null,
  lines: [
    { componentCode: 'BASIC', componentName: 'Basic', kind: 'EARNING', amount: 50_000, order: 1 },
    {
      componentCode: 'TDS',
      componentName: 'Income tax',
      kind: 'DEDUCTION',
      amount: 2_000,
      order: 9,
    },
  ],
  run: { month: '2026-07', status: 'PUBLISHED', payDate: null },
  ...over,
});

function makeService() {
  const prisma = {
    payslip: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn().mockResolvedValue(payslipRow()),
      count: jest.fn().mockResolvedValue(0),
      updateMany: jest.fn(),
    },
    employee: { findMany: jest.fn().mockResolvedValue([]), findFirst: jest.fn() },
    auditLog: { create: jest.fn() },
    $transaction: jest.fn((ops: Promise<unknown>[]) => Promise.all(ops)),
  };
  return {
    // biome-ignore lint/suspicious/noExplicitAny: structural test doubles
    service: new PayslipsService(prisma as any),
    prisma,
  };
}

const claims = (over: Partial<AccessTokenClaims> = {}): AccessTokenClaims => ({
  sub: 'u1',
  orgId: 'org1',
  roleCode: 'EMPLOYEE',
  perms: [],
  ...over,
});

const query = { page: 1, limit: 20, order: 'asc' as const };

/** The where clause the list actually sent to Prisma. */
function sentWhere(prisma: ReturnType<typeof makeService>['prisma']) {
  return ((prisma.payslip.findMany as Mock).mock.calls[0][0] as { where: object }).where;
}

describe('PayslipsService.list visibility', () => {
  it('payroll.read sees everything — no status or employee restriction', async () => {
    const { service, prisma } = makeService();
    await service.list(claims({ perms: ['payroll.read'] }), query);
    const where = sentWhere(prisma) as Record<string, unknown>;
    expect(where).not.toHaveProperty('employeeId');
    expect(where).not.toHaveProperty('run');
  });

  it('an employee sees only their own published payslips', async () => {
    const { service, prisma } = makeService();
    await service.list(claims({ perms: ['payroll.read.own'], employeeId: 'e1' }), query);
    expect(sentWhere(prisma)).toMatchObject({
      run: { status: 'PUBLISHED' },
      employeeId: 'e1',
    });
  });

  it('a manager sees their reports plus themselves, published only', async () => {
    const { service, prisma } = makeService();
    (prisma.employee.findMany as Mock).mockResolvedValue([{ id: 'e2' }, { id: 'e3' }]);
    await service.list(claims({ perms: ['payroll.read.team'], employeeId: 'e-mgr' }), query);
    expect(sentWhere(prisma)).toMatchObject({
      run: { status: 'PUBLISHED' },
      employeeId: { in: ['e2', 'e3', 'e-mgr'] },
    });
  });

  /*
   * A token with no employee record must match nothing, not everything —
   * the same '__none__' sentinel every other scoped list uses.
   */
  it('a token with no employeeId matches no rows rather than all rows', async () => {
    const { service, prisma } = makeService();
    await service.list(claims({ perms: ['payroll.read.own'] }), query);
    expect(sentWhere(prisma)).toMatchObject({ employeeId: '__none__' });
  });
});

describe('PayslipsService.mine', () => {
  /*
   * mine() forces the scope down to read.own regardless of what the token
   * carries. An HR person's "my salary" page must show their payslips, not
   * the whole company's.
   */
  it('restricts even a payroll.read holder to their own published slips', async () => {
    const { service, prisma } = makeService();
    await service.mine(claims({ perms: ['payroll.read'], employeeId: 'e1' }), query);
    expect(sentWhere(prisma)).toMatchObject({
      run: { status: 'PUBLISHED' },
      employeeId: 'e1',
    });
  });

  it('returns an empty page for a user with no employee record', async () => {
    const { service, prisma } = makeService();
    const result = await service.mine(claims({ perms: ['payroll.read'] }), query);
    expect(result.data).toEqual([]);
    expect(prisma.payslip.findMany).not.toHaveBeenCalled();
  });
});

describe('PayslipsService.get', () => {
  it('404s a payslip outside the org', async () => {
    const { service, prisma } = makeService();
    (prisma.payslip.findFirst as Mock).mockResolvedValue(null);
    await expect(service.get(claims({ perms: ['payroll.read'] }), 'p1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  /*
   * The figures are still moving before publish, and a payslip seen once
   * cannot be unseen — so to its owner an unpublished payslip is refused.
   */
  it('refuses the owner an unpublished payslip', async () => {
    const { service, prisma } = makeService();
    (prisma.payslip.findFirst as Mock).mockResolvedValue(
      payslipRow({ run: { month: '2026-07', status: 'IN_REVIEW', payDate: null } }),
    );
    await expect(
      service.get(claims({ perms: ['payroll.read.own'], employeeId: 'e1' }), 'p1'),
    ).rejects.toThrow(/not been published/);
  });

  it('lets payroll.read see a payslip in review', async () => {
    const { service, prisma } = makeService();
    (prisma.payslip.findFirst as Mock).mockResolvedValue(
      payslipRow({ run: { month: '2026-07', status: 'IN_REVIEW', payDate: null } }),
    );
    await expect(service.get(claims({ perms: ['payroll.read'] }), 'p1')).resolves.toMatchObject({
      runStatus: 'IN_REVIEW',
    });
  });

  it("refuses a manager another manager's report", async () => {
    const { service, prisma } = makeService();
    (prisma.employee.findFirst as Mock).mockResolvedValue(null);
    await expect(
      service.get(claims({ perms: ['payroll.read.team'], employeeId: 'e-other' }), 'p1'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  /*
   * The response contract payroll-tax.e2e-spec.ts leans on: lines are split
   * by kind into three arrays and componentCode is renamed to code. A
   * consumer looking for a flat `lines` array finds nothing — asserted here
   * so the shape cannot drift without a test noticing.
   */
  it('splits lines by kind and renames componentCode to code', async () => {
    const { service } = makeService();
    const result = await service.get(claims({ perms: ['payroll.read'] }), 'p1');
    expect(result.earnings).toEqual([
      { code: 'BASIC', name: 'Basic', kind: 'EARNING', amount: 50_000 },
    ]);
    expect(result.deductions).toEqual([
      { code: 'TDS', name: 'Income tax', kind: 'DEDUCTION', amount: 2_000 },
    ]);
    expect(result).not.toHaveProperty('lines');
    expect(result.totals).toMatchObject({ gross: 50_000, deductions: 2_000, net: 48_000 });
  });
});

describe('PayslipsService.updatePayment', () => {
  const hr = () => claims({ perms: ['payroll.pay'] });

  it('demands a reason for a failure', async () => {
    const { service } = makeService();
    await expect(
      service.updatePayment(hr(), { payslipIds: ['p1'], status: 'FAILED' }),
    ).rejects.toThrow(/needs a reason/);
  });

  it('404s when any requested payslip is missing', async () => {
    const { service, prisma } = makeService();
    (prisma.payslip.findMany as Mock).mockResolvedValue([payslipRow()]);
    await expect(
      service.updatePayment(hr(), { payslipIds: ['p1', 'p-missing'], status: 'PROCESSING' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('refuses payment against an unpublished run, naming the month', async () => {
    const { service, prisma } = makeService();
    (prisma.payslip.findMany as Mock).mockResolvedValue([
      payslipRow({ run: { month: '2026-07', status: 'LOCKED' } }),
    ]);
    await expect(
      service.updatePayment(hr(), { payslipIds: ['p1'], status: 'PROCESSING' }),
    ).rejects.toThrow(/2026-07 is not published/);
  });

  it('refuses re-paying a paid payslip, naming the employee', async () => {
    const { service, prisma } = makeService();
    (prisma.payslip.findMany as Mock).mockResolvedValue([payslipRow({ paymentStatus: 'PAID' })]);
    await expect(
      service.updatePayment(hr(), { payslipIds: ['p1'], status: 'PROCESSING' }),
    ).rejects.toThrow(/Asha Verma: This payslip is already paid/);
  });

  /*
   * One bank file covers many payslips; one of them being in the wrong state
   * must refuse the whole batch before anything is written — a partial batch
   * would leave the register disagreeing with the bank file.
   */
  it('writes nothing when one payslip of a batch is illegal', async () => {
    const { service, prisma } = makeService();
    (prisma.payslip.findMany as Mock).mockResolvedValue([
      payslipRow(),
      payslipRow({ id: 'p2', paymentStatus: 'PAID', employeeName: 'Rohan Desai' }),
    ]);
    await expect(
      service.updatePayment(hr(), { payslipIds: ['p1', 'p2'], status: 'PROCESSING' }),
    ).rejects.toThrow(/Rohan Desai/);
    expect(prisma.payslip.updateMany).not.toHaveBeenCalled();
  });

  it('marks PAID with a timestamp and audits the batch size', async () => {
    const { service, prisma } = makeService();
    (prisma.payslip.findMany as Mock).mockResolvedValue([
      payslipRow({ paymentStatus: 'PROCESSING' }),
      payslipRow({ id: 'p2', paymentStatus: 'PROCESSING' }),
    ]);
    const result = await service.updatePayment(hr(), {
      payslipIds: ['p1', 'p2'],
      status: 'PAID',
      paymentRef: 'NEFT-42',
    });
    expect(result).toEqual({ updated: 2, status: 'PAID' });
    expect(prisma.payslip.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          paymentStatus: 'PAID',
          paidAt: expect.any(Date),
          paymentRef: 'NEFT-42',
        }),
      }),
    );
    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'payroll.payment.update',
          meta: expect.objectContaining({ count: 2, reference: 'NEFT-42' }),
        }),
      }),
    );
  });

  it('clears paidAt again when a payment moves off PAID territory', async () => {
    const { service, prisma } = makeService();
    (prisma.payslip.findMany as Mock).mockResolvedValue([
      payslipRow({ paymentStatus: 'PROCESSING' }),
    ]);
    await service.updatePayment(hr(), {
      payslipIds: ['p1'],
      status: 'FAILED',
      failureReason: 'account closed',
    });
    expect(prisma.payslip.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          paymentStatus: 'FAILED',
          paidAt: null,
          failureReason: 'account closed',
        }),
      }),
    );
  });
});
