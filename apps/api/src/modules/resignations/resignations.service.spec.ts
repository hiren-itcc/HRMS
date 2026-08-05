import type { AccessTokenClaims } from '@hrms/types';
import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { lifecycleDouble } from '../lifecycle/lifecycle.test-double';
import { ResignationsService } from './resignations.service';

type Mock = jest.Mock;

/** `lifecycleDouble` fixes today at 2026-08-05 and the notice default at 30. */
const EARLIEST = '2026-09-04';

const employee = {
  id: 'e1',
  status: 'ACTIVE' as string,
  joinDate: new Date('2024-01-01'),
  managerId: 'mgr1',
  noticePeriodDays: null as number | null,
};

const resignation = {
  id: 'r1',
  organizationId: 'org1',
  employeeId: 'e1',
  status: 'SUBMITTED' as string,
  reason: 'PERSONAL',
  remarks: null,
  requestedLastWorkingDate: new Date('2026-09-30'),
  approvedLastWorkingDate: null as Date | null,
  earliestLastWorkingDate: new Date(EARLIEST),
  noticeDays: 30,
  routedManagerId: 'mgr1',
  employee: { ...employee, firstName: 'Ada', lastName: 'Lovelace', managerId: 'mgr1' },
};

function makeService(over: { employee?: object; resignation?: object; openCount?: number } = {}) {
  // Annotated because `$transaction` hands the double back to itself, and the
  // inferred type would be circular.
  // biome-ignore lint/suspicious/noExplicitAny: structural test double
  const prisma: any = {
    employee: {
      findFirst: jest.fn().mockResolvedValue({ ...employee, ...over.employee }),
    },
    resignation: {
      findFirst: jest.fn().mockResolvedValue({ ...resignation, ...over.resignation }),
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(over.openCount ?? 0),
      create: jest.fn().mockResolvedValue({ ...resignation, ...over.resignation }),
      update: jest.fn().mockResolvedValue({ ...resignation, ...over.resignation }),
    },
    auditLog: { create: jest.fn(), findMany: jest.fn().mockResolvedValue([]) },
    user: { findMany: jest.fn().mockResolvedValue([]) },
    $transaction: jest.fn((arg: unknown) =>
      typeof arg === 'function'
        ? (arg as (tx: unknown) => Promise<unknown>)(prisma)
        : Promise.all(arg as Promise<unknown>[]),
    ),
  };
  const offboardings = { startFromResignation: jest.fn().mockResolvedValue({ id: 'off1' }) };
  const service = new ResignationsService(
    prisma,
    lifecycleDouble(),
    // biome-ignore lint/suspicious/noExplicitAny: structural test double
    { forEntity: jest.fn().mockResolvedValue([]) } as any,
    // biome-ignore lint/suspicious/noExplicitAny: structural test double
    offboardings as any,
  );
  return { service, prisma, offboardings };
}

const claims = (over: Partial<AccessTokenClaims>): AccessTokenClaims => ({
  sub: 'u1',
  orgId: 'org1',
  roleCode: 'EMPLOYEE',
  perms: ['resignation.request.own', 'resignation.read.own'],
  employeeId: 'e1',
  ...over,
});

const self = claims({});
const manager = claims({
  sub: 'u-mgr',
  employeeId: 'mgr1',
  roleCode: 'MANAGER',
  perms: ['resignation.approve.team', 'resignation.read.team'],
});
const hr = claims({
  sub: 'u-hr',
  employeeId: 'e-hr',
  roleCode: 'HR',
  perms: ['resignation.approve', 'resignation.read'],
});

describe('submitting', () => {
  it('freezes the notice in force and the date it implies', async () => {
    const { service, prisma } = makeService();
    await service.submit(self, {
      lastWorkingDate: '2026-10-01',
      reason: 'PERSONAL',
      remarks: null,
    });

    expect(prisma.resignation.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          noticeDays: 30,
          earliestLastWorkingDate: new Date(`${EARLIEST}T00:00:00.000Z`),
        }),
      }),
    );
  });

  /*
   * A reorganisation mid-notice must not move a decision that already happened
   * — or hand the request to somebody who knows nothing about it.
   */
  it('captures who reviews it at submit time', async () => {
    const { service, prisma } = makeService();
    await service.submit(self, {
      lastWorkingDate: '2026-10-01',
      reason: 'PERSONAL',
      remarks: null,
    });
    expect(prisma.resignation.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ routedManagerId: 'mgr1' }) }),
    );
  });

  it('routes past the manager when the organization turns that step off', async () => {
    const prisma = makeService();
    const service = new ResignationsService(
      prisma.prisma,
      lifecycleDouble({ requireManagerApproval: false }),
      // biome-ignore lint/suspicious/noExplicitAny: structural test double
      { forEntity: jest.fn() } as any,
      // biome-ignore lint/suspicious/noExplicitAny: structural test double
      { startFromResignation: jest.fn() } as any,
    );
    await service.submit(self, {
      lastWorkingDate: '2026-10-01',
      reason: 'PERSONAL',
      remarks: null,
    });
    expect(prisma.prisma.resignation.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ routedManagerId: null }) }),
    );
  });

  it('refuses a second open request', async () => {
    const { service } = makeService({ openCount: 1 });
    await expect(
      service.submit(self, { lastWorkingDate: '2026-10-01', reason: 'PERSONAL', remarks: null }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('turns the unique-index race into the same sentence', async () => {
    const { service, prisma } = makeService();
    (prisma.resignation.create as Mock).mockRejectedValue({ code: 'P2002' });
    await expect(
      service.submit(self, { lastWorkingDate: '2026-10-01', reason: 'PERSONAL', remarks: null }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('refuses a last working date in the past', async () => {
    const { service } = makeService();
    await expect(
      service.submit(self, { lastWorkingDate: '2026-08-04', reason: 'PERSONAL', remarks: null }),
    ).rejects.toThrow(/cannot be in the past/i);
  });

  it('refuses somebody who has not started', async () => {
    const { service } = makeService({ employee: { status: 'ONBOARDING' } });
    await expect(
      service.submit(self, { lastWorkingDate: '2026-10-01', reason: 'PERSONAL', remarks: null }),
    ).rejects.toThrow(/before you have started/i);
  });

  /*
   * Short notice is accepted and flagged. Refusing it would push the
   * negotiation that always follows onto email, where nothing records it.
   */
  it('accepts short notice and marks it', async () => {
    const { service, prisma } = makeService({
      resignation: { requestedLastWorkingDate: new Date('2026-08-20') },
    });
    const result = await service.submit(self, {
      lastWorkingDate: '2026-08-20',
      reason: 'PERSONAL',
      remarks: null,
    });
    expect(result.isShortNotice).toBe(true);
    expect(prisma.resignation.create).toHaveBeenCalled();
  });

  it('honours a per-employee notice override', async () => {
    const { service, prisma } = makeService({ employee: { noticePeriodDays: 90 } });
    await service.submit(self, {
      lastWorkingDate: '2026-12-01',
      reason: 'PERSONAL',
      remarks: null,
    });
    expect(prisma.resignation.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          noticeDays: 90,
          earliestLastWorkingDate: new Date('2026-11-03T00:00:00.000Z'),
        }),
      }),
    );
  });
});

describe('the employee changing their own request', () => {
  it('resubmits a sent-back request rather than leaving it silent', async () => {
    const { service, prisma } = makeService({ resignation: { status: 'CHANGES_REQUESTED' } });
    await service.update(self, 'r1', {
      lastWorkingDate: '2026-10-05',
      reason: 'RELOCATION',
      remarks: null,
    });
    expect(prisma.resignation.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'SUBMITTED' }) }),
    );
  });

  it('refuses once a reviewer has it', async () => {
    const { service } = makeService({ resignation: { status: 'MANAGER_APPROVED' } });
    await expect(
      service.update(self, 'r1', {
        lastWorkingDate: '2026-10-05',
        reason: 'PERSONAL',
        remarks: null,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('withdrawing', () => {
  it('works while it is still under review', async () => {
    const { service, prisma } = makeService();
    await service.withdraw(self, 'r1', { remarks: 'Changed my mind' });
    expect(prisma.resignation.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'WITHDRAWN' }) }),
    );
  });

  it('refuses once approved, and says what to do instead', async () => {
    const { service } = makeService({ resignation: { status: 'APPROVED' } });
    await expect(service.withdraw(self, 'r1', { remarks: null })).rejects.toThrow(
      /cancel the offboarding/i,
    );
  });
});

describe('deciding', () => {
  it('lets the routed manager approve, and moves it to HR', async () => {
    const { service, prisma } = makeService();
    await service.decide(manager, 'r1', { action: 'approve', remarks: 'Sorry to see you go' });
    expect(prisma.resignation.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'MANAGER_APPROVED',
          managerDecidedById: 'u-mgr',
          managerRemarks: 'Sorry to see you go',
        }),
      }),
    );
  });

  /* `resignation.approve.team` says "for your team"; the guard cannot tell
     whose team, so the service must. */
  it('refuses a manager who is not the one it was routed to', async () => {
    const other = claims({
      sub: 'u-x',
      employeeId: 'mgr9',
      perms: ['resignation.approve.team', 'resignation.read.team'],
    });
    const { service } = makeService();
    await expect(
      service.decide(other, 'r1', { action: 'approve', remarks: null }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('refuses a manager trying to give final sign-off', async () => {
    const { service } = makeService({ resignation: { status: 'MANAGER_APPROVED' } });
    await expect(
      service.decide(manager, 'r1', { action: 'approve', remarks: null }),
    ).rejects.toThrow(/only hr/i);
  });

  it('refuses anyone deciding on their own resignation', async () => {
    const hrResigning = claims({
      sub: 'u1',
      employeeId: 'e1',
      perms: ['resignation.approve', 'resignation.read'],
    });
    const { service } = makeService();
    await expect(
      service.decide(hrResigning, 'r1', { action: 'approve', remarks: null }),
    ).rejects.toThrow(/your own resignation/i);
  });

  it('lets HR approve straight from submitted and opens the offboarding', async () => {
    const { service, offboardings } = makeService();
    await service.decide(hr, 'r1', { action: 'approve', remarks: null });
    expect(offboardings.startFromResignation).toHaveBeenCalledWith(
      expect.objectContaining({ orgId: 'org1' }),
      expect.objectContaining({
        resignationId: 'r1',
        employeeId: 'e1',
        lastWorkingDate: '2026-09-30',
      }),
    );
  });

  it('lets HR override the last working date, and uses the override downstream', async () => {
    const { service, prisma, offboardings } = makeService({
      resignation: { status: 'MANAGER_APPROVED' },
    });
    await service.decide(hr, 'r1', {
      action: 'approve',
      remarks: null,
      lastWorkingDate: '2026-10-15',
    });
    expect(prisma.resignation.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          approvedLastWorkingDate: new Date('2026-10-15T00:00:00.000Z'),
        }),
      }),
    );
    expect(offboardings.startFromResignation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ lastWorkingDate: '2026-10-15' }),
    );
  });

  it('refuses an override in the past', async () => {
    const { service } = makeService({ resignation: { status: 'MANAGER_APPROVED' } });
    await expect(
      service.decide(hr, 'r1', { action: 'approve', remarks: null, lastWorkingDate: '2026-07-01' }),
    ).rejects.toThrow(/cannot be in the past/i);
  });

  it('refuses a second approval', async () => {
    const { service } = makeService({ resignation: { status: 'APPROVED' } });
    await expect(service.decide(hr, 'r1', { action: 'approve', remarks: null })).rejects.toThrow(
      /already/i,
    );
  });

  it('does not open an offboarding when rejecting', async () => {
    const { service, offboardings } = makeService({ resignation: { status: 'MANAGER_APPROVED' } });
    await service.decide(hr, 'r1', { action: 'reject', remarks: 'Counter-offer accepted' });
    expect(offboardings.startFromResignation).not.toHaveBeenCalled();
  });
});

describe('scoping', () => {
  it('narrows a manager to their own reports', async () => {
    const { service, prisma } = makeService();
    await service.list(manager, { page: 1, limit: 20, order: 'asc' });
    expect(prisma.resignation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ employee: { managerId: 'mgr1' } }),
      }),
    );
  });

  /* The sentinel: a manager-less caller must match nothing, not everything. */
  it('matches nothing for a manager with no employee record', async () => {
    const { service, prisma } = makeService();
    await service.list(claims({ ...manager, employeeId: undefined }), {
      page: 1,
      limit: 20,
      order: 'asc',
    });
    expect(prisma.resignation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ employee: { managerId: '__none__' } }),
      }),
    );
  });

  it('leaves HR unfiltered', async () => {
    const { service, prisma } = makeService();
    await service.list(hr, { page: 1, limit: 20, order: 'asc' });
    const call = (prisma.resignation.findMany as Mock).mock.calls[0][0];
    expect(call.where.employee).toBeUndefined();
    expect(call.where.employeeId).toBeUndefined();
  });

  /*
   * Somebody with no manager is routed to nobody. Without this branch their
   * request would sit at SUBMITTED and appear on no desk in the product.
   */
  it('puts an unrouted request on HR’s awaiting list', async () => {
    const { service, prisma } = makeService();
    await service.list(hr, { page: 1, limit: 20, order: 'asc', awaitingMe: true });
    const call = (prisma.resignation.findMany as Mock).mock.calls[0][0];
    expect(call.where.OR).toEqual([
      { status: 'MANAGER_APPROVED' },
      { status: 'SUBMITTED', routedManagerId: null },
    ]);
  });
});
