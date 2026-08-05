import type { AccessTokenClaims } from '@hrms/types';
import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { notificationsDouble } from '../notifications/notifications.test-double';
import { settingsDouble } from '../settings/settings.test-double';
import { WfhService } from './wfh.service';

/** 2026-08-10 is a Monday; the default working week is Mon–Fri. */
const MON = '2026-08-10';
const TUE = '2026-08-11';
const WED = '2026-08-12';
const THU = '2026-08-13';
const FRI = '2026-08-14';

const request = {
  id: 'r1',
  organizationId: 'org1',
  employeeId: 'e1',
  startDate: new Date(`${MON}T00:00:00.000Z`),
  endDate: new Date(`${MON}T00:00:00.000Z`),
  days: 1,
  reason: 'Plumber',
  status: 'PENDING' as string,
  employee: { id: 'e1', firstName: 'Ada', lastName: 'Lovelace', managerId: 'mgr1' },
};

interface Over {
  request?: object;
  /** Other requests already held, as [start, end] date-key pairs. */
  held?: [string, string][];
  overlap?: object | null;
  remoteDaysPerWeek?: number | null;
  holidays?: string[];
}

function makeService(over: Over = {}, settings: Parameters<typeof settingsDouble>[0] = {}) {
  const held = (over.held ?? []).map(([s, e]) => ({
    startDate: new Date(`${s}T00:00:00.000Z`),
    endDate: new Date(`${e}T00:00:00.000Z`),
    employeeId: 'e1',
  }));

  // biome-ignore lint/suspicious/noExplicitAny: structural test double
  const prisma: any = {
    remoteWorkRequest: {
      // The overlap probe asks for one row and selects only the dates; every
      // other findFirst is the record itself.
      findFirst: jest.fn((args: { select?: object }) =>
        Promise.resolve(
          args?.select
            ? over.overlap === undefined
              ? null
              : over.overlap
            : { ...request, ...over.request },
        ),
      ),
      findMany: jest.fn().mockResolvedValue(held),
      count: jest.fn().mockResolvedValue(held.length),
      create: jest.fn().mockResolvedValue({ ...request, ...over.request }),
      update: jest.fn().mockResolvedValue({ ...request, ...over.request }),
    },
    employee: {
      findFirst: jest.fn().mockResolvedValue({ remoteDaysPerWeek: over.remoteDaysPerWeek ?? null }),
      findMany: jest.fn().mockResolvedValue([{ userId: 'u-emp' }]),
    },
    holiday: {
      findMany: jest
        .fn()
        .mockResolvedValue(
          (over.holidays ?? []).map((d) => ({ date: new Date(`${d}T00:00:00.000Z`) })),
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
  const service = new WfhService(prisma, settingsDouble(settings), notifications);
  return { service, prisma, notifications };
}

const employee: AccessTokenClaims = {
  sub: 'u-emp',
  orgId: 'org1',
  roleCode: 'EMPLOYEE',
  perms: ['wfh.request.own', 'wfh.read.own'],
  employeeId: 'e1',
};
const manager: AccessTokenClaims = {
  sub: 'u-mgr',
  orgId: 'org1',
  roleCode: 'MANAGER',
  perms: ['wfh.approve.team', 'wfh.read.team'],
  employeeId: 'mgr1',
};

const apply = (startDate: string, endDate = startDate) => ({
  startDate,
  endDate,
  reason: 'Plumber coming',
});

describe('preview', () => {
  it('counts working days and names the ones it skipped', async () => {
    const { service } = makeService({ holidays: [WED] });
    // Sat and Sun are week-offs by default; Wednesday is a holiday.
    const preview = await service.preview(employee, { startDate: MON, endDate: '2026-08-16' });

    expect(preview.workingDays).toEqual([MON, TUE, THU, FRI]);
    expect(preview.skipped).toEqual([WED, '2026-08-15', '2026-08-16']);
  });

  it('reports the cap and the week that would go over', async () => {
    const { service } = makeService();
    const preview = await service.preview(employee, { startDate: MON, endDate: WED });

    expect(preview.cap).toBe(2);
    expect(preview.breaches).toEqual([{ weekKey: MON, would: 3, cap: 2 }]);
  });
});

describe('filing', () => {
  it('stores the working days rather than the calendar span', async () => {
    // A full week, so the assertion is about the count and not the cap.
    const { service, prisma } = makeService({ remoteDaysPerWeek: 5 });
    await service.apply(employee, apply(MON, '2026-08-16'));

    expect(prisma.remoteWorkRequest.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ days: 5 }) }),
    );
  });

  it('refuses a range that is all weekend', async () => {
    const { service } = makeService();
    await expect(service.apply(employee, apply('2026-08-15', '2026-08-16'))).rejects.toThrow(
      /all weekends and holidays/,
    );
  });

  it('refuses days that have already gone', async () => {
    const { service } = makeService();
    await expect(service.apply(employee, apply('2020-01-06'))).rejects.toThrow(/agreed in advance/);
  });

  it('refuses a range overlapping one they already have', async () => {
    const { service } = makeService({
      overlap: {
        startDate: new Date(`${MON}T00:00:00.000Z`),
        endDate: new Date(`${TUE}T00:00:00.000Z`),
      },
    });
    await expect(service.apply(employee, apply(TUE))).rejects.toThrow(ConflictException);
  });

  it('names the week and the count when the cap is reached', async () => {
    const { service } = makeService();
    await expect(service.apply(employee, apply(MON, WED))).rejects.toThrow(
      /3 in the week of .* and you have 2 remote days a week/,
    );
  });

  /*
   * The bug this exists to catch. The cap is per *week*, so asking for the
   * Monday has to see an approved Friday in the same week — and Friday is
   * outside the requested range. Querying only the range's own span made this
   * pass silently and the week go over.
   */
  it('counts days approved later in the same week, outside the requested range', async () => {
    const { service } = makeService({ held: [[THU, FRI]] });
    await expect(service.apply(employee, apply(MON))).rejects.toThrow(/3 in the week of/);
  });

  it('lets a second day through when the week still has room', async () => {
    const { service, prisma } = makeService({ held: [[THU, THU]] });
    await service.apply(employee, apply(MON));
    expect(prisma.remoteWorkRequest.create).toHaveBeenCalled();
  });

  /* Their own arrangement wins over the company's. */
  it('lets somebody with their own allowance book a full week', async () => {
    const { service, prisma } = makeService({ remoteDaysPerWeek: 5 });
    await service.apply(employee, apply(MON, FRI));
    expect(prisma.remoteWorkRequest.create).toHaveBeenCalled();
  });

  /*
   * Zero is a real allowance, not "unset" — the trap the rules deliberately
   * avoid by not treating zero as a no-limit sentinel.
   */
  it('refuses any day at all to somebody whose allowance is zero', async () => {
    const { service } = makeService({ remoteDaysPerWeek: 0 });
    await expect(service.apply(employee, apply(MON))).rejects.toThrow(/you have no remote days/);
  });

  it('files it pending, and tells the manager', async () => {
    const { service, prisma, notifications } = makeService();
    await service.apply(employee, apply(MON));

    const { data } = prisma.remoteWorkRequest.create.mock.calls[0][0];
    expect(data.status).toBeUndefined();
    expect(notifications.notify).toHaveBeenCalledWith(
      ['u-emp'],
      expect.objectContaining({ type: 'wfh.requested' }),
    );
  });

  /* For a company that treats remote days as a record, not a permission. */
  it('approves as filed when the organization asks for no approval', async () => {
    const { service, prisma, notifications } = makeService(
      {},
      { wfh: { enabled: true, maxDaysPerWeek: 2, requireApproval: false } },
    );
    await service.apply(employee, apply(MON));

    const { data } = prisma.remoteWorkRequest.create.mock.calls[0][0];
    expect(data.status).toBe('APPROVED');
    expect(notifications.notify).not.toHaveBeenCalled();
  });

  it('refuses everything when remote working is switched off', async () => {
    const { service } = makeService(
      {},
      { wfh: { enabled: false, maxDaysPerWeek: 2, requireApproval: true } },
    );
    await expect(service.apply(employee, apply(MON))).rejects.toThrow(/switched off/);
  });
});

describe('deciding', () => {
  it('lets the reporting manager approve', async () => {
    const { service, prisma } = makeService();
    await service.decide(manager, 'r1', true, {});

    expect(prisma.remoteWorkRequest.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'APPROVED' }) }),
    );
  });

  it('refuses somebody who is not their manager', async () => {
    const { service } = makeService({
      request: { employee: { ...request.employee, managerId: 'other' } },
    });
    await expect(service.decide(manager, 'r1', true, {})).rejects.toThrow(ForbiddenException);
  });

  it('refuses to let anybody approve their own', async () => {
    const self: AccessTokenClaims = { ...manager, employeeId: 'e1', perms: ['wfh.approve'] };
    const { service } = makeService();
    await expect(service.decide(self, 'r1', true, {})).rejects.toThrow(/your own/);
  });

  it('refuses a request somebody has already decided', async () => {
    const { service } = makeService({ request: { status: 'APPROVED' } });
    await expect(service.decide(manager, 'r1', true, {})).rejects.toThrow(/already been decided/);
  });

  /*
   * Two requests can each pass on the way in and only collide once one is
   * approved — the first decision is what makes those days real.
   */
  it('re-checks the cap at approval, not only at submission', async () => {
    const { service } = makeService({ held: [[THU, FRI]] });
    await expect(service.decide(manager, 'r1', true, {})).rejects.toThrow(ConflictException);
  });

  it('tells them the answer either way', async () => {
    const { service, notifications } = makeService();
    await service.decide(manager, 'r1', false, { note: 'Team day' });

    expect(notifications.notify).toHaveBeenCalledWith(
      ['u-emp'],
      expect.objectContaining({ type: 'wfh.rejected' }),
    );
  });
});

describe('the flag attendance reads', () => {
  it('returns the working days of every approved request in the window', async () => {
    const { service } = makeService({ held: [[MON, TUE]] });
    const approved = await service.approvedDaysIn('org1', ['e1'], MON, FRI);

    expect([...approved]).toEqual([`e1:${MON}`, `e1:${TUE}`]);
  });

  /* A request may start before the window and end after it. */
  it('clips a request that overhangs the window', async () => {
    const { service } = makeService({ held: [['2026-08-03', FRI]] });
    const approved = await service.approvedDaysIn('org1', ['e1'], WED, THU);

    expect([...approved]).toEqual([`e1:${WED}`, `e1:${THU}`]);
  });

  it('never counts a weekend as an approved day', async () => {
    const { service } = makeService({ held: [[MON, '2026-08-16']] });
    const approved = await service.approvedDaysIn('org1', ['e1'], MON, '2026-08-16');

    expect(approved.has('e1:2026-08-15')).toBe(false);
    expect(approved.size).toBe(5);
  });

  it('asks the database nothing when there is nobody to ask about', async () => {
    const { service, prisma } = makeService();
    const approved = await service.approvedDaysIn('org1', [], MON, FRI);

    expect(approved.size).toBe(0);
    expect(prisma.remoteWorkRequest.findMany).not.toHaveBeenCalled();
  });
});

describe('cancelling', () => {
  it('lets them withdraw their own', async () => {
    const { service, prisma } = makeService();
    await service.cancel(employee, 'r1');

    expect(prisma.remoteWorkRequest.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'CANCELLED' }) }),
    );
  });

  it('refuses somebody else theirs', async () => {
    const other: AccessTokenClaims = { ...employee, employeeId: 'e2' };
    const { service } = makeService();
    await expect(service.cancel(other, 'r1')).rejects.toThrow(ForbiddenException);
  });

  /*
   * Cancelling a day already worked would make the attendance flag disagree
   * with a decision somebody acted on at the time.
   */
  it('refuses approved days that have already passed', async () => {
    const { service } = makeService({
      request: {
        status: 'APPROVED',
        startDate: new Date('2020-01-06T00:00:00.000Z'),
        endDate: new Date('2020-01-06T00:00:00.000Z'),
      },
    });
    await expect(service.cancel(employee, 'r1')).rejects.toThrow(BadRequestException);
  });
});
