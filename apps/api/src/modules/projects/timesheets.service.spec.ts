import type { AccessTokenClaims } from '@hrms/types';
import { TimesheetsService } from './timesheets.service';

type Mock = jest.Mock;

/**
 * The week workflow: opening one, saving it, sending it, and the manager's
 * answer.
 *
 * The rules themselves are `projects.rules.spec.ts`. What is here is the
 * wiring — including the two things a rules file cannot express: that opening a
 * week writes nothing, and that saving is deliberately more permissive than
 * submitting.
 */

// 2026-08-10 is a Monday.
const MONDAY = '2026-08-10';
const WEDNESDAY = '2026-08-12';
const NEXT_MONDAY = '2026-08-17';

const ASHA = { id: 'e-asha', firstName: 'Asha', lastName: 'Verma', employeeCode: 'EMP-0005' };

const SHEET = {
  id: 't1',
  organizationId: 'org1',
  employeeId: 'e-asha',
  weekStart: new Date('2026-08-10T00:00:00Z'),
  status: 'SUBMITTED',
  submittedAt: new Date('2026-08-17T09:00:00Z'),
  decidedById: null,
  decidedAt: null,
  decisionNote: null,
  createdAt: new Date('2026-08-10T09:00:00Z'),
  employee: ASHA,
  entries: [
    {
      id: 'te1',
      projectId: 'p1',
      workedOn: new Date('2026-08-10T00:00:00Z'),
      hours: 8,
      note: null,
      project: { id: 'p1', code: 'APOLLO', name: 'Apollo', status: 'ACTIVE' },
    },
    {
      id: 'te2',
      projectId: 'p1',
      workedOn: new Date('2026-08-12T00:00:00Z'),
      hours: 7.5,
      note: null,
      project: { id: 'p1', code: 'APOLLO', name: 'Apollo', status: 'ACTIVE' },
    },
  ],
};

const OPEN_PROJECT = {
  id: 'p1',
  code: 'APOLLO',
  status: 'ACTIVE',
  startsOn: new Date('2026-01-01T00:00:00Z'),
  endsOn: null,
};

/** Carries `project` because `week()` includes it; `submit()` ignores the extra. */
const MEMBERSHIP = {
  projectId: 'p1',
  joinedOn: new Date('2026-01-01T00:00:00Z'),
  leftOn: null,
  project: { ...OPEN_PROJECT, name: 'Apollo' },
};

function makeService(sheet: unknown = SHEET) {
  // biome-ignore lint/suspicious/noExplicitAny: structural test double
  const prisma: any = {
    timesheet: {
      findFirst: jest.fn().mockResolvedValue(sheet),
      findUnique: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
      upsert: jest.fn().mockResolvedValue(SHEET),
      update: jest
        .fn()
        .mockImplementation(({ data }: { data: Record<string, unknown> }) =>
          Promise.resolve({ ...(sheet as object), ...data, entries: SHEET.entries }),
        ),
    },
    project: {
      findMany: jest.fn().mockResolvedValue([OPEN_PROJECT]),
      count: jest.fn().mockResolvedValue(1),
    },
    projectMember: { findMany: jest.fn().mockResolvedValue([MEMBERSHIP]) },
    employee: {
      findFirst: jest.fn().mockResolvedValue({ id: 'e-asha' }),
      findUnique: jest.fn().mockResolvedValue({
        userId: 'u-asha',
        manager: { userId: 'u-maya' },
      }),
    },
    auditLog: { create: jest.fn().mockResolvedValue({}) },
    $transaction: jest.fn((ops: unknown[]) => Promise.all(ops as Promise<unknown>[])),
  };
  const notifications = { notify: jest.fn(), notifyPermission: jest.fn() };
  // biome-ignore lint/suspicious/noExplicitAny: structural test double
  const service = new TimesheetsService(prisma, notifications as any);
  return { service, prisma, notifications };
}

/** Whose week it is. */
const asha: AccessTokenClaims = {
  sub: 'u-asha',
  orgId: 'org1',
  roleCode: 'EMPLOYEE',
  perms: ['timesheet.read.own', 'timesheet.submit.own'],
  employeeId: 'e-asha',
};

/** Asha's manager. */
const maya: AccessTokenClaims = {
  sub: 'u-maya',
  orgId: 'org1',
  roleCode: 'MANAGER',
  perms: ['timesheet.read.own', 'timesheet.read.team', 'timesheet.approve.team'],
  employeeId: 'e-maya',
};

/** A manager of somebody else. */
const otherManager: AccessTokenClaims = { ...maya, sub: 'u-vik', employeeId: 'e-vik' };

describe('opening a week', () => {
  /*
   * A GET that writes would leave an empty DRAFT for everybody who ever opened
   * the screen. saveWeek has to handle the not-yet-existing case anyway, so the
   * row appears the first time somebody actually types an hour.
   */
  it('creates nothing, and answers with a null sheet', async () => {
    const { service, prisma } = makeService();
    const result = await service.week(asha, MONDAY);

    expect(result.timesheet).toBeNull();
    expect(result.days).toHaveLength(7);
    expect(prisma.timesheet.upsert).not.toHaveBeenCalled();
  });

  it('refuses a day that is not a Monday, and names the Monday', async () => {
    const { service } = makeService();
    await expect(service.week(asha, WEDNESDAY)).rejects.toThrow(`try ${MONDAY}`);
  });

  it('offers only open projects the person is actually on', async () => {
    const { service, prisma } = makeService();
    prisma.projectMember.findMany.mockResolvedValue([
      { ...MEMBERSHIP, project: { ...OPEN_PROJECT, name: 'Apollo' } },
    ]);

    const result = await service.week(asha, MONDAY);

    expect(result.projects).toEqual([
      expect.objectContaining({ id: 'p1', code: 'APOLLO', joinedOn: '2026-01-01' }),
    ]);
    const where = (prisma.projectMember.findMany as Mock).mock.calls[0][0].where;
    expect(where.project.status).toEqual({ in: ['ACTIVE', 'ON_HOLD'] });
  });
});

describe('saving a week', () => {
  const draft = { id: 't1', status: 'DRAFT' };

  it('replaces every entry rather than patching them', async () => {
    const { service, prisma } = makeService();
    prisma.timesheet.findUnique.mockResolvedValue(draft);

    await service.saveWeek(asha, {
      weekStart: MONDAY,
      entries: [{ projectId: 'p1', workedOn: MONDAY, hours: 8, note: null }],
    });

    const args = (prisma.timesheet.upsert as Mock).mock.calls[0][0];
    expect(args.update.entries.deleteMany).toEqual({});
    expect(args.update.entries.create).toHaveLength(1);
  });

  /*
   * The unique on (employeeId, weekStart) is the concurrency story, and an
   * upsert is what turns it from a P2002 into a correct outcome.
   */
  it('upserts on the week key rather than reading and then creating', async () => {
    const { service, prisma } = makeService();
    await service.saveWeek(asha, { weekStart: MONDAY, entries: [] });

    const args = (prisma.timesheet.upsert as Mock).mock.calls[0][0];
    expect(args.where.employeeId_weekStart).toEqual({
      employeeId: 'e-asha',
      weekStart: new Date('2026-08-10T00:00:00Z'),
    });
  });

  /* Editing a sent-back week is the point of sending it back. */
  it('returns a sent-back week to draft when it is edited again', async () => {
    const { service, prisma } = makeService();
    prisma.timesheet.findUnique.mockResolvedValue({ id: 't1', status: 'REJECTED' });

    await service.saveWeek(asha, {
      weekStart: MONDAY,
      entries: [{ projectId: 'p1', workedOn: MONDAY, hours: 8, note: null }],
    });

    expect((prisma.timesheet.upsert as Mock).mock.calls[0][0].update.status).toBe('DRAFT');
  });

  it('refuses to edit an approved week', async () => {
    const { service, prisma } = makeService();
    prisma.timesheet.findUnique.mockResolvedValue({ id: 't1', status: 'APPROVED' });

    await expect(service.saveWeek(asha, { weekStart: MONDAY, entries: [] })).rejects.toThrow(
      'send it back',
    );
  });

  it('refuses a day outside the week', async () => {
    const { service } = makeService();
    await expect(
      service.saveWeek(asha, {
        weekStart: MONDAY,
        entries: [{ projectId: 'p1', workedOn: NEXT_MONDAY, hours: 8, note: null }],
      }),
    ).rejects.toThrow('is not in the week beginning');
  });

  /*
   * (timesheetId, projectId, workedOn) is unique, so without this pre-flight
   * the grid's own duplicate arrives as a P2002 and a 500.
   */
  it('refuses the same project twice on one day, rather than letting the constraint 500', async () => {
    const { service } = makeService();
    await expect(
      service.saveWeek(asha, {
        weekStart: MONDAY,
        entries: [
          { projectId: 'p1', workedOn: MONDAY, hours: 4, note: null },
          { projectId: 'p1', workedOn: MONDAY, hours: 4, note: null },
        ],
      }),
    ).rejects.toThrow('two entries on the same day');
  });

  /*
   * Saving is deliberately more permissive than submitting: a draft is a
   * scratchpad, and being blocked mid-thought is how people stop filling one
   * in. A closed project is submit's problem, not save's.
   */
  it('accepts a draft against a project that is no longer open', async () => {
    const { service, prisma } = makeService();
    prisma.project.count.mockResolvedValue(1);

    await expect(
      service.saveWeek(asha, {
        weekStart: MONDAY,
        entries: [{ projectId: 'p1', workedOn: MONDAY, hours: 8, note: null }],
      }),
    ).resolves.toBeDefined();
  });

  it('refuses a project from another organization', async () => {
    const { service, prisma } = makeService();
    prisma.project.count.mockResolvedValue(0);

    await expect(
      service.saveWeek(asha, {
        weekStart: MONDAY,
        entries: [{ projectId: 'p-elsewhere', workedOn: MONDAY, hours: 8, note: null }],
      }),
    ).rejects.toThrow('no longer exists');
  });
});

describe('submitting a week', () => {
  const draftSheet = { ...SHEET, status: 'DRAFT' };

  it('sends a clean week and tells the manager', async () => {
    const { service, prisma, notifications } = makeService(draftSheet);

    await service.submit(asha, 't1');

    expect((prisma.timesheet.update as Mock).mock.calls[0][0].data.status).toBe('SUBMITTED');
    expect(notifications.notify).toHaveBeenCalledWith(
      ['u-maya'],
      expect.objectContaining({ type: 'timesheet.submitted' }),
    );
  });

  /* Every problem at once — see the rules spec for why. */
  it('reports every problem in one refusal', async () => {
    const { service, prisma } = makeService(draftSheet);
    prisma.project.findMany.mockResolvedValue([
      { ...OPEN_PROJECT, status: 'COMPLETED', endsOn: new Date('2026-08-11T00:00:00Z') },
    ]);
    prisma.projectMember.findMany.mockResolvedValue([]);

    await expect(service.submit(asha, 't1')).rejects.toThrow('completed');
    expect(prisma.timesheet.update).not.toHaveBeenCalled();
  });

  it('refuses to submit somebody else’s week', async () => {
    const { service } = makeService(draftSheet);
    await expect(service.submit(maya, 't1')).rejects.toThrow('Only the person who filled');
  });

  it('refuses to submit a week that is already with the manager', async () => {
    const { service } = makeService();
    await expect(service.submit(asha, 't1')).rejects.toThrow('withdraw it first');
  });

  it('withdraws back to draft rather than deleting', async () => {
    const { service, prisma } = makeService();
    await service.withdraw(asha, 't1');
    expect((prisma.timesheet.update as Mock).mock.calls[0][0].data).toMatchObject({
      status: 'DRAFT',
      submittedAt: null,
    });
  });
});

describe('deciding a week', () => {
  it('approves a report’s week and tells them', async () => {
    const { service, prisma, notifications } = makeService();

    await service.decide(maya, 't1', 'APPROVED', {});

    expect((prisma.timesheet.update as Mock).mock.calls[0][0].data.status).toBe('APPROVED');
    expect(notifications.notify).toHaveBeenCalledWith(
      ['u-asha'],
      expect.objectContaining({ type: 'timesheet.approved' }),
    );
  });

  /*
   * Sending a week back without saying why only produces the same week again,
   * and the person filling it has no way to guess which line was wrong.
   */
  it('will not send a week back without a reason', async () => {
    const { service, prisma } = makeService();
    await expect(service.decide(maya, 't1', 'REJECTED', {})).rejects.toThrow('Say what needs');
    await expect(service.decide(maya, 't1', 'REJECTED', { note: '   ' })).rejects.toThrow(
      'Say what needs',
    );
    expect(prisma.timesheet.update).not.toHaveBeenCalled();
  });

  it('sends it back when there is a reason', async () => {
    const { service, prisma } = makeService();
    await service.decide(maya, 't1', 'REJECTED', { note: 'Friday looks like Apollo, not Zeus' });
    expect((prisma.timesheet.update as Mock).mock.calls[0][0].data.status).toBe('REJECTED');
  });

  it('refuses to let anybody decide their own week', async () => {
    const { service } = makeService();
    const ashaApproving = { ...asha, perms: [...asha.perms, 'timesheet.approve.team' as const] };
    await expect(service.decide(ashaApproving, 't1', 'APPROVED', {})).rejects.toThrow(
      'your own week',
    );
  });

  /*
   * approve.team gets you to the handler; the guard cannot know whose week the
   * id belongs to. This is where that is actually checked.
   */
  it('refuses a manager who does not manage this person', async () => {
    const { service, prisma } = makeService();
    prisma.employee.findFirst.mockResolvedValue(null);

    await expect(service.decide(otherManager, 't1', 'APPROVED', {})).rejects.toThrow();
  });

  it('refuses to decide a week that was never submitted', async () => {
    const { service } = makeService({ ...SHEET, status: 'DRAFT' });
    await expect(service.decide(maya, 't1', 'APPROVED', {})).rejects.toThrow('not been submitted');
  });
});

describe('who may read a week', () => {
  it('404s a week belonging to somebody outside the manager’s line', async () => {
    const { service, prisma } = makeService();
    prisma.employee.findFirst.mockResolvedValue(null);

    await expect(service.get(otherManager, 't1')).rejects.toThrow('Timesheet not found');
  });

  it('lets an org-wide reader through without a management check', async () => {
    const { service, prisma } = makeService();
    const hr: AccessTokenClaims = {
      sub: 'u-hr',
      orgId: 'org1',
      roleCode: 'HR',
      perms: ['timesheet.read'],
      employeeId: 'e-hr',
    };

    await expect(service.get(hr, 't1')).resolves.toMatchObject({ id: 't1' });
    expect(prisma.employee.findFirst).not.toHaveBeenCalled();
  });

  it('derives the total from the entries rather than trusting a stored one', async () => {
    const { service } = makeService();
    await expect(service.get(asha, 't1')).resolves.toMatchObject({ total: 15.5, entryCount: 2 });
  });
});
