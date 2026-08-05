import type { AccessTokenClaims } from '@hrms/types';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { lifecycleDouble } from '../lifecycle/lifecycle.test-double';
import { OffboardingsService } from './offboardings.service';

type Mock = jest.Mock;

/** `lifecycleDouble` fixes today at 2026-08-05. */
const employee = {
  id: 'e1',
  joinDate: new Date('2024-01-01'),
  status: 'ACTIVE' as string,
  department: { name: 'Engineering' },
  designation: { title: 'Senior Executive' },
  manager: { firstName: 'Grace', lastName: 'Hopper' },
};

const offboarding = {
  id: 'off1',
  organizationId: 'org1',
  employeeId: 'e1',
  resignationId: 'r1' as string | null,
  status: 'IN_PROGRESS' as string,
  reason: 'RESIGNATION',
  reasonNote: null as string | null,
  lastWorkingDate: new Date('2026-09-30'),
};

function makeService(over: { employee?: object; offboarding?: object; openCount?: number } = {}) {
  // biome-ignore lint/suspicious/noExplicitAny: structural test double
  const prisma: any = {
    employee: { findFirst: jest.fn().mockResolvedValue({ ...employee, ...over.employee }) },
    offboarding: {
      findFirst: jest.fn().mockResolvedValue({ ...offboarding, ...over.offboarding }),
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(over.openCount ?? 0),
      create: jest.fn().mockResolvedValue({ ...offboarding, ...over.offboarding }),
      update: jest.fn().mockResolvedValue({ ...offboarding, ...over.offboarding }),
    },
    resignation: { update: jest.fn() },
    auditLog: { create: jest.fn() },
    $transaction: jest.fn((arg: unknown) =>
      typeof arg === 'function'
        ? (arg as (tx: unknown) => Promise<unknown>)(prisma)
        : Promise.all(arg as Promise<unknown>[]),
    ),
  };
  const transitions = { apply: jest.fn().mockResolvedValue({ id: 'e1' }) };
  const resignations = { markCompleted: jest.fn(), reopen: jest.fn() };
  const service = new OffboardingsService(
    prisma,
    // biome-ignore lint/suspicious/noExplicitAny: structural test double
    transitions as any,
    lifecycleDouble(),
    // biome-ignore lint/suspicious/noExplicitAny: structural test double
    resignations as any,
  );
  return { service, prisma, transitions, resignations };
}

const hr: AccessTokenClaims = {
  sub: 'u-hr',
  orgId: 'org1',
  roleCode: 'HR',
  perms: ['employee.offboard'],
  employeeId: 'e-hr',
};

const ctx = { orgId: 'org1', userId: 'u-hr' };

describe('starting', () => {
  /*
   * The snapshot is the point of this table. Six months later the department
   * may have been merged away and the manager may have left themselves; an
   * exit record that reads "—" for both is no use to whoever is answering a
   * reference request.
   */
  it('freezes the department, designation and manager at the time of leaving', async () => {
    const { service, prisma } = makeService();
    await service.startFromResignation(ctx, {
      resignationId: 'r1',
      employeeId: 'e1',
      lastWorkingDate: '2026-09-30',
    });
    expect(prisma.offboarding.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          snapshotDepartment: 'Engineering',
          snapshotDesignation: 'Senior Executive',
          snapshotManagerName: 'Grace Hopper',
          snapshotJoinDate: employee.joinDate,
        }),
      }),
    );
  });

  /*
   * Serving notice is not leaving. The login stays live, because somebody
   * working their notice still clocks in, books leave and gets paid.
   */
  it('puts them on notice without touching the sign-in', async () => {
    const { service, transitions } = makeService();
    await service.startFromResignation(ctx, {
      resignationId: 'r1',
      employeeId: 'e1',
      lastWorkingDate: '2026-09-30',
    });
    expect(transitions.apply).toHaveBeenCalledWith(
      ctx,
      'e1',
      expect.objectContaining({ status: 'ON_NOTICE', exitDate: '2026-09-30' }),
    );
  });

  it('refuses a second open offboarding', async () => {
    const { service } = makeService({ openCount: 1 });
    await expect(
      service.create(hr, {
        employeeId: 'e1',
        reason: 'TERMINATION',
        reasonNote: null,
        lastWorkingDate: '2026-09-30',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('turns the unique-index race into the same sentence', async () => {
    const { service, prisma } = makeService();
    (prisma.offboarding.create as Mock).mockRejectedValue({ code: 'P2002' });
    await expect(
      service.create(hr, {
        employeeId: 'e1',
        reason: 'TERMINATION',
        reasonNote: null,
        lastWorkingDate: '2026-09-30',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('refuses somebody who has already left', async () => {
    const { service } = makeService({ employee: { status: 'EXITED' } });
    await expect(
      service.create(hr, {
        employeeId: 'e1',
        reason: 'TERMINATION',
        reasonNote: null,
        lastWorkingDate: '2026-09-30',
      }),
    ).rejects.toThrow(/already left/i);
  });

  it('refuses somebody who has not started', async () => {
    const { service } = makeService({ employee: { status: 'ONBOARDING' } });
    await expect(
      service.create(hr, {
        employeeId: 'e1',
        reason: 'TERMINATION',
        reasonNote: null,
        lastWorkingDate: '2026-09-30',
      }),
    ).rejects.toThrow(/not started yet/i);
  });

  it('refuses a last working date in the past', async () => {
    const { service } = makeService();
    await expect(
      service.create(hr, {
        employeeId: 'e1',
        reason: 'TERMINATION',
        reasonNote: null,
        lastWorkingDate: '2026-08-01',
      }),
    ).rejects.toThrow(/cannot be in the past/i);
  });
});

describe('rescheduling', () => {
  /*
   * exitDate is what attendance, payroll and every report actually read.
   * Moving the offboarding date without moving it would mean the exit screen
   * said one thing and the final payslip used another.
   */
  it('moves the employee exit date with it', async () => {
    const { service, transitions } = makeService();
    await service.update(hr, 'off1', { lastWorkingDate: '2026-10-31', reasonNote: null });
    expect(transitions.apply).toHaveBeenCalledWith(
      ctx,
      'e1',
      expect.objectContaining({ status: 'ON_NOTICE', exitDate: '2026-10-31' }),
    );
  });

  it('keeps the resignation’s approved date in step', async () => {
    const { service, prisma } = makeService();
    await service.update(hr, 'off1', { lastWorkingDate: '2026-10-31', reasonNote: null });
    expect(prisma.resignation.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'r1' },
        data: { approvedLastWorkingDate: new Date('2026-10-31T00:00:00.000Z') },
      }),
    );
  });

  it('leaves an HR-initiated exit alone — there is no resignation to update', async () => {
    const { service, prisma } = makeService({ offboarding: { resignationId: null } });
    await service.update(hr, 'off1', { lastWorkingDate: '2026-10-31', reasonNote: null });
    expect(prisma.resignation.update).not.toHaveBeenCalled();
  });

  it('refuses once complete', async () => {
    const { service } = makeService({ offboarding: { status: 'COMPLETED' } });
    await expect(
      service.update(hr, 'off1', { lastWorkingDate: '2026-10-31', reasonNote: null }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('completing', () => {
  it('exits the employee through the shared transition', async () => {
    const { service, transitions } = makeService();
    await service.complete(ctx, 'off1', {});
    expect(transitions.apply).toHaveBeenCalledWith(
      ctx,
      'e1',
      expect.objectContaining({ status: 'EXITED', exitDate: '2026-09-30' }),
    );
  });

  /* The exit that happens is not always the one that was planned, and the
     date is what payroll reads. */
  it('accepts a different actual last day and stores it', async () => {
    const { service, prisma, transitions } = makeService();
    await service.complete(ctx, 'off1', { lastWorkingDate: '2026-09-25', note: 'Left early' });
    expect(transitions.apply).toHaveBeenCalledWith(
      ctx,
      'e1',
      expect.objectContaining({ exitDate: '2026-09-25' }),
    );
    expect(prisma.offboarding.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'COMPLETED',
          lastWorkingDate: new Date('2026-09-25T00:00:00.000Z'),
        }),
      }),
    );
  });

  it('closes the resignation behind it', async () => {
    const { service, resignations } = makeService();
    await service.complete(ctx, 'off1', {});
    expect(resignations.markCompleted).toHaveBeenCalledWith(ctx, 'r1');
  });

  it('runs with no actor, for the daily tick', async () => {
    const { service, transitions } = makeService();
    await service.complete({ orgId: 'org1', userId: null }, 'off1', {});
    expect(transitions.apply).toHaveBeenCalledWith(
      { orgId: 'org1', userId: null },
      'e1',
      expect.objectContaining({ status: 'EXITED' }),
    );
  });

  it('refuses a second completion', async () => {
    const { service } = makeService({ offboarding: { status: 'COMPLETED' } });
    await expect(service.complete(ctx, 'off1', {})).rejects.toThrow(/already complete/i);
  });
});

describe('cancelling', () => {
  it('puts them back to active and clears the exit date', async () => {
    const { service, transitions } = makeService();
    await service.cancel(hr, 'off1', { reason: 'Counter-offer accepted' });
    expect(transitions.apply).toHaveBeenCalledWith(
      ctx,
      'e1',
      expect.objectContaining({ status: 'ACTIVE', exitDate: null }),
    );
  });

  it('puts the resignation back on HR’s desk', async () => {
    const { service, resignations } = makeService();
    await service.cancel(hr, 'off1', { reason: 'Counter-offer accepted' });
    expect(resignations.reopen).toHaveBeenCalledWith(ctx, 'r1');
  });

  it('refuses once the exit has already happened', async () => {
    const { service } = makeService({ offboarding: { status: 'COMPLETED' } });
    await expect(service.cancel(hr, 'off1', { reason: 'x' })).rejects.toThrow(/already complete/i);
  });
});
