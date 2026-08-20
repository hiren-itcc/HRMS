import { defaultSettings } from '@hrms/shared';
import type { AccessTokenClaims } from '@hrms/types';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PayrollRunsService } from './payroll-runs.service';

type Mock = jest.Mock;

/**
 * Statutory components are switched off so every figure below is
 * hand-computable: gross is the structure line, deductions are the TDS the
 * tax service double hands back, net is the difference. The statutory engine
 * has its own dense suite; this one is for what the run service itself does —
 * eligibility, the destructive rebuild, LOP derivation, and the state machine.
 */
function testSettings() {
  const settings = defaultSettings();
  settings.payroll.pf.enabled = false;
  settings.payroll.esi.enabled = false;
  settings.payroll.professionalTax.enabled = false;
  return settings;
}

/** A run row complete enough for both requireTransition and mapRun. */
const runRow = (over: Partial<Record<string, unknown>> = {}) => ({
  id: 'r1',
  month: '2026-07',
  status: 'DRAFT',
  payDate: null,
  notes: null,
  employeeCount: 0,
  totalEarnings: 0,
  totalDeductions: 0,
  totalEmployerCost: 0,
  netPayable: 0,
  calculatedAt: null,
  approvedAt: null,
  lockedAt: null,
  publishedAt: null,
  createdAt: new Date('2026-07-01T00:00:00.000Z'),
  ...over,
});

const employeeRow = (over: Partial<Record<string, unknown>> = {}) => ({
  id: 'e1',
  employeeCode: 'EMP001',
  firstName: 'Asha',
  lastName: 'Verma',
  joinDate: new Date('2020-01-01T00:00:00.000Z'),
  exitDate: null,
  department: { name: 'Engineering' },
  designation: { title: 'Engineer' },
  bankDetail: { bankName: 'HDFC', accountNumber: '12345678901234', ifscCode: 'HDFC0000001' },
  salaries: [
    {
      paymentMethod: 'BANK_TRANSFER',
      monthlyCtc: 50_000,
      structure: {
        name: 'Standard',
        lines: [
          {
            calcType: 'FLAT',
            value: 50_000,
            order: 1,
            component: { code: 'BASIC', name: 'Basic', kind: 'EARNING' },
          },
        ],
      },
    },
  ],
  ...over,
});

function makeService() {
  const tx = {
    payslipLine: { deleteMany: jest.fn(), createMany: jest.fn() },
    payslip: {
      deleteMany: jest.fn(),
      createManyAndReturn: jest.fn(async ({ data }: { data: { employeeId: string }[] }) =>
        data.map((row, index) => ({ id: `p${index + 1}`, employeeId: row.employeeId })),
      ),
    },
    payrollRun: { update: jest.fn() },
  };
  const prisma = {
    payrollRun: {
      findFirst: jest.fn().mockResolvedValue(runRow()),
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
      create: jest.fn(async ({ data }: { data: object }) => runRow(data as object)),
      update: jest.fn(),
    },
    employee: { findMany: jest.fn().mockResolvedValue([employeeRow()]) },
    leaveRequest: { findMany: jest.fn().mockResolvedValue([]) },
    attendanceRecord: { findMany: jest.fn().mockResolvedValue([]) },
    auditLog: { create: jest.fn() },
    // Supports both shapes the service uses: the array form (list) and the
    // interactive callback form (calculate).
    $transaction: jest.fn(async (arg: unknown) =>
      Array.isArray(arg) ? Promise.all(arg) : (arg as (t: typeof tx) => unknown)(tx),
    ),
  };
  const settings = { get: jest.fn().mockResolvedValue(testSettings()) };
  const adjustments = { forMonth: jest.fn().mockResolvedValue(new Map()) };
  const tax = {
    tdsForRun: jest.fn().mockResolvedValue({ tds: new Map([['e1', 2_000]]), unconfigured: [] }),
  };
  return {
    service: new PayrollRunsService(
      // biome-ignore lint/suspicious/noExplicitAny: structural test doubles
      prisma as any,
      // biome-ignore lint/suspicious/noExplicitAny: structural test doubles
      settings as any,
      // biome-ignore lint/suspicious/noExplicitAny: structural test doubles
      adjustments as any,
      // biome-ignore lint/suspicious/noExplicitAny: structural test doubles
      tax as any,
    ),
    prisma,
    tx,
    settings,
    adjustments,
    tax,
  };
}

const claims = (over: Partial<AccessTokenClaims> = {}): AccessTokenClaims => ({
  sub: 'u1',
  orgId: 'org1',
  roleCode: 'HR',
  perms: ['payroll.process', 'payroll.approve'],
  ...over,
});

describe('PayrollRunsService.create', () => {
  it('refuses a future month', async () => {
    const { service } = makeService();
    const nextYear = `${new Date().getFullYear() + 1}-01`;
    await expect(
      service.create({ orgId: 'org1', userId: 'u1' }, { month: nextYear }),
    ).rejects.toThrow(/future month/);
  });

  it('refuses a month that already has a run, naming its status', async () => {
    const { service, prisma } = makeService();
    (prisma.payrollRun.findFirst as Mock).mockResolvedValue({ id: 'r0', status: 'LOCKED' });
    await expect(
      service.create({ orgId: 'org1', userId: 'u1' }, { month: '2026-06' }),
    ).rejects.toThrow(/already exists \(locked\)/);
  });

  it('creates and audits a valid month', async () => {
    const { service, prisma } = makeService();
    (prisma.payrollRun.findFirst as Mock).mockResolvedValue(null);
    const result = await service.create({ orgId: 'org1', userId: 'u1' }, { month: '2026-06' });
    expect(result.month).toBe('2026-06');
    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: 'payroll.run.create', entity: 'PayrollRun' }),
      }),
    );
  });
});

describe('PayrollRunsService state machine (via act)', () => {
  it('404s an unknown run before checking anything else', async () => {
    const { service, prisma } = makeService();
    (prisma.payrollRun.findFirst as Mock).mockResolvedValue(null);
    await expect(service.act(claims(), 'nope', { action: 'approve' })).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('refuses an action the caller lacks the permission for, naming it', async () => {
    const { service, prisma } = makeService();
    (prisma.payrollRun.findFirst as Mock).mockResolvedValue(runRow({ status: 'IN_REVIEW' }));
    await expect(
      service.act(claims({ perms: ['payroll.process'] }), 'r1', { action: 'approve' }),
    ).rejects.toThrow(/payroll\.approve/);
  });

  it('refuses an illegal transition with the workflow message', async () => {
    const { service } = makeService(); // runRow() is DRAFT
    await expect(service.act(claims(), 'r1', { action: 'approve' })).rejects.toThrow(
      /must be IN_REVIEW/,
    );
  });

  /*
   * The invariant the stamps exist for: the audit trail must never show a run
   * that is under review and approved at the same time.
   */
  it('reopen clears the approval stamps it reverses', async () => {
    const { service, prisma } = makeService();
    (prisma.payrollRun.findFirst as Mock).mockResolvedValue(runRow({ status: 'APPROVED' }));
    await service.act(claims(), 'r1', { action: 'reopen' });
    expect(prisma.payrollRun.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'IN_REVIEW',
          approvedAt: null,
          approvedById: null,
        }),
      }),
    );
  });

  it('approve stamps who approved and when', async () => {
    const { service, prisma } = makeService();
    (prisma.payrollRun.findFirst as Mock).mockResolvedValue(runRow({ status: 'IN_REVIEW' }));
    await service.act(claims(), 'r1', { action: 'approve' });
    expect(prisma.payrollRun.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'APPROVED',
          approvedAt: expect.any(Date),
          approvedById: 'u1',
        }),
      }),
    );
  });

  it('a locked run refuses with the adjustment guidance, not a state list', async () => {
    const { service, prisma } = makeService();
    (prisma.payrollRun.findFirst as Mock).mockResolvedValue(runRow({ status: 'LOCKED' }));
    await expect(service.act(claims(), 'r1', { action: 'reopen' })).rejects.toThrow(
      /adjustment in the next run/,
    );
  });
});

describe('PayrollRunsService.calculate', () => {
  it('refuses to calculate an approved run', async () => {
    const { service, prisma } = makeService();
    (prisma.payrollRun.findFirst as Mock).mockResolvedValue(runRow({ status: 'APPROVED' }));
    await expect(service.calculate(claims(), 'r1')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rebuilds destructively: old lines and payslips go before new ones land', async () => {
    const { service, tx } = makeService();
    await service.calculate(claims(), 'r1');
    expect(tx.payslipLine.deleteMany).toHaveBeenCalledWith({
      where: { payslip: { runId: 'r1' } },
    });
    expect(tx.payslip.deleteMany).toHaveBeenCalledWith({ where: { runId: 'r1' } });
    const deleteOrder = (tx.payslip.deleteMany as Mock).mock.invocationCallOrder[0] as number;
    const createOrder = (tx.payslip.createManyAndReturn as Mock).mock
      .invocationCallOrder[0] as number;
    expect(deleteOrder).toBeLessThan(createOrder);
  });

  /*
   * Hand-computed: July 2026 has 31 days, no LOP, one FLAT line of 50,000 and
   * statutory switched off — so gross is 50,000, the only deduction is the
   * 2,000 TDS the tax double returned, and net is 48,000. If any of these
   * drift, the engine is being fed something other than what this service
   * claims to feed it.
   */
  it('writes the payslip the inputs demand, snapshot columns included', async () => {
    const { service, tx } = makeService();
    await service.calculate(claims(), 'r1');

    const { data } = (tx.payslip.createManyAndReturn as Mock).mock.calls[0][0] as {
      data: Record<string, unknown>[];
    };
    expect(data).toHaveLength(1);
    expect(data[0]).toMatchObject({
      employeeId: 'e1',
      employeeCode: 'EMP001',
      employeeName: 'Asha Verma',
      departmentName: 'Engineering',
      structureName: 'Standard',
      workingDays: 31,
      lopDays: 0,
      payableDays: 31,
      grossEarnings: 50_000,
      totalDeductions: 2_000,
      netPay: 48_000,
    });
    // Snapshot, not a reference: the account number never lands in clear.
    expect(data[0]?.accountNumberMasked).not.toContain('1234567890');

    const lines = (tx.payslipLine.createMany as Mock).mock.calls[0][0] as {
      data: { payslipId: string; componentCode: string; amount: number }[];
    };
    expect(lines.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ payslipId: 'p1', componentCode: 'BASIC', amount: 50_000 }),
        expect.objectContaining({ payslipId: 'p1', componentCode: 'TDS', amount: 2_000 }),
      ]),
    );
  });

  it('skips an employee with no salary rather than writing a zero payslip', async () => {
    const { service, prisma, tx } = makeService();
    (prisma.employee.findMany as Mock).mockResolvedValue([
      employeeRow(),
      employeeRow({ id: 'e2', employeeCode: 'EMP002', salaries: [] }),
    ]);
    await service.calculate(claims(), 'r1');
    const { data } = (tx.payslip.createManyAndReturn as Mock).mock.calls[0][0] as {
      data: { employeeId: string }[];
    };
    expect(data.map((row) => row.employeeId)).toEqual(['e1']);
    expect(tx.payrollRun.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ employeeCount: 1 }) }),
    );
  });

  /*
   * The LOP union rule, hand-computed. Unpaid leave on the 10th and 11th (2),
   * an ABSENT mark also on the 11th (already counted — must not double), a
   * separate ABSENT on the 12th (1), and a half-day unpaid leave on the 15th
   * (0.5): 3.5 days. On the calendar basis a 31,000 CTC over 31 days is 1,000
   * a day, so gross is 27,500.
   */
  it('derives LOP as a union by date — a day is never counted twice', async () => {
    const { service, prisma, tx } = makeService();
    (prisma.employee.findMany as Mock).mockResolvedValue([
      employeeRow({
        salaries: [
          {
            paymentMethod: 'BANK_TRANSFER',
            monthlyCtc: 31_000,
            structure: {
              name: 'Standard',
              lines: [
                {
                  calcType: 'FLAT',
                  value: 31_000,
                  order: 1,
                  component: { code: 'BASIC', name: 'Basic', kind: 'EARNING' },
                },
              ],
            },
          },
        ],
      }),
    ]);
    (prisma.leaveRequest.findMany as Mock).mockResolvedValue([
      {
        employeeId: 'e1',
        startDate: new Date('2026-07-10T00:00:00.000Z'),
        endDate: new Date('2026-07-11T00:00:00.000Z'),
        halfDaySide: null,
      },
      {
        employeeId: 'e1',
        startDate: new Date('2026-07-15T00:00:00.000Z'),
        endDate: new Date('2026-07-15T00:00:00.000Z'),
        halfDaySide: 'FIRST_HALF',
      },
    ]);
    (prisma.attendanceRecord.findMany as Mock).mockResolvedValue([
      { employeeId: 'e1', date: new Date('2026-07-11T00:00:00.000Z') },
      { employeeId: 'e1', date: new Date('2026-07-12T00:00:00.000Z') },
    ]);
    await service.calculate(claims(), 'r1');
    const { data } = (tx.payslip.createManyAndReturn as Mock).mock.calls[0][0] as {
      data: Record<string, unknown>[];
    };
    expect(data[0]).toMatchObject({ lopDays: 3.5, payableDays: 27.5, grossEarnings: 27_500 });
  });

  /*
   * An unconfigured financial year must not stop payroll, but it must not
   * pass unmentioned: the count rides on the response (the approver sees it)
   * and on the audit row ("why did nobody have TDS in April" is asked months
   * later, and the audit row is the only place that still answers it).
   */
  it('reports employees skipped for an unconfigured tax year, and still pays them', async () => {
    const { service, tax, tx, prisma } = makeService();
    (tax.tdsForRun as Mock).mockResolvedValue({ tds: new Map(), unconfigured: ['e1'] });
    const result = await service.calculate(claims(), 'r1');

    expect(result.taxUnconfigured).toBe(1);
    const { data } = (tx.payslip.createManyAndReturn as Mock).mock.calls[0][0] as {
      data: Record<string, unknown>[];
    };
    // Paid in full, with no TDS line — skipped is not zeroed-and-hidden.
    expect(data[0]).toMatchObject({ grossEarnings: 50_000, netPay: 50_000 });
    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          meta: expect.objectContaining({
            after: expect.objectContaining({ taxUnconfigured: 1 }),
          }),
        }),
      }),
    );
  });
});
