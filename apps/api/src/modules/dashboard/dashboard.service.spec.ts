import type { AccessTokenClaims } from '@hrms/types';
import { DashboardService } from './dashboard.service';

/** The lifecycle policy double fixes today at 2026-08-05, a Wednesday. */
const TODAY = '2026-08-05';

interface Over {
  /** Rows the celebrations scan returns. */
  people?: object[];
  count?: number;
  /** Rows the leave balance read returns. */
  balances?: object[];
}

function makeService(over: Over = {}) {
  const count = jest.fn().mockResolvedValue(over.count ?? 3);
  // biome-ignore lint/suspicious/noExplicitAny: structural test double
  const prisma: any = {
    employee: {
      count,
      findMany: jest.fn().mockResolvedValue(over.people ?? []),
    },
    resignation: { count: jest.fn().mockResolvedValue(2) },
    offboarding: { count: jest.fn().mockResolvedValue(1) },
    leaveRequest: { count: jest.fn().mockResolvedValue(4) },
    attendanceRequest: { count: jest.fn().mockResolvedValue(5) },
    remoteWorkRequest: { count: jest.fn().mockResolvedValue(6) },
    payrollRun: { count: jest.fn().mockResolvedValue(7) },
    settlement: { count: jest.fn().mockResolvedValue(8) },
    leaveBalance: { findMany: jest.fn().mockResolvedValue(over.balances ?? []) },
  };
  const policy = { contextFor: async () => ({ todayKey: TODAY }) };
  // biome-ignore lint/suspicious/noExplicitAny: structural test double
  const service = new DashboardService(prisma, policy as any);
  return { service, prisma };
}

const claims = (perms: string[], employeeId: string | undefined = 'mgr1'): AccessTokenClaims => ({
  sub: 'u1',
  orgId: 'org1',
  roleCode: 'MANAGER',
  perms,
  employeeId,
});

const person = (over: object = {}) => ({
  id: 'e1',
  firstName: 'Ada',
  lastName: 'Lovelace',
  avatarUrl: null,
  dateOfBirth: null,
  joinDate: new Date('2020-01-01T00:00:00.000Z'),
  ...over,
});

describe('what the caller may not see', () => {
  /*
   * Nulls rather than zeroes throughout. A zero reads as a fact — "nothing is
   * waiting on you" — when what is true is "you may not know".
   */
  it('returns null, not zero, for every figure out of reach', async () => {
    const { service } = makeService();
    const summary = await service.summary(claims([]));

    expect(summary.headcount).toBeNull();
    expect(summary.onProbation).toBeNull();
    expect(summary.exits).toBeNull();
    expect(summary.approvals).toBeNull();
    expect(summary.payroll).toBeNull();
    expect(summary.upcomingLastWorkingDates).toEqual([]);
  });

  it('counts only people who actually work here', async () => {
    const { service, prisma } = makeService();
    await service.summary(claims(['employee.read']));

    const where = prisma.employee.count.mock.calls[0][0].where;
    expect(where.status).toEqual({ notIn: ['ONBOARDING', 'EXITED'] });
    expect(where.deletedAt).toBeNull();
  });

  it('narrows a manager to their own reports', async () => {
    const { service, prisma } = makeService();
    await service.summary(claims(['employee.read.team']));

    expect(prisma.employee.count).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ managerId: 'mgr1' }) }),
    );
  });

  /* The sentinel: a manager with no employee record matches nothing. */
  it('matches nothing for a manager with no employee record', async () => {
    const { service, prisma } = makeService();
    // Spread rather than `claims(..., undefined)` — a default parameter is
    // applied for an explicit `undefined`, so that would have kept 'mgr1'.
    await service.summary({ ...claims(['employee.read.team']), employeeId: undefined });

    expect(prisma.employee.count).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ managerId: '__none__' }) }),
    );
  });

  it('leaves somebody with the org-wide code unnarrowed', async () => {
    const { service, prisma } = makeService();
    await service.summary(claims(['employee.read']));

    expect(prisma.employee.count.mock.calls[0][0].where.managerId).toBeUndefined();
  });
});

describe('waiting on you', () => {
  it('adds up the three things a person approves', async () => {
    const { service } = makeService();
    const summary = await service.summary(
      claims(['leave.approve', 'attendance.approve', 'wfh.approve']),
    );

    // 4 leave + 5 attendance + 6 remote
    expect(summary.approvals).toEqual({ total: 15, leave: 4, attendance: 5, remoteWork: 6 });
  });

  /* Somebody who approves only leave should not be told about the rest. */
  it('counts only what that person actually approves', async () => {
    const { service } = makeService();
    const summary = await service.summary(claims(['leave.approve.team']));

    expect(summary.approvals).toEqual({ total: 4, leave: 4, attendance: 0, remoteWork: 0 });
  });

  it('scopes a team approver to their own reports', async () => {
    const { service, prisma } = makeService();
    await service.summary(claims(['leave.approve.team']));

    expect(prisma.leaveRequest.count).toHaveBeenCalledWith({
      where: { status: 'PENDING', employee: { managerId: 'mgr1' } },
    });
  });

  it('is null for somebody who approves nothing', async () => {
    const { service } = makeService();
    expect((await service.summary(claims(['employee.read']))).approvals).toBeNull();
  });
});

describe('money that is stuck', () => {
  it('counts runs to approve and settlements on both sides', async () => {
    const { service } = makeService();
    const summary = await service.summary(claims(['payroll.approve', 'payroll.pay']));

    // 7 runs + 8 to approve + 8 to pay
    expect(summary.payroll).toEqual({
      total: 23,
      runsNeedingAction: 7,
      settlementsToApprove: 8,
      settlementsToPay: 8,
    });
  });

  it('tells somebody who can only pay about nothing they cannot act on', async () => {
    const { service } = makeService();
    const summary = await service.summary(claims(['payroll.pay']));

    expect(summary.payroll).toEqual({
      total: 8,
      runsNeedingAction: 0,
      settlementsToApprove: 0,
      settlementsToPay: 8,
    });
  });
});

describe('exits, as one story', () => {
  /*
   * Not a sum. Somebody serving notice almost always has an offboarding open
   * too, so adding the three would count most people twice.
   */
  it('leads with who is leaving, not with the three counts added up', async () => {
    const { service } = makeService();
    const summary = await service.summary(
      claims(['employee.read', 'resignation.read', 'employee.offboard']),
    );

    expect(summary.exits?.leaving).toBe(3);
    expect(summary.exits?.pendingResignations).toBe(2);
    expect(summary.exits?.offboardingInProgress).toBe(1);
  });
});

describe('your own figures', () => {
  const balance = (name: string, allocated: number, used: number, carriedOver = 0) => ({
    allocated,
    used,
    carriedOver,
    leaveType: { name },
  });

  const ownPerms = ['leave.read.own', 'attendance.read.own', 'wfh.read.own'];

  it('adds up what is left to book, most available first', async () => {
    const { service } = makeService({
      balances: [balance('Sick', 6, 4), balance('Annual', 12, 2, 3)],
    });
    const summary = await service.summary(claims(['leave.read.own']));

    // Annual: 12 + 3 − 2 = 13. Sick: 6 − 4 = 2.
    expect(summary.me?.leave).toEqual({
      available: 15,
      byType: [
        { name: 'Annual', available: 13 },
        { name: 'Sick', available: 2 },
      ],
    });
  });

  /*
   * A type with nothing left is the answer to "can I take sick leave", and
   * dropping it would leave the headline unexplained by the list under it.
   */
  it('keeps a type with nothing left in the breakdown', async () => {
    const { service } = makeService({ balances: [balance('Sick', 6, 6)] });
    const summary = await service.summary(claims(['leave.read.own']));

    expect(summary.me?.leave?.byType).toEqual([{ name: 'Sick', available: 0 }]);
  });

  it('reads this year, not last', async () => {
    const { service, prisma } = makeService();
    await service.summary(claims(['leave.read.own']));

    expect(prisma.leaveBalance.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { employeeId: 'mgr1', year: 2026 } }),
    );
  });

  it('counts what they are waiting on somebody else to decide', async () => {
    const { service } = makeService();
    const summary = await service.summary(claims(ownPerms));

    // 4 leave + 5 attendance + 6 remote, all raised by them.
    expect(summary.me?.requests).toEqual({ total: 15, leave: 4, attendance: 5, remoteWork: 6 });
  });

  it('counts only the kinds they could open', async () => {
    const { service } = makeService();
    const summary = await service.summary(claims(['leave.read.own']));

    expect(summary.me?.requests).toEqual({ total: 4, leave: 4, attendance: 0, remoteWork: 0 });
  });

  /* Their own, never the org's — this is the mirror of the approvals tile. */
  it('scopes every count to the person asking', async () => {
    const { service, prisma } = makeService();
    await service.summary(claims(ownPerms));

    expect(prisma.leaveRequest.count).toHaveBeenCalledWith({
      where: { employeeId: 'mgr1', status: 'PENDING' },
    });
  });

  /*
   * The bootstrap admin. A row of zeroes would read as "you have used all your
   * leave" rather than as "you do not have any".
   */
  it('is null for an account with no employee record', async () => {
    const { service, prisma } = makeService();
    const summary = await service.summary({ ...claims(ownPerms), employeeId: undefined });

    expect(summary.me).toBeNull();
    expect(prisma.leaveBalance.findMany).not.toHaveBeenCalled();
  });

  it('asks for no balance without the code to read one', async () => {
    const { service, prisma } = makeService();
    const summary = await service.summary(claims(['attendance.read.own']));

    expect(summary.me?.leave).toBeNull();
    expect(prisma.leaveBalance.findMany).not.toHaveBeenCalled();
  });
});

describe('celebrations', () => {
  const withPeople = (people: object[]) =>
    makeService({ people }).service.summary(claims(['directory.read']));

  /*
   * The promise this feature makes. The stored value carries a year, and the
   * response must not — age cannot be inferred from a payload that never
   * contains it, even by somebody reading the network tab.
   */
  it('never serialises the year of a birth date', async () => {
    const summary = await withPeople([
      person({ dateOfBirth: new Date('1991-08-12T00:00:00.000Z') }),
    ]);

    expect(summary.celebrations.birthdays[0]?.monthDay).toBe('08-12');
    expect(JSON.stringify(summary.celebrations.birthdays)).not.toContain('1991');
  });

  it('picks up a birthday inside the window and ignores one outside it', async () => {
    const summary = await withPeople([
      person({ id: 'soon', dateOfBirth: new Date('1991-08-12T00:00:00.000Z') }),
      person({ id: 'far', dateOfBirth: new Date('1991-11-30T00:00:00.000Z') }),
    ]);

    expect(summary.celebrations.birthdays.map((b) => b.id)).toEqual(['soon']);
  });

  /*
   * The wrap. Read in December, a January birthday is days away — comparing
   * month-day strings would put it eleven months out and drop it.
   */
  it('sees next year birthday when the window crosses new year', async () => {
    const { service } = makeService({
      people: [person({ dateOfBirth: new Date('1991-01-02T00:00:00.000Z') })],
    });
    // biome-ignore lint/suspicious/noExplicitAny: reaching past the policy double
    (service as any).policy = { contextFor: async () => ({ todayKey: '2026-12-28' }) };

    const summary = await service.summary(claims(['directory.read']));
    expect(summary.celebrations.birthdays[0]?.inDays).toBe(5);
  });

  it('counts the years on an anniversary, because that is the point of one', async () => {
    const summary = await withPeople([person({ joinDate: new Date('2021-08-20T00:00:00.000Z') })]);

    expect(summary.celebrations.anniversaries[0]).toMatchObject({ monthDay: '08-20', years: 5 });
  });

  /*
   * The same new-year wrap that `inDays` is careful about, and which the years
   * count originally was not. Read on 28 December, somebody who joined on
   * 5 January 2020 is eight days from their **sixth** anniversary — taking the
   * year off today rather than off the occurrence announced it as their fifth.
   */
  it('counts the years to the anniversary, not to today, across new year', async () => {
    const { service } = makeService({
      people: [person({ joinDate: new Date('2020-01-05T00:00:00.000Z') })],
    });
    // biome-ignore lint/suspicious/noExplicitAny: reaching past the policy double
    (service as any).policy = { contextFor: async () => ({ todayKey: '2025-12-28' }) };

    const summary = await service.summary(claims(['directory.read']));
    expect(summary.celebrations.anniversaries[0]).toMatchObject({ inDays: 8, years: 6 });
  });

  /* Somebody who joined this year is not celebrating a nought-year anniversary. */
  it('leaves out a first year that has not come round', async () => {
    const summary = await withPeople([person({ joinDate: new Date('2026-08-20T00:00:00.000Z') })]);

    expect(summary.celebrations.anniversaries).toEqual([]);
  });

  it('orders both lists by how soon they fall', async () => {
    const summary = await withPeople([
      person({ id: 'later', dateOfBirth: new Date('1990-08-20T00:00:00.000Z') }),
      person({ id: 'sooner', dateOfBirth: new Date('1990-08-07T00:00:00.000Z') }),
    ]);

    expect(summary.celebrations.birthdays.map((b) => b.id)).toEqual(['sooner', 'later']);
  });

  it('asks nothing of somebody who cannot see colleagues at all', async () => {
    const { service, prisma } = makeService();
    const summary = await service.summary(claims([]));

    expect(summary.celebrations).toEqual({ birthdays: [], anniversaries: [] });
    expect(prisma.employee.findMany).not.toHaveBeenCalled();
  });

  it('scans only people who work here', async () => {
    const { service, prisma } = makeService();
    await service.summary(claims(['directory.read']));

    const where = prisma.employee.findMany.mock.calls[0][0].where;
    expect(where.status).toEqual({ notIn: ['ONBOARDING', 'EXITED'] });
  });
});
