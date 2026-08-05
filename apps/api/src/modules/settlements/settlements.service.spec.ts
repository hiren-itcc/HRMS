import { defaultSettings } from '@hrms/shared';
import type { AccessTokenClaims } from '@hrms/types';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { notificationsDouble } from '../notifications/notifications.test-double';
import { settingsDouble } from '../settings/settings.test-double';
import { SettlementsService } from './settlements.service';

/**
 * A ₹52,000 basic on the default 26-day basis is a clean ₹2,000 a day, which
 * keeps every expected figure in this file readable arithmetic rather than a
 * number somebody has to trust.
 */
const STRUCTURE_LINES = [
  {
    component: { code: 'BASIC', name: 'Basic Salary', kind: 'EARNING' },
    calcType: 'FLAT',
    value: 52_000,
    order: 0,
  },
  {
    component: { code: 'HRA', name: 'HRA', kind: 'EARNING' },
    calcType: 'FLAT',
    value: 20_000,
    order: 1,
  },
];

const offboarding = {
  id: 'off1',
  organizationId: 'org1',
  employeeId: 'e1',
  status: 'IN_PROGRESS' as string,
  lastWorkingDate: new Date('2026-09-30'),
  resignation: {
    earliestLastWorkingDate: new Date('2026-10-18'),
    approvedLastWorkingDate: new Date('2026-09-30'),
  } as object | null,
  employee: { id: 'e1', joinDate: new Date('2019-01-01') },
};

const settlement = {
  id: 's1',
  organizationId: 'org1',
  offboardingId: 'off1',
  employeeId: 'e1',
  status: 'DRAFT' as string,
  netPayable: 0,
  employee: { id: 'e1', firstName: 'Ada', lastName: 'Lovelace' },
  lines: [],
};

interface Over {
  offboarding?: object;
  settlement?: object;
  existing?: object | null;
  balances?: object[];
  salary?: object | null;
  lines?: object[];
  line?: object | null;
}

function makeService(over: Over = {}, settings: Parameters<typeof settingsDouble>[0] = {}) {
  // biome-ignore lint/suspicious/noExplicitAny: structural test double
  const prisma: any = {
    offboarding: {
      findFirst: jest.fn().mockResolvedValue({ ...offboarding, ...over.offboarding }),
    },
    settlement: {
      // create() checks for a duplicate by offboardingId; every other path
      // looks the settlement up by its own id. Keyed on the query rather than
      // call order, which would otherwise hand the duplicate check's answer to
      // whichever method happened to ask first.
      findFirst: jest.fn((args: { where?: { offboardingId?: string } }) =>
        Promise.resolve(
          args?.where?.offboardingId !== undefined
            ? (over.existing ?? null)
            : { ...settlement, ...over.settlement },
        ),
      ),
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
      create: jest.fn().mockResolvedValue({ ...settlement, ...over.settlement }),
      update: jest.fn().mockResolvedValue({ ...settlement, ...over.settlement }),
    },
    settlementLine: {
      findFirst: jest.fn().mockResolvedValue(over.line === undefined ? null : over.line),
      findMany: jest.fn().mockResolvedValue(over.lines ?? []),
      create: jest.fn(),
      createMany: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      deleteMany: jest.fn(),
    },
    leaveBalance: { findMany: jest.fn().mockResolvedValue(over.balances ?? []) },
    employeeSalary: {
      findFirst: jest
        .fn()
        .mockResolvedValue(
          over.salary === undefined
            ? { monthlyCtc: 72_000, structure: { lines: STRUCTURE_LINES } }
            : over.salary,
        ),
    },
    auditLog: { create: jest.fn() },
    $transaction: jest.fn((arg: unknown) =>
      typeof arg === 'function'
        ? (arg as (tx: unknown) => Promise<unknown>)(prisma)
        : Promise.all(arg as Promise<unknown>[]),
    ),
  };
  const notifications = notificationsDouble();
  const service = new SettlementsService(
    prisma,
    settingsDouble(settings),
    notifications,
    // biome-ignore lint/suspicious/noExplicitAny: structural test double
    { forEntity: jest.fn().mockResolvedValue([]) } as any,
  );
  return { service, prisma, notifications };
}

const hr: AccessTokenClaims = {
  sub: 'u-hr',
  orgId: 'org1',
  roleCode: 'HR',
  perms: ['payroll.process'],
  employeeId: 'e-hr',
};

const finance: AccessTokenClaims = {
  ...hr,
  sub: 'u-fin',
  roleCode: 'FINANCE',
  perms: ['payroll.approve'],
};

/** The lines a create() call handed to Prisma. */
// biome-ignore lint/suspicious/noExplicitAny: structural test double
const createdLines = (prisma: any) =>
  // biome-ignore lint/suspicious/noExplicitAny: structural test double
  prisma.settlement.create.mock.calls[0][0].data.lines.create as any[];

const balance = (over: object = {}) => ({
  leaveTypeId: 'lt1',
  allocated: 18,
  carriedOver: 0,
  used: 5.5,
  leaveType: { id: 'lt1', code: 'EL', name: 'Earned leave', encashable: true },
  ...over,
});

describe('computing', () => {
  it('prices encashment at the day rate off basic', async () => {
    const { service, prisma } = makeService({ balances: [balance()] });
    await service.create(hr, { offboardingId: 'off1' });

    // 12.5 days left × ₹2,000
    expect(createdLines(prisma)).toContainEqual(
      expect.objectContaining({ source: 'LEAVE_ENCASHMENT', amount: 25_000 }),
    );
  });

  /* A number nobody can check is a number nobody accepts. */
  it('prints the working under every figure', async () => {
    const { service, prisma } = makeService({ balances: [balance()] });
    await service.create(hr, { offboardingId: 'off1' });

    const encashment = createdLines(prisma).find((l) => l.source === 'LEAVE_ENCASHMENT');
    expect(encashment.basis).toBe('12.5 days × ₹2,000');
  });

  it('recovers the notice they did not serve', async () => {
    const { service, prisma } = makeService();
    await service.create(hr, { offboardingId: 'off1' });

    // 30 Sep against an earliest of 18 Oct is 18 days short × ₹2,000
    expect(createdLines(prisma)).toContainEqual(
      expect.objectContaining({ source: 'NOTICE_RECOVERY', kind: 'DEDUCTION', amount: 36_000 }),
    );
  });

  /*
   * The asymmetry that matters. A company ending somebody's employment owes
   * them notice; it does not collect it. An offboarding with no resignation
   * behind it is a termination, a contract ending or a retirement.
   */
  it('recovers nothing when the company ended the employment', async () => {
    const { service, prisma } = makeService({ offboarding: { resignation: null } });
    await service.create(hr, { offboardingId: 'off1' });

    expect(createdLines(prisma).map((l) => l.source)).not.toContain('NOTICE_RECOVERY');
  });

  it('recovers nothing when the organization has switched recovery off', async () => {
    const { service, prisma } = makeService(
      {},
      { settlement: { ...defaultSettings().settlement, recoverShortNotice: false } },
    );
    await service.create(hr, { offboardingId: 'off1' });

    expect(createdLines(prisma).map((l) => l.source)).not.toContain('NOTICE_RECOVERY');
  });

  it('pays gratuity past the qualifying period', async () => {
    const { service, prisma } = makeService();
    await service.create(hr, { offboardingId: 'off1' });

    // 1 Jan 2019 → 30 Sep 2026 is 7y9m, which rounds to 8: 15/26 × 52,000 × 8
    expect(createdLines(prisma)).toContainEqual(
      expect.objectContaining({ source: 'GRATUITY', amount: 240_000 }),
    );
  });

  it('leaves gratuity off entirely below the qualifying period', async () => {
    const { service, prisma } = makeService({
      offboarding: { employee: { id: 'e1', joinDate: new Date('2024-01-01') } },
    });
    await service.create(hr, { offboardingId: 'off1' });

    expect(createdLines(prisma).map((l) => l.source)).not.toContain('GRATUITY');
  });

  it('nets deductions against earnings on the record itself', async () => {
    const { service, prisma } = makeService({ balances: [balance()] });
    await service.create(hr, { offboardingId: 'off1' });

    // 25,000 encashment + 240,000 gratuity − 36,000 recovery
    expect(prisma.settlement.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          totalEarnings: 265_000,
          totalDeductions: 36_000,
          netPayable: 229_000,
        }),
      }),
    );
  });

  /*
   * Frozen the way Payslip and Offboarding freeze. A salary revision afterwards
   * must not silently rewrite a settlement somebody has already been shown.
   */
  it('freezes the pay and the day rate onto the record', async () => {
    const { service, prisma } = makeService();
    await service.create(hr, { offboardingId: 'off1' });

    expect(prisma.settlement.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ monthlyPay: 52_000, perDayRate: 2_000 }),
      }),
    );
  });

  it('prices off gross when the organization says so', async () => {
    const { service, prisma } = makeService(
      {},
      { settlement: { ...defaultSettings().settlement, rateBasis: 'GROSS' } },
    );
    await service.create(hr, { offboardingId: 'off1' });

    // 52,000 basic + 20,000 HRA
    expect(prisma.settlement.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ monthlyPay: 72_000 }) }),
    );
  });

  /*
   * A settlement of zero is obviously wrong on screen and gets the salary
   * fixed. A crash at the moment HR presses Prepare tells them nothing.
   */
  it('produces an empty settlement rather than failing when there is no salary', async () => {
    const { service, prisma } = makeService({ salary: null });
    await service.create(hr, { offboardingId: 'off1' });

    expect(prisma.settlement.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ monthlyPay: 0, netPayable: 0 }) }),
    );
  });

  it('skips leave types nobody marked encashable', async () => {
    // The query filters on `encashable: true`, so the balance never arrives.
    const { service, prisma } = makeService({ balances: [] });
    await service.create(hr, { offboardingId: 'off1' });

    expect(prisma.leaveBalance.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ leaveType: { encashable: true } }),
      }),
    );
    expect(createdLines(prisma).map((l) => l.source)).not.toContain('LEAVE_ENCASHMENT');
  });

  it('refuses a second settlement for the same exit', async () => {
    const { service } = makeService({ existing: { id: 's1' } });
    await expect(service.create(hr, { offboardingId: 'off1' })).rejects.toThrow(ConflictException);
  });

  it('refuses to settle an exit that was called off', async () => {
    const { service } = makeService({ offboarding: { status: 'CANCELLED' } });
    await expect(service.create(hr, { offboardingId: 'off1' })).rejects.toThrow(
      BadRequestException,
    );
  });
});

describe('recompute', () => {
  /*
   * The one thing a recompute must not do. A retention bonus somebody
   * negotiated is not something the calculator can derive a second time.
   */
  it('keeps lines somebody entered by hand', async () => {
    const manual = { id: 'l9', source: 'MANUAL', kind: 'EARNING', amount: 5_000, order: 3 };
    const { service, prisma } = makeService({ settlement: { status: 'DRAFT' }, lines: [manual] });
    await service.recompute(hr, 's1');

    expect(prisma.settlementLine.deleteMany).toHaveBeenCalledWith({
      where: { settlementId: 's1', source: { not: 'MANUAL' } },
    });
  });

  it('refuses once anybody has approved the figures', async () => {
    const { service } = makeService({ settlement: { status: 'APPROVED' } });
    await expect(service.recompute(hr, 's1')).rejects.toThrow(BadRequestException);
  });
});

describe('lines', () => {
  const computed = {
    id: 'l1',
    source: 'GRATUITY',
    kind: 'EARNING',
    label: 'Gratuity',
    amount: 240_000,
  };

  it('marks a changed figure as overridden', async () => {
    const { service, prisma } = makeService({ line: computed });
    await service.updateLine(hr, 's1', 'l1', { amount: 250_000 });

    expect(prisma.settlementLine.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ overridden: true }) }),
    );
  });

  /* A manual line was always somebody's own figure — it had no computed
     amount to have been changed from. */
  it('does not mark a hand-entered line as overridden', async () => {
    const { service, prisma } = makeService({
      line: { ...computed, source: 'MANUAL', label: 'Retention bonus' },
    });
    await service.updateLine(hr, 's1', 'l1', { amount: 10_000 });

    expect(prisma.settlementLine.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ overridden: false }) }),
    );
  });

  /* A computed source added by hand would be destroyed by the next
     recompute, which is a trap rather than a feature. */
  it('files every added line as MANUAL', async () => {
    const { service, prisma } = makeService();
    await service.addLine(hr, 's1', {
      kind: 'DEDUCTION',
      label: 'Laptop not returned',
      amount: 40_000,
    });

    expect(prisma.settlementLine.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ source: 'MANUAL' }) }),
    );
  });

  it('re-totals the settlement after a line moves', async () => {
    const { service, prisma } = makeService({
      line: computed,
      lines: [
        { kind: 'EARNING', amount: 250_000 },
        { kind: 'DEDUCTION', amount: 36_000 },
      ],
    });
    await service.updateLine(hr, 's1', 'l1', { amount: 250_000 });

    expect(prisma.settlement.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { totalEarnings: 250_000, totalDeductions: 36_000, netPayable: 214_000 },
      }),
    );
  });

  it('refuses to touch the figures once they are approved', async () => {
    const { service } = makeService({ settlement: { status: 'APPROVED' }, line: computed });
    await expect(service.updateLine(hr, 's1', 'l1', { amount: 1 })).rejects.toThrow(
      BadRequestException,
    );
  });
});

describe('workflow', () => {
  it('tells whoever can release the money that it is ready', async () => {
    const { service, notifications } = makeService({
      settlement: { status: 'DRAFT', netPayable: 229_000 },
    });
    await service.approve(finance, 's1', {});

    expect(notifications.notifyPermission).toHaveBeenCalledWith(
      'org1',
      'payroll.pay',
      expect.objectContaining({ type: 'settlement.approved' }),
      { except: 'u-fin' },
    );
  });

  /*
   * Not the leaver. Their sign-in is suspended the moment the exit completes,
   * so a notification for them lands in an account nobody can open — the
   * statement is handed over instead.
   */
  it('never notifies the person who left', async () => {
    const { service, notifications } = makeService({ settlement: { status: 'DRAFT' } });
    await service.approve(finance, 's1', {});

    expect(notifications.notify).not.toHaveBeenCalled();
  });

  it('refuses to pay a settlement nobody approved', async () => {
    const { service } = makeService({ settlement: { status: 'DRAFT' } });
    await expect(service.pay(finance, 's1', { paymentRef: 'NEFT-1' })).rejects.toThrow(
      /Approve the settlement before paying it/,
    );
  });

  it('records the payment against its reference', async () => {
    const { service, prisma } = makeService({ settlement: { status: 'APPROVED' } });
    await service.pay(finance, 's1', { paymentRef: 'NEFT-99', paidOn: '2026-10-05' });

    expect(prisma.settlement.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'PAID', paymentRef: 'NEFT-99' }),
      }),
    );
  });

  /* Money that has left the account cannot be un-sent by an edit. */
  it('will not reopen a settlement that has been paid', async () => {
    const { service } = makeService({ settlement: { status: 'PAID' } });
    await expect(service.cancel(finance, 's1', { reason: 'Mistake' })).rejects.toThrow(
      /already been paid/,
    );
  });

  it('cancels a draft rather than deleting it', async () => {
    const { service, prisma } = makeService({ settlement: { status: 'DRAFT' } });
    await service.cancel(finance, 's1', { reason: 'They are staying' });

    expect(prisma.settlement.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'CANCELLED', cancelReason: 'They are staying' }),
      }),
    );
  });
});
