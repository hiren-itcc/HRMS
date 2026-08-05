import type { AccessTokenClaims } from '@hrms/types';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { lifecycleDouble } from '../lifecycle/lifecycle.test-double';
import { notificationsDouble } from '../notifications/notifications.test-double';
import { settingsDouble } from '../settings/settings.test-double';
import { OffboardingsService } from './offboardings.service';

type Mock = jest.Mock;

/** `lifecycleDouble` fixes today at 2026-08-05. */
const employee = {
  id: 'e1',
  userId: 'u-emp',
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
  // The real update() includes LIST_INCLUDE, so the completion notification
  // has a name to put in its title.
  employee: { id: 'e1', firstName: 'Ada', lastName: 'Lovelace' },
  tasks: [],
};

function makeService(
  over: { employee?: object; offboarding?: object; openCount?: number } = {},
  settings: Parameters<typeof settingsDouble>[0] = {},
) {
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
    // The completion gate reads this on every complete(); an empty list is an
    // exit with nothing outstanding.
    offboardingTask: { findMany: jest.fn().mockResolvedValue([]), update: jest.fn() },
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
  const notifications = notificationsDouble();
  const service = new OffboardingsService(
    prisma,
    // biome-ignore lint/suspicious/noExplicitAny: structural test double
    transitions as any,
    lifecycleDouble(),
    notifications,
    settingsDouble(settings),
    // biome-ignore lint/suspicious/noExplicitAny: structural test double
    { forEntity: jest.fn().mockResolvedValue([]) } as any,
    // biome-ignore lint/suspicious/noExplicitAny: structural test double
    resignations as any,
  );
  return { service, prisma, transitions, resignations, notifications };
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

describe('who gets told', () => {
  /*
   * Including the exits nobody asked for. Somebody whose contract is ending
   * should not find out by noticing their access stopped.
   */
  it('tells the employee their exit is scheduled, however it began', async () => {
    const { service, notifications } = makeService();
    await service.create(hr, {
      employeeId: 'e1',
      reason: 'CONTRACT_END',
      reasonNote: null,
      lastWorkingDate: '2026-09-30',
    });
    expect(notifications.notify).toHaveBeenCalledWith(
      ['u-emp'],
      expect.objectContaining({
        type: 'offboarding.started',
        title: 'Your exit has been scheduled',
        body: expect.stringContaining('30 Sept 2026'),
      }),
    );
  });

  it('says nothing to an employee with no sign-in', async () => {
    const { service, notifications } = makeService({ employee: { userId: null } });
    await service.startFromResignation(ctx, {
      resignationId: 'r1',
      employeeId: 'e1',
      lastWorkingDate: '2026-09-30',
    });
    expect(notifications.notify).toHaveBeenCalledWith([], expect.anything());
  });

  /*
   * HR, not the employee: completion suspends the sign-in and revokes every
   * session, so a notification for them would land in an account nobody can
   * open. It also matters most when the daily tick closed the exit overnight
   * and no human was there to see it.
   */
  it('tells HR on completion, not the person who has left', async () => {
    const { service, notifications } = makeService();
    await service.complete(ctx, 'off1', {});
    expect(notifications.notifyPermission).toHaveBeenCalledWith(
      'org1',
      'employee.offboard',
      expect.objectContaining({
        type: 'offboarding.completed',
        title: 'Ada Lovelace has left',
      }),
      { except: 'u-hr' },
    );
    expect(notifications.notify).not.toHaveBeenCalled();
  });
});

describe('the checklist', () => {
  const tasksOf = (prisma: { offboarding: { create: Mock } }) =>
    (prisma.offboarding.create as Mock).mock.calls[0][0].data.tasks.create as {
      label: string;
      owner: string;
      required: boolean;
      order: number;
      description: string | null;
    }[];

  it('copies the organization’s template onto the exit, in order', async () => {
    const { service, prisma } = makeService();
    await service.startFromResignation(ctx, {
      resignationId: 'r1',
      employeeId: 'e1',
      lastWorkingDate: '2026-09-30',
    });

    const tasks = tasksOf(prisma);
    // The six shipped defaults, four of them required.
    expect(tasks).toHaveLength(6);
    expect(tasks.filter((t) => t.required)).toHaveLength(4);
    expect(tasks.map((t) => t.order)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(tasks[0]).toMatchObject({ owner: 'MANAGER', required: true });
    expect(tasks.find((t) => t.label.includes('assets'))).toMatchObject({
      owner: 'IT_ADMIN',
      required: true,
    });
  });

  /*
   * Copied, not joined. Editing the template next week must not rewrite an
   * exit that is half signed off — somebody who has already returned their
   * laptop has returned it whatever the list says afterwards.
   */
  it('takes the template as it was, not as it later becomes', async () => {
    const { service, prisma } = makeService(
      {},
      { exitChecklist: { items: [{ label: 'Only this', owner: 'HR', required: false }] } },
    );
    await service.startFromResignation(ctx, {
      resignationId: 'r1',
      employeeId: 'e1',
      lastWorkingDate: '2026-09-30',
    });

    const tasks = tasksOf(prisma);
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({ label: 'Only this', owner: 'HR', required: false, order: 0 });
  });

  it('starts an exit with no checklist at all when the template is empty', async () => {
    const { service, prisma } = makeService({}, { exitChecklist: { items: [] } });
    await service.create(hr, {
      employeeId: 'e1',
      reason: 'TERMINATION',
      reasonNote: null,
      lastWorkingDate: '2026-09-30',
    });
    expect(tasksOf(prisma)).toEqual([]);
  });
});

describe('clearance', () => {
  const manager: AccessTokenClaims = {
    sub: 'u-mgr',
    orgId: 'org1',
    roleCode: 'MANAGER',
    perms: ['offboarding.clearance'],
    employeeId: 'mgr1',
  };
  const finance: AccessTokenClaims = {
    sub: 'u-fin',
    orgId: 'org1',
    roleCode: 'FINANCE',
    perms: ['offboarding.clearance'],
    employeeId: 'e-fin',
  };

  function withTask(over: { owner?: string; status?: string; managerId?: string | null } = {}) {
    const made = makeService();
    made.prisma.offboardingTask = {
      findFirst: jest.fn().mockResolvedValue({
        id: 't1',
        offboardingId: 'off1',
        label: 'Return company assets',
        owner: over.owner ?? 'IT_ADMIN',
        status: 'PENDING',
        offboarding: {
          id: 'off1',
          status: over.status ?? 'IN_PROGRESS',
          employee: { managerId: over.managerId === undefined ? 'mgr1' : over.managerId },
        },
      }),
      update: jest.fn().mockResolvedValue({ id: 't1', status: 'DONE' }),
      findMany: jest.fn().mockResolvedValue([]),
    };
    return made;
  }

  it('signs an item off and stamps who and when', async () => {
    const { service, prisma } = withTask();
    await service.updateTask(hr, 't1', { status: 'DONE', note: 'Laptop and card returned' });
    expect(prisma.offboardingTask.update).toHaveBeenCalledWith({
      where: { id: 't1' },
      data: {
        status: 'DONE',
        note: 'Laptop and card returned',
        doneAt: expect.any(Date),
        doneById: 'u-hr',
      },
    });
  });

  /*
   * A laptop that turned out not to have come back has not come back. Leaving
   * the stamps behind would make a reopened item look signed off.
   */
  it('clears the stamps when an item is reopened', async () => {
    const { service, prisma } = withTask();
    await service.updateTask(hr, 't1', { status: 'PENDING', note: null });
    expect(prisma.offboardingTask.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ doneAt: null, doneById: null }) }),
    );
  });

  it('lets Finance sign off a Finance item', async () => {
    const { service, prisma } = withTask({ owner: 'FINANCE' });
    await service.updateTask(finance, 't1', { status: 'DONE', note: null });
    expect(prisma.offboardingTask.update).toHaveBeenCalled();
  });

  /*
   * `offboarding.clearance` says "you may clear an exit item"; it cannot say
   * whose. Without the service check every manager could sign off every
   * handover in the organization.
   */
  it('lets the right manager sign off a manager item', async () => {
    const { service, prisma } = withTask({ owner: 'MANAGER', managerId: 'mgr1' });
    await service.updateTask(manager, 't1', { status: 'DONE', note: null });
    expect(prisma.offboardingTask.update).toHaveBeenCalled();
  });

  it('refuses a manager who is not their manager', async () => {
    const { service } = withTask({ owner: 'MANAGER', managerId: 'somebody-else' });
    await expect(service.updateTask(manager, 't1', { status: 'DONE', note: null })).rejects.toThrow(
      /reporting manager/i,
    );
  });

  /* Which is also what covers IT_ADMIN items until an IT role exists. */
  it('lets an employee.offboard holder sign off anything', async () => {
    const { service, prisma } = withTask({ owner: 'MANAGER', managerId: 'somebody-else' });
    await service.updateTask(hr, 't1', { status: 'DONE', note: null });
    expect(prisma.offboardingTask.update).toHaveBeenCalled();
  });

  it('refuses somebody holding neither permission', async () => {
    const { service } = withTask();
    await expect(
      service.updateTask({ ...finance, perms: [] }, 't1', { status: 'DONE', note: null }),
    ).rejects.toThrow(/cannot sign off/i);
  });

  it('refuses once the offboarding is closed', async () => {
    const { service } = withTask({ status: 'COMPLETED' });
    await expect(service.updateTask(hr, 't1', { status: 'DONE', note: null })).rejects.toThrow(
      /already complete/i,
    );
  });
});

describe('the completion gate', () => {
  function withOutstanding(labels: string[]) {
    const made = makeService();
    made.prisma.offboardingTask = {
      findMany: jest.fn().mockResolvedValue(labels.map((label) => ({ label }))),
    };
    return made;
  }

  /*
   * This one rule is "employees cannot complete exit until required assets are
   * returned" — generic, so it covers the handover and the dues too, and so
   * Asset Management can make one item compute itself without the gate moving.
   */
  it('refuses while a required item is outstanding, and names it', async () => {
    const { service, transitions } = withOutstanding(['Return company assets']);
    await expect(service.complete(ctx, 'off1', {})).rejects.toThrow(
      'Still outstanding: Return company assets',
    );
    // And nothing happened: no exit, no suspended sign-in.
    expect(transitions.apply).not.toHaveBeenCalled();
  });

  it('names every one of them, because a count sends somebody hunting', async () => {
    const { service } = withOutstanding(['Handover', 'Return company assets']);
    await expect(service.complete(ctx, 'off1', {})).rejects.toThrow(
      'Still outstanding: Handover, Return company assets',
    );
  });

  it('only counts required items', async () => {
    const { service, prisma } = withOutstanding([]);
    await service.complete(ctx, 'off1', {});
    expect(prisma.offboardingTask.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { offboardingId: 'off1', required: true, status: 'PENDING' },
      }),
    );
  });

  it('completes once everything required is cleared or waived', async () => {
    const { service, transitions } = withOutstanding([]);
    await service.complete(ctx, 'off1', {});
    expect(transitions.apply).toHaveBeenCalledWith(
      ctx,
      'e1',
      expect.objectContaining({ status: 'EXITED' }),
    );
  });
});

describe('the exit interview', () => {
  function withInterview(existing: object | null = null) {
    const made = makeService();
    made.prisma.exitInterview = {
      findUnique: jest.fn().mockResolvedValue(existing),
      findFirst: jest.fn().mockResolvedValue(existing),
      upsert: jest.fn().mockResolvedValue({ id: 'int1' }),
    };
    return made;
  }

  const answers = {
    conductedOn: '2026-09-29',
    responses: [
      { key: 'reason', question: 'What is the main reason you decided to leave?', answer: 'Pay' },
    ],
    notes: null,
    wouldRecommend: true,
    rehireEligible: true,
  };

  /*
   * Written *during* the conversation, so it upserts: half of it saved is
   * better than a form somebody abandons because it had to be finished in one
   * sitting.
   */
  it('saves whatever has been said so far, and can be amended', async () => {
    const { service, prisma } = withInterview();
    await service.saveInterview(hr, 'off1', answers);
    expect(prisma.exitInterview.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { offboardingId: 'off1' },
        create: expect.objectContaining({ offboardingId: 'off1', wouldRecommend: true }),
      }),
    );
  });

  /*
   * The answers are the most sensitive text in the record and the audit log is
   * a wider read than the interview itself, so the trail says one was recorded
   * without repeating what was said.
   */
  it('audits that it happened without copying the answers into the log', async () => {
    const { service, prisma } = withInterview();
    await service.saveInterview(hr, 'off1', answers);
    const meta = (prisma.auditLog.create as Mock).mock.calls.at(-1)[0].data.meta;
    expect(meta.after).toEqual({ recorded: true, amended: false, answered: 1 });
    expect(JSON.stringify(meta)).not.toContain('Pay');
  });

  it('records an amendment as an amendment', async () => {
    const { service, prisma } = withInterview({ id: 'int1' });
    await service.saveInterview(hr, 'off1', answers);
    const meta = (prisma.auditLog.create as Mock).mock.calls.at(-1)[0].data.meta;
    expect(meta.after.amended).toBe(true);
  });

  /*
   * The interview often happens on the last day and is written up afterwards.
   * Refusing then would mean the record is whatever was typed in a hurry.
   */
  it('can still be written after the offboarding has completed', async () => {
    const { service, prisma } = withInterview();
    (prisma.offboarding.findFirst as Mock).mockResolvedValue({ id: 'off1', status: 'COMPLETED' });
    await expect(service.saveInterview(hr, 'off1', answers)).resolves.toBeDefined();
  });

  it('404s for an offboarding in another organization', async () => {
    const { service, prisma } = withInterview();
    (prisma.offboarding.findFirst as Mock).mockResolvedValue(null);
    await expect(service.saveInterview(hr, 'off1', answers)).rejects.toThrow(/not found/i);
  });
});
