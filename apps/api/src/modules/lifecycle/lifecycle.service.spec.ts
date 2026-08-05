import { LifecycleService } from './lifecycle.service';
import { lifecycleDouble } from './lifecycle.test-double';

type Mock = jest.Mock;

/** `lifecycleDouble` fixes today at 2026-08-05. */
const TODAY = '2026-08-05';

function makeService(
  over: {
    due?: object[];
    dueOffboardings?: { id: string }[];
    lastRun?: { today: string } | null;
    policy?: Parameters<typeof lifecycleDouble>[0];
  } = {},
) {
  // biome-ignore lint/suspicious/noExplicitAny: structural test double
  const prisma: any = {
    employee: {
      findMany: jest.fn().mockResolvedValue(over.due ?? []),
      update: jest.fn(),
    },
    setting: {
      findUnique: jest.fn().mockResolvedValue(over.lastRun ? { value: over.lastRun } : null),
      upsert: jest.fn(),
    },
    auditLog: { create: jest.fn() },
  };
  const offboardings = {
    dueForCompletion: jest.fn().mockResolvedValue(over.dueOffboardings ?? []),
    complete: jest.fn().mockResolvedValue({ id: 'off1' }),
  };
  const logger = { setContext: jest.fn(), info: jest.fn(), warn: jest.fn() };
  const service = new LifecycleService(
    prisma,
    lifecycleDouble(over.policy),
    // biome-ignore lint/suspicious/noExplicitAny: structural test double
    offboardings as any,
    // biome-ignore lint/suspicious/noExplicitAny: structural test double
    logger as any,
  );
  return { service, prisma, offboardings, logger };
}

const overdue = {
  id: 'e1',
  joinDate: new Date('2026-05-01'),
  probationMonths: null,
  probationEndDate: new Date('2026-08-01'),
  probationExtendedTo: null,
  confirmedOn: null,
  noticePeriodDays: null,
};

describe('confirming probations', () => {
  /*
   * The important one. Somebody whose probation ended on the 1st and whose
   * confirmation is written on the 5th — because nobody opened the app over a
   * weekend — was permanent from the 1st. Dating it today would move the fact
   * to fit when the job happened to notice.
   */
  it('confirms as at the day probation ended, not as at today', async () => {
    const { service, prisma } = makeService({ due: [overdue] });
    await service.run('org1');
    expect(prisma.employee.update).toHaveBeenCalledWith({
      where: { id: 'e1' },
      data: { confirmedOn: new Date('2026-08-01T00:00:00.000Z') },
    });
  });

  it('uses the extension when there is one', async () => {
    const { service, prisma } = makeService({
      due: [{ ...overdue, probationExtendedTo: new Date('2026-08-03') }],
    });
    await service.run('org1');
    expect(prisma.employee.update).toHaveBeenCalledWith({
      where: { id: 'e1' },
      data: { confirmedOn: new Date('2026-08-03T00:00:00.000Z') },
    });
  });

  it('writes an audit row with no actor — nobody pressed anything', async () => {
    const { service, prisma } = makeService({ due: [overdue] });
    await service.run('org1');
    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          actorId: null,
          action: 'employee.confirm',
          entity: 'Employee',
        }),
      }),
    );
  });

  it('records the actor when a person triggered the run', async () => {
    const { service, prisma } = makeService({ due: [overdue] });
    await service.run('org1', 'u-admin');
    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ actorId: 'u-admin' }) }),
    );
  });

  it('does nothing when the organization turns auto-confirm off', async () => {
    const { service, prisma } = makeService({
      due: [overdue],
      policy: { autoConfirmOnProbationEnd: false },
    });
    const result = await service.run('org1');
    expect(prisma.employee.findMany).not.toHaveBeenCalled();
    expect(result.confirmed).toBe(0);
  });

  it('excludes people who have not started', async () => {
    const { service, prisma } = makeService({ due: [] });
    await service.run('org1');
    expect(prisma.employee.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          confirmedOn: null,
          status: { notIn: ['ONBOARDING'] },
        }),
      }),
    );
  });

  /* One bad row must not stop the rest — and must not vanish either. */
  it('reports a failure and carries on', async () => {
    const { service, prisma } = makeService({
      due: [overdue, { ...overdue, id: 'e2' }],
    });
    (prisma.employee.update as Mock).mockRejectedValueOnce(new Error('deadlock'));
    const result = await service.run('org1');
    expect(result.confirmed).toBe(1);
    expect(result.failures).toEqual([{ id: 'e1', reason: 'deadlock' }]);
  });
});

describe('completing overdue offboardings', () => {
  it('closes each one through the offboarding service', async () => {
    const { service, offboardings } = makeService({ dueOffboardings: [{ id: 'off1' }] });
    const result = await service.run('org1');
    expect(offboardings.complete).toHaveBeenCalledWith({ orgId: 'org1', userId: null }, 'off1', {});
    expect(result.exited).toBe(1);
  });

  /*
   * The refusal that matters: the only person who can administer the
   * organization has a notice period that just ran out. Locking everybody out
   * would be worse than leaving them signed in, so it is reported rather than
   * forced.
   */
  it('reports a refusal rather than forcing it', async () => {
    const { service, offboardings } = makeService({ dueOffboardings: [{ id: 'off1' }] });
    (offboardings.complete as Mock).mockRejectedValue(
      new Error('This is the only active administrator — give somebody else the Admin role first'),
    );
    const result = await service.run('org1');
    expect(result.exited).toBe(0);
    expect(result.failures[0]?.reason).toMatch(/only active administrator/);
  });

  it('does nothing when the organization turns auto-exit off', async () => {
    const { service, offboardings } = makeService({
      dueOffboardings: [{ id: 'off1' }],
      policy: { autoExitOnLastWorkingDate: false },
    });
    await service.run('org1');
    expect(offboardings.dueForCompletion).not.toHaveBeenCalled();
  });
});

describe('the once-a-day guard', () => {
  it('runs when it has not run today', async () => {
    const { service, prisma } = makeService({ lastRun: { today: '2026-08-04' } });
    await service.tickIfDue('org1');
    expect(prisma.setting.upsert).toHaveBeenCalled();
  });

  it('skips when it already has', async () => {
    const { service, prisma } = makeService({ lastRun: { today: TODAY } });
    await service.tickIfDue('org1');
    expect(prisma.setting.upsert).not.toHaveBeenCalled();
  });

  it('runs on a fresh organization that has never ticked', async () => {
    const { service, prisma } = makeService({ lastRun: null });
    await service.tickIfDue('org1');
    expect(prisma.setting.upsert).toHaveBeenCalled();
  });

  /*
   * Hung off /auth/me. Nothing displayed depends on the tick having run, so a
   * failure here must be a delay rather than the reason somebody cannot sign
   * in.
   */
  it('never throws, whatever fails inside', async () => {
    const { service, prisma, logger } = makeService({ lastRun: null });
    (prisma.setting.findUnique as Mock).mockRejectedValue(new Error('db down'));
    await expect(service.tickIfDue('org1')).resolves.toBeUndefined();
    expect(logger.warn).toHaveBeenCalled();
  });
});

describe('status', () => {
  it('says whether it is due, so an admin can tell', async () => {
    const { service } = makeService({ lastRun: { today: '2026-08-04' } });
    const status = await service.status('org1');
    expect(status).toMatchObject({ today: TODAY, lastRunDate: '2026-08-04', dueToday: true });
  });

  it('is not due once it has run today', async () => {
    const { service } = makeService({ lastRun: { today: TODAY } });
    expect((await service.status('org1')).dueToday).toBe(false);
  });
});
