import type { AccessTokenClaims } from '@hrms/types';
import { BadRequestException } from '@nestjs/common';
import { settingsDouble } from '../settings/settings.test-double';
import { wfhDouble } from '../wfh/wfh.test-double';
import { AttendanceService } from './attendance.service';

type Mock = jest.Mock;

const SHIFT = { startTime: '09:00', endTime: '18:00', graceMinutes: 15 };

interface SessionRow {
  id: string;
  checkIn: Date;
  checkOut: Date | null;
  workMode?: string;
  inVerification?: string;
  inLatitude?: number | null;
  inLongitude?: number | null;
  inDistanceMeters?: number | null;
  locationId?: string | null;
}
interface RecordRow {
  id: string;
  checkIn: Date | null;
  checkOut: Date | null;
  workMinutes: number | null;
  isLate: boolean;
  status: string;
  note: string | null;
  workMode?: string | null;
}

/** The Ahmedabad head office, placed on the map. */
const OFFICE = {
  id: 'loc1',
  type: 'HEAD_OFFICE' as const,
  latitude: 23.0225,
  longitude: 72.5714,
  geofenceRadiusMeters: 200,
};
const AT_OFFICE = { latitude: 23.0226, longitude: 72.5715, accuracyMeters: 20 };
const FAR_AWAY = { latitude: 23.06, longitude: 72.5714, accuracyMeters: 20 };

const ago = (ms: number) => new Date(Date.now() - ms);
const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

/**
 * The double keeps the day's sessions in memory rather than stubbing each call,
 * because clocking in, out and back in is a sequence: the point of the tests is
 * what the second clock-in sees, which per-call stubs cannot express.
 */
function makeService(
  seed: { record?: RecordRow; sessions?: SessionRow[]; offices?: (typeof OFFICE)[] } = {},
) {
  // Sessions seeded without a mode are office ones, which is what every
  // pre-existing row in a real database backfilled to.
  const sessions: SessionRow[] = (seed.sessions ?? []).map((s) => ({
    workMode: 'OFFICE',
    inVerification: 'NOT_APPLICABLE',
    ...s,
  }));
  let record: RecordRow | null = seed.record ?? null;
  let nextId = sessions.length + 1;
  const withSessions = () => (record ? { ...record, sessions: [...sessions] } : null);

  const prisma = {
    location: { findMany: jest.fn(async () => seed.offices ?? []) },
    employee: {
      findFirst: jest.fn().mockResolvedValue({
        id: 'e1',
        organizationId: 'org1',
        shift: SHIFT,
        joinDate: new Date('2026-01-01T00:00:00.000Z'),
        exitDate: null,
        location: { timezone: 'Asia/Kolkata' },
        organization: { timezone: 'UTC' },
      }),
    },
    attendanceRecord: {
      findUnique: jest.fn(async () => withSessions()),
      findUniqueOrThrow: jest.fn(async () => withSessions()),
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        record = {
          id: 'a1',
          checkIn: null,
          checkOut: null,
          workMinutes: null,
          isLate: false,
          note: null,
          ...data,
        } as RecordRow;
        return record;
      }),
      update: jest.fn(async ({ data }: { data: Partial<RecordRow> }) => {
        record = { ...(record as RecordRow), ...data };
        return withSessions();
      }),
    },
    attendanceSession: {
      create: jest.fn(async ({ data }: { data: { checkIn: Date; checkOut?: Date | null } }) => {
        const row: SessionRow = { id: `s${nextId++}`, checkOut: null, ...data };
        sessions.push(row);
        return row;
      }),
      update: jest.fn(
        async ({ where, data }: { where: { id: string }; data: Partial<SessionRow> }) => {
          const row = sessions.find((s) => s.id === where.id) as SessionRow;
          Object.assign(row, data);
          return row;
        },
      ),
      deleteMany: jest.fn(async () => {
        sessions.length = 0;
        return { count: 0 };
      }),
    },
    holiday: { count: jest.fn().mockResolvedValue(0) },
    auditLog: { create: jest.fn() },
  };
  return {
    // biome-ignore lint/suspicious/noExplicitAny: structural test double
    service: new AttendanceService(prisma as any, settingsDouble(), wfhDouble()),
    prisma,
    sessions,
    day: () => record,
  };
}

const claims = (over: Partial<AccessTokenClaims> = {}): AccessTokenClaims => ({
  sub: 'u1',
  orgId: 'org1',
  employeeId: 'e1',
  roleCode: 'EMPLOYEE',
  perms: ['attendance.mark.own'],
  ...over,
});

describe('AttendanceService.contextFor', () => {
  it('prefers the location timezone over the org default', async () => {
    const { service } = makeService();
    await expect(service.contextFor('e1')).resolves.toMatchObject({
      timeZone: 'Asia/Kolkata',
      shift: SHIFT,
    });
  });

  it('falls back to the org timezone when the location has none', async () => {
    const { service, prisma } = makeService();
    (prisma.employee.findFirst as Mock).mockResolvedValue({
      id: 'e1',
      organizationId: 'org1',
      shift: null,
      joinDate: new Date('2026-01-01T00:00:00.000Z'),
      exitDate: null,
      location: { timezone: null },
      organization: { timezone: 'UTC' },
    });
    await expect(service.contextFor('e1')).resolves.toMatchObject({ timeZone: 'UTC' });
  });
});

describe('AttendanceService.checkIn', () => {
  it('rejects an account with no employee record', async () => {
    const { service } = makeService();
    await expect(service.checkIn(claims({ employeeId: undefined }))).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('creates the day record with its first session and audits it', async () => {
    const { service, prisma, sessions } = makeService();
    const entry = await service.checkIn(claims());
    expect(prisma.attendanceRecord.create).toHaveBeenCalled();
    expect(entry.checkIn).not.toBeNull();
    expect(sessions).toHaveLength(1);
    expect(entry.sessions).toHaveLength(1);
    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: 'attendance.check_in' }) }),
    );
  });

  it('is idempotent while a session is open — a double tap is not a new sitting', async () => {
    const first = ago(2 * HOUR);
    const { service, prisma, sessions } = makeService({
      record: {
        id: 'a1',
        checkIn: first,
        checkOut: null,
        workMinutes: null,
        isLate: false,
        status: 'PRESENT',
        note: null,
      },
      sessions: [{ id: 's1', checkIn: first, checkOut: null }],
    });

    const entry = await service.checkIn(claims());
    expect(entry.checkIn).toBe(first.toISOString());
    expect(sessions).toHaveLength(1);
    expect(prisma.attendanceSession.create).not.toHaveBeenCalled();
  });

  it('opens a second session after a clock-out — the day is not over', async () => {
    // The reported bug: an accidental clock-out used to lock the day.
    const { service, sessions, day } = makeService({
      record: {
        id: 'a1',
        checkIn: ago(4 * HOUR),
        checkOut: ago(3 * HOUR),
        workMinutes: 60,
        isLate: false,
        status: 'PRESENT',
        note: null,
      },
      sessions: [{ id: 's1', checkIn: ago(4 * HOUR), checkOut: ago(3 * HOUR) }],
    });

    const entry = await service.checkIn(claims());
    expect(sessions).toHaveLength(2);
    expect(sessions[1]?.checkOut).toBeNull();
    // Back in, so the day reads as open again for "who is in right now".
    expect(entry.checkOut).toBeNull();
    expect(day()?.checkOut).toBeNull();
  });

  it('reopens the session just closed, so a mis-tap leaves no trace', async () => {
    const { service, sessions } = makeService({
      record: {
        id: 'a1',
        checkIn: ago(HOUR),
        checkOut: ago(5 * 1000),
        workMinutes: 60,
        isLate: false,
        status: 'PRESENT',
        note: null,
      },
      sessions: [{ id: 's1', checkIn: ago(HOUR), checkOut: ago(5 * 1000) }],
    });

    const entry = await service.checkIn(claims());
    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.checkOut).toBeNull();
    expect(entry.checkIn).toBe(sessions[0]?.checkIn.toISOString());
  });

  it('starts a fresh session once the mis-tap window has passed', async () => {
    const { service, sessions } = makeService({
      record: {
        id: 'a1',
        checkIn: ago(HOUR),
        checkOut: ago(5 * MINUTE),
        workMinutes: 55,
        isLate: false,
        status: 'PRESENT',
        note: null,
      },
      sessions: [{ id: 's1', checkIn: ago(HOUR), checkOut: ago(5 * MINUTE) }],
    });

    await service.checkIn(claims());
    expect(sessions).toHaveLength(2);
  });

  it('refuses to keep opening sessions past the daily cap', async () => {
    const closed = Array.from({ length: 20 }, (_, i) => ({
      id: `s${i}`,
      checkIn: ago((10 - i / 4) * HOUR),
      checkOut: ago((9 - i / 4) * HOUR),
    }));
    const { service } = makeService({
      record: {
        id: 'a1',
        checkIn: closed[0]?.checkIn ?? null,
        checkOut: ago(HOUR),
        workMinutes: 600,
        isLate: false,
        status: 'PRESENT',
        note: null,
      },
      sessions: closed,
    });

    await expect(service.checkIn(claims())).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('AttendanceService.checkOut', () => {
  /** A day with one session still running, started `since` ago. */
  const openDay = (since: number) => ({
    record: {
      id: 'a1',
      checkIn: ago(since),
      checkOut: null,
      workMinutes: null,
      isLate: false,
      status: 'PRESENT',
      note: null,
    },
    sessions: [{ id: 's1', checkIn: ago(since), checkOut: null }],
  });

  it('refuses to clock out without a clock-in', async () => {
    const { service } = makeService();
    await expect(service.checkOut(claims())).rejects.toBeInstanceOf(BadRequestException);
  });

  it('marks a full day PRESENT with worked minutes', async () => {
    const { service, prisma } = makeService(openDay(8 * HOUR));

    await service.checkOut(claims());
    const data = (prisma.attendanceRecord.update as Mock).mock.calls[0][0].data;
    expect(data.status).toBe('PRESENT');
    expect(data.workMinutes).toBeGreaterThanOrEqual(479);
  });

  it('marks a short day HALF_DAY', async () => {
    const { service, prisma } = makeService(openDay(2 * HOUR));

    await service.checkOut(claims());
    expect((prisma.attendanceRecord.update as Mock).mock.calls[0][0].data.status).toBe('HALF_DAY');
  });

  it('is idempotent — clocking out twice keeps the original checkout', async () => {
    const out = ago(HOUR);
    const { service, prisma } = makeService({
      record: {
        id: 'a1',
        checkIn: ago(9 * HOUR),
        checkOut: out,
        workMinutes: 480,
        isLate: false,
        status: 'PRESENT',
        note: null,
      },
      sessions: [{ id: 's1', checkIn: ago(9 * HOUR), checkOut: out }],
    });

    const entry = await service.checkOut(claims());
    expect(entry.checkOut).toBe(out.toISOString());
    expect(prisma.attendanceRecord.update).not.toHaveBeenCalled();
  });

  it('adds the sessions up rather than spanning them, so lunch is unpaid', async () => {
    const { service, prisma } = makeService({
      record: {
        id: 'a1',
        checkIn: ago(9 * HOUR),
        checkOut: ago(5 * HOUR),
        workMinutes: 240,
        isLate: false,
        status: 'PRESENT',
        note: null,
      },
      sessions: [
        { id: 's1', checkIn: ago(9 * HOUR), checkOut: ago(5 * HOUR) },
        { id: 's2', checkIn: ago(4 * HOUR), checkOut: null },
      ],
    });

    await service.checkOut(claims());
    const data = (prisma.attendanceRecord.update as Mock).mock.calls[0][0].data;
    // 4h + 4h worked across a 9h span.
    expect(data.workMinutes).toBeGreaterThanOrEqual(479);
    expect(data.workMinutes).toBeLessThan(9 * 60);
    expect(data.status).toBe('PRESENT');
  });

  it('does not freeze a day at HALF_DAY when a mistaken clock-out is undone', async () => {
    // Regression: a three-second session used to leave the day at HALF_DAY,
    // which no amount of later work could undo because clock-in was refused.
    const { service, prisma } = makeService({
      record: {
        id: 'a1',
        checkIn: ago(8 * HOUR),
        checkOut: ago(8 * HOUR),
        workMinutes: 0,
        isLate: false,
        status: 'HALF_DAY',
        note: null,
      },
      sessions: [
        { id: 's1', checkIn: ago(8 * HOUR), checkOut: ago(8 * HOUR) },
        { id: 's2', checkIn: ago(8 * HOUR), checkOut: null },
      ],
    });

    await service.checkOut(claims());
    expect((prisma.attendanceRecord.update as Mock).mock.calls[0][0].data.status).toBe('PRESENT');
  });

  it('leaves a deliberate status like ON_LEAVE alone', async () => {
    // Statuses that did not come from the day's own sessions must survive a
    // clock-out. WFH no longer belongs in that set — it is earned now.
    const { service, prisma } = makeService({
      record: {
        id: 'a1',
        checkIn: ago(8 * HOUR),
        checkOut: null,
        workMinutes: null,
        isLate: false,
        status: 'ON_LEAVE',
        note: null,
      },
      sessions: [{ id: 's1', checkIn: ago(8 * HOUR), checkOut: null }],
    });

    await service.checkOut(claims());
    expect((prisma.attendanceRecord.update as Mock).mock.calls[0][0].data.status).toBeUndefined();
  });
});

describe('AttendanceService — where someone worked', () => {
  const officeDay = (mode: string) => ({
    record: {
      id: 'a1',
      checkIn: ago(8 * HOUR),
      checkOut: null,
      workMinutes: null,
      isLate: false,
      status: 'PRESENT',
      note: null,
    },
    sessions: [{ id: 's1', checkIn: ago(8 * HOUR), checkOut: null, workMode: mode }],
    offices: [OFFICE],
  });

  it('reads an office day from a position at the office', async () => {
    const { service, sessions } = makeService({ offices: [OFFICE] });
    await service.checkIn(claims(), AT_OFFICE);
    expect(sessions[0]?.workMode).toBe('OFFICE');
    expect(sessions[0]?.inVerification).toBe('VERIFIED');
    expect(sessions[0]?.locationId).toBe('loc1');
  });

  it('reads a remote day from a position away from the office', async () => {
    const { service, sessions } = makeService({ offices: [OFFICE] });
    const entry = await service.checkIn(claims(), FAR_AWAY);
    expect(sessions[0]?.workMode).toBe('REMOTE');
    expect(sessions[0]?.inVerification).toBe('VERIFIED');
    expect(entry.checkIn).not.toBeNull();
  });

  it('keeps no coordinates once the day reads as remote — that is somebody’s home', async () => {
    const { service, sessions } = makeService({ offices: [OFFICE] });
    await service.checkIn(claims(), FAR_AWAY);
    expect(sessions[0]?.workMode).toBe('REMOTE');
    expect(sessions[0]?.inLatitude).toBeNull();
    expect(sessions[0]?.inLongitude).toBeNull();
    // The distance survives; it is the reason for the call, not a location.
    expect(sessions[0]?.inDistanceMeters).toBeGreaterThan(4000);
  });

  it('falls back to an unverified office day when nothing is on the map', async () => {
    const { service, sessions } = makeService({ offices: [] });
    const entry = await service.checkIn(claims(), AT_OFFICE);
    expect(sessions[0]?.workMode).toBe('OFFICE');
    expect(sessions[0]?.inVerification).toBe('UNVERIFIED');
    expect(entry.checkIn).not.toBeNull();
  });

  it('falls back the same way when the device could not supply a position', async () => {
    const { service, sessions } = makeService({ offices: [OFFICE] });
    const entry = await service.checkIn(claims(), { locationUnavailable: true });
    expect(sessions[0]?.workMode).toBe('OFFICE');
    expect(sessions[0]?.inVerification).toBe('UNVERIFIED');
    expect(entry.checkIn).not.toBeNull();
  });

  it('measures again when a mis-tap reopens a session', async () => {
    // Opened at the office, reopened seconds later from somewhere else: the
    // reopened sitting must take the new reading, not keep the stale one.
    const { service, sessions } = makeService({
      record: {
        id: 'a1',
        checkIn: ago(HOUR),
        checkOut: ago(5 * 1000),
        workMinutes: 60,
        isLate: false,
        status: 'PRESENT',
        note: null,
      },
      sessions: [
        {
          id: 's1',
          checkIn: ago(HOUR),
          checkOut: ago(5 * 1000),
          workMode: 'OFFICE',
          inVerification: 'VERIFIED',
        },
      ],
      offices: [OFFICE],
    });

    await service.checkIn(claims(), FAR_AWAY);
    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.workMode).toBe('REMOTE');
    expect(sessions[0]?.checkOut).toBeNull();
  });

  it('earns WFH for a day worked entirely from home', async () => {
    const { service, prisma } = makeService(officeDay('REMOTE'));
    await service.checkOut(claims());
    const data = (prisma.attendanceRecord.update as Mock).mock.calls[0][0].data;
    expect(data.workMode).toBe('REMOTE');
    expect(data.status).toBe('WFH');
  });

  it('moves a day back off WFH once someone comes in', async () => {
    // The trap this design has to avoid: a remote morning must not fix the day
    // as WFH after an office afternoon.
    const { service, prisma } = makeService({
      record: {
        id: 'a1',
        checkIn: ago(9 * HOUR),
        checkOut: ago(5 * HOUR),
        workMinutes: 240,
        isLate: false,
        status: 'WFH',
        note: null,
        workMode: 'REMOTE',
      },
      sessions: [
        { id: 's1', checkIn: ago(9 * HOUR), checkOut: ago(5 * HOUR), workMode: 'REMOTE' },
        { id: 's2', checkIn: ago(4 * HOUR), checkOut: null, workMode: 'OFFICE' },
      ],
      offices: [OFFICE],
    });

    await service.checkOut(claims());
    const data = (prisma.attendanceRecord.update as Mock).mock.calls[0][0].data;
    expect(data.workMode).toBe('OFFICE');
    expect(data.status).toBe('PRESENT');
  });

  it('keeps a short remote day a half day — hours outrank place', async () => {
    const { service, prisma } = makeService({
      record: {
        id: 'a1',
        checkIn: ago(2 * HOUR),
        checkOut: null,
        workMinutes: null,
        isLate: false,
        status: 'PRESENT',
        note: null,
      },
      sessions: [{ id: 's1', checkIn: ago(2 * HOUR), checkOut: null, workMode: 'REMOTE' }],
      offices: [OFFICE],
    });

    await service.checkOut(claims());
    expect((prisma.attendanceRecord.update as Mock).mock.calls[0][0].data.status).toBe('HALF_DAY');
  });
});

describe('AttendanceService leave visibility (regression)', () => {
  // Approved leave was previously only wired into the employee's own month
  // view, so managers saw ABSENT and summaries counted leave as absence.
  function makeScoped() {
    const employee = {
      id: 'e1',
      firstName: 'Dev',
      lastName: 'Tester',
      employeeCode: 'EMP-0100',
      avatarUrl: null,
      joinDate: new Date('2026-01-01T00:00:00.000Z'),
      exitDate: null,
      department: { name: 'Engineering' },
      attendance: [],
    };
    const prisma = {
      employee: {
        findMany: jest.fn().mockResolvedValue([employee]),
        count: jest.fn().mockResolvedValue(1),
      },
      organization: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({ timezone: 'UTC' }),
      },
      holiday: { count: jest.fn().mockResolvedValue(0), findMany: jest.fn().mockResolvedValue([]) },
      leaveRequest: {
        findMany: jest.fn().mockResolvedValue([
          {
            employeeId: 'e1',
            startDate: new Date('2026-08-03T00:00:00.000Z'),
            endDate: new Date('2026-08-05T00:00:00.000Z'),
          },
        ]),
      },
    };
    // biome-ignore lint/suspicious/noExplicitAny: structural test double
    return { service: new AttendanceService(prisma as any, settingsDouble(), wfhDouble()), prisma };
  }

  const hrClaims = claims({ perms: ['attendance.read'], employeeId: 'mgr' });
  const query = { page: 1, limit: 10, order: 'asc' as const, sort: undefined, search: undefined };

  it('day view shows ON_LEAVE, not ABSENT, for approved leave', async () => {
    const { service } = makeScoped();
    const result = await service.dayView(hrClaims, { ...query, date: '2026-08-04' });
    expect(result.data[0]?.status).toBe('ON_LEAVE');
  });

  it('monthly summary counts leave under onLeave, not absent', async () => {
    const { service } = makeScoped();
    const result = await service.monthlySummary(hrClaims, { ...query, month: '2026-08' });
    // 3rd–5th Aug 2026: Mon, Tue, Wed — three working days of leave
    expect(result.data[0]?.onLeave).toBe(3);
  });
});

describe('AttendanceService remote-day flag', () => {
  /**
   * Derived on read, never stored. The point of the flag is that an
   * unapproved remote day is still a complete record of a day somebody
   * worked — refusing the punch would have lost it.
   */
  function makeRemoteDay(approved: Set<string>, workMode: string | null = 'REMOTE') {
    const employee = {
      id: 'e1',
      firstName: 'Dev',
      lastName: 'Tester',
      employeeCode: 'EMP-0100',
      avatarUrl: null,
      joinDate: new Date('2026-01-01T00:00:00.000Z'),
      exitDate: null,
      department: { name: 'Engineering' },
      attendance: [
        {
          id: 'a1',
          checkIn: new Date('2026-08-10T09:00:00.000Z'),
          checkOut: new Date('2026-08-10T18:00:00.000Z'),
          workMinutes: 480,
          isLate: false,
          status: 'WFH',
          note: null,
          workMode,
          sessions: [],
        },
      ],
    };
    const prisma = {
      employee: {
        findMany: jest.fn().mockResolvedValue([employee]),
        count: jest.fn().mockResolvedValue(1),
      },
      organization: { findUniqueOrThrow: jest.fn().mockResolvedValue({ timezone: 'UTC' }) },
      holiday: { count: jest.fn().mockResolvedValue(0), findMany: jest.fn().mockResolvedValue([]) },
      leaveRequest: { findMany: jest.fn().mockResolvedValue([]) },
    };
    // biome-ignore lint/suspicious/noExplicitAny: structural test double
    return new AttendanceService(prisma as any, settingsDouble(), wfhDouble(approved));
  }

  const hrClaims = claims({ perms: ['attendance.read'], employeeId: 'mgr' });
  const query = { page: 1, limit: 10, order: 'asc' as const, sort: undefined, search: undefined };
  const MON = '2026-08-10';

  it('marks a remote day nobody agreed to', async () => {
    const service = makeRemoteDay(new Set());
    const result = await service.dayView(hrClaims, { ...query, date: MON });

    expect(result.data[0]?.status).toBe('WFH');
    expect(result.data[0]?.remoteApproved).toBe(false);
  });

  it('leaves an agreed remote day unmarked', async () => {
    const service = makeRemoteDay(new Set([`e1|${MON}`]));
    const result = await service.dayView(hrClaims, { ...query, date: MON });

    expect(result.data[0]?.remoteApproved).toBe(true);
  });

  /*
   * Null, not false. An office day has nothing to approve, and "false" there
   * would read as a refusal rather than as a question that does not arise.
   */
  it('says nothing either way about a day worked from the office', async () => {
    const service = makeRemoteDay(new Set(), 'OFFICE');
    const result = await service.dayView(hrClaims, { ...query, date: MON });

    expect(result.data[0]?.remoteApproved).toBeNull();
  });
});
