import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PayrollAdjustmentsService } from './payroll-adjustments.service';

type Mock = jest.Mock;

const ctx = { orgId: 'org1', userId: 'u1' };
const input = {
  employeeId: 'e1',
  month: '2026-08',
  componentId: 'c1',
  amount: 5000,
  note: null,
};

function makeService(overrides: { component?: unknown; settledRun?: unknown } = {}) {
  const prisma = {
    employee: { findFirst: jest.fn().mockResolvedValue({ id: 'e1' }) },
    payComponent: {
      findFirst: jest
        .fn()
        .mockResolvedValue(
          overrides.component ?? { id: 'c1', kind: 'EARNING', isStatutory: false, code: 'BONUS' },
        ),
    },
    payrollRun: { findFirst: jest.fn().mockResolvedValue(overrides.settledRun ?? null) },
    payrollAdjustment: {
      findFirst: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      upsert: jest.fn().mockResolvedValue({ id: 'a1' }),
      delete: jest.fn(),
    },
    auditLog: { create: jest.fn() },
  };
  // biome-ignore lint/suspicious/noExplicitAny: structural test double
  const service = new PayrollAdjustmentsService(prisma as any);
  return { service, prisma };
}

describe('PayrollAdjustmentsService.upsert', () => {
  it('stores an earning adjustment for the employee, month and component', async () => {
    const { service, prisma } = makeService();
    await expect(service.upsert(ctx, input)).resolves.toEqual({ id: 'a1' });

    const call = (prisma.payrollAdjustment.upsert as Mock).mock.calls[0][0];
    expect(call.where.employeeId_month_componentId).toEqual({
      employeeId: 'e1',
      month: '2026-08',
      componentId: 'c1',
    });
  });

  it('raises the existing figure rather than adding a second row', async () => {
    const { service, prisma } = makeService();
    await service.upsert(ctx, { ...input, amount: 9000 });

    // Two "Bonus" rows would print two payslip lines with the same code and no
    // way to tell them apart, so entering it twice edits the one figure.
    const call = (prisma.payrollAdjustment.upsert as Mock).mock.calls[0][0];
    expect(call.update).toMatchObject({ amount: 9000 });
  });

  it('refuses a statutory component — PF is computed, not typed in', async () => {
    const { service } = makeService({
      component: { id: 'c1', kind: 'DEDUCTION', isStatutory: true, code: 'PF' },
    });
    await expect(service.upsert(ctx, input)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('refuses an employer-cost component, which never touches net pay', async () => {
    const { service } = makeService({
      component: { id: 'c1', kind: 'EMPLOYER_CONTRIBUTION', isStatutory: false, code: 'EPF' },
    });
    await expect(service.upsert(ctx, input)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('refuses once the month is locked — that run is what someone was paid', async () => {
    const { service } = makeService({ settledRun: { status: 'LOCKED' } });
    await expect(service.upsert(ctx, input)).rejects.toThrow(/locked/i);
  });

  it('refuses an employee outside the caller’s organization', async () => {
    const { service, prisma } = makeService();
    (prisma.employee.findFirst as Mock).mockResolvedValue(null);
    await expect(service.upsert(ctx, input)).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('PayrollAdjustmentsService.forMonth', () => {
  it('groups by employee in the shape the calculation engine takes', async () => {
    const { service, prisma } = makeService();
    (prisma.payrollAdjustment.findMany as Mock).mockResolvedValue([
      {
        employeeId: 'e1',
        amount: 5000,
        component: { code: 'BONUS', name: 'Bonus', kind: 'EARNING' },
      },
      {
        employeeId: 'e1',
        amount: 1200,
        component: { code: 'LOAN', name: 'Loan Deduction', kind: 'DEDUCTION' },
      },
      {
        employeeId: 'e2',
        amount: 300,
        component: { code: 'INCENTIVE', name: 'Incentives', kind: 'EARNING' },
      },
    ]);

    const byEmployee = await service.forMonth('org1', '2026-08');

    expect(byEmployee.get('e1')).toEqual([
      { code: 'BONUS', name: 'Bonus', kind: 'EARNING', amount: 5000 },
      { code: 'LOAN', name: 'Loan Deduction', kind: 'DEDUCTION', amount: 1200 },
    ]);
    expect(byEmployee.get('e2')).toHaveLength(1);
  });

  it('returns an empty map for a month with nothing entered', async () => {
    const { service } = makeService();
    await expect(service.forMonth('org1', '2026-08')).resolves.toEqual(new Map());
  });
});

describe('PayrollAdjustmentsService.remove', () => {
  it('refuses to remove one from a settled month', async () => {
    const { service, prisma } = makeService({ settledRun: { status: 'PUBLISHED' } });
    (prisma.payrollAdjustment.findFirst as Mock).mockResolvedValue({
      id: 'a1',
      month: '2026-08',
      amount: 5000,
      component: { code: 'BONUS' },
    });

    await expect(service.remove(ctx, 'a1')).rejects.toThrow(/published/i);
    expect(prisma.payrollAdjustment.delete).not.toHaveBeenCalled();
  });
});
