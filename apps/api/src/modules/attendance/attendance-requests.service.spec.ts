import type { AccessTokenClaims } from '@hrms/types';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { settingsDouble } from '../settings/settings.test-double';
import { AttendanceService } from './attendance.service';
import { AttendanceRequestsService } from './attendance-requests.service';

const SHIFT = { startTime: '09:00', endTime: '18:00', graceMinutes: 15 };
const DAY = new Date('2026-08-03T00:00:00.000Z');
const at = (hhmm: string) => new Date(`2026-08-03T${hhmm}:00.000Z`);

interface SessionRow {
  id: string;
  checkIn: Date;
  checkOut: Date | null;
}

/**
 * Same in-memory shape as the attendance service spec: approving a correction
 * rewrites sessions and then rolls the record up from them, so the assertions
 * are about what the day looks like afterwards rather than which calls fired.
 */
function makeService(seed: {
  sessions?: SessionRow[];
  requestedIn?: Date | null;
  requestedOut?: Date | null;
  status?: string;
  isLate?: boolean;
}) {
  const sessions: SessionRow[] = seed.sessions ?? [];
  let record: Record<string, unknown> | null = sessions.length
    ? {
        id: 'a1',
        checkIn: sessions[0]?.checkIn ?? null,
        checkOut: sessions[sessions.length - 1]?.checkOut ?? null,
        workMinutes: 0,
        isLate: seed.isLate ?? false,
        status: 'PRESENT',
        note: null,
      }
    : null;
  let nextId = sessions.length + 1;
  const withSessions = () => (record ? { ...record, sessions: [...sessions] } : null);

  const request = {
    id: 'r1',
    employeeId: 'e1',
    date: DAY,
    requestedIn: seed.requestedIn ?? null,
    requestedOut: seed.requestedOut ?? null,
    reason: 'Forgot to clock out after the client visit',
    status: seed.status ?? 'PENDING',
    employee: { id: 'e1', firstName: 'Asha', lastName: 'R', employeeCode: 'E1', managerId: 'm1' },
  };

  const prisma = {
    // Annotated because it hands the double back to its own caller, which
    // would otherwise make the object's type circular.
    $transaction: jest.fn(
      async (fn: (tx: unknown) => Promise<unknown>): Promise<unknown> => fn(prisma),
    ),
    employee: {
      findFirst: jest.fn().mockResolvedValue({
        id: 'e1',
        organizationId: 'org1',
        shift: SHIFT,
        joinDate: new Date('2026-01-01T00:00:00.000Z'),
        exitDate: null,
        location: { timezone: 'UTC' },
        organization: { timezone: 'UTC' },
      }),
    },
    attendanceRequest: {
      findFirst: jest.fn(async () => request),
      findUniqueOrThrow: jest.fn(async () => request),
      update: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        Object.assign(request, data);
        return request;
      }),
    },
    attendanceRecord: {
      findUniqueOrThrow: jest.fn(async () => withSessions()),
      upsert: jest.fn(async ({ create }: { create: Record<string, unknown> }) => {
        record ??= {
          id: 'a1',
          checkIn: null,
          checkOut: null,
          workMinutes: null,
          isLate: false,
          note: null,
          ...create,
        };
        return withSessions();
      }),
      update: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        record = { ...(record as Record<string, unknown>), ...data };
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

  // biome-ignore lint/suspicious/noExplicitAny: structural test double
  const attendance = new AttendanceService(prisma as any, settingsDouble());
  return {
    // biome-ignore lint/suspicious/noExplicitAny: structural test double
    service: new AttendanceRequestsService(prisma as any, attendance),
    sessions,
    day: () => record,
  };
}

const claims = (over: Partial<AccessTokenClaims> = {}): AccessTokenClaims => ({
  sub: 'u9',
  orgId: 'org1',
  employeeId: 'm1',
  roleCode: 'MANAGER',
  perms: ['attendance.approve.team'],
  ...over,
});

describe('AttendanceRequestsService.decide', () => {
  it('replaces the day when both times are corrected', async () => {
    const { service, sessions, day } = makeService({
      requestedIn: at('09:30'),
      requestedOut: at('18:00'),
      sessions: [
        { id: 's1', checkIn: at('09:24'), checkOut: at('13:12') },
        { id: 's2', checkIn: at('14:06'), checkOut: at('17:00') },
      ],
    });

    await service.decide(claims(), 'r1', 'APPROVED', {});
    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.checkIn).toEqual(at('09:30'));
    expect(sessions[0]?.checkOut).toEqual(at('18:00'));
    expect(day()?.workMinutes).toBe(8 * 60 + 30);
  });

  it('moves only the last check-out, leaving the morning sitting alone', async () => {
    // "I forgot to clock out after the client visit" must not erase the morning.
    const { service, sessions, day } = makeService({
      requestedOut: at('18:30'),
      sessions: [
        { id: 's1', checkIn: at('09:00'), checkOut: at('13:00') },
        { id: 's2', checkIn: at('14:00'), checkOut: null },
      ],
    });

    await service.decide(claims(), 'r1', 'APPROVED', {});
    expect(sessions).toHaveLength(2);
    expect(sessions[0]?.checkOut).toEqual(at('13:00'));
    expect(sessions[1]?.checkOut).toEqual(at('18:30'));
    expect(day()?.workMinutes).toBe(8 * 60 + 30);
  });

  it('moves only the first check-in and clears the late mark it earned', async () => {
    const { service, sessions, day } = makeService({
      requestedIn: at('09:00'),
      isLate: true, // recorded as arriving 10:05, past shift start + grace
      sessions: [{ id: 's1', checkIn: at('10:05'), checkOut: at('18:00') }],
    });

    await service.decide(claims(), 'r1', 'APPROVED', {});
    expect(sessions[0]?.checkIn).toEqual(at('09:00'));
    expect(day()?.isLate).toBe(false);
  });

  it('applies a late mark when the correction says they arrived late', async () => {
    const { service, day } = makeService({
      requestedIn: at('10:05'),
      sessions: [{ id: 's1', checkIn: at('09:00'), checkOut: at('18:00') }],
    });

    await service.decide(claims(), 'r1', 'APPROVED', {});
    expect(day()?.isLate).toBe(true);
  });

  it('refuses a check-out correction with no clock-in to attach it to', async () => {
    const { service } = makeService({ requestedOut: at('18:00'), sessions: [] });
    await expect(service.decide(claims(), 'r1', 'APPROVED', {})).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('leaves the record agreeing with its sessions', async () => {
    const { service, sessions, day } = makeService({
      requestedIn: at('09:00'),
      requestedOut: at('17:00'),
      sessions: [{ id: 's1', checkIn: at('09:24'), checkOut: null }],
    });

    await service.decide(claims(), 'r1', 'APPROVED', {});
    expect(day()?.checkIn).toEqual(sessions[0]?.checkIn);
    expect(day()?.checkOut).toEqual(sessions[0]?.checkOut);
    expect(day()?.status).toBe('PRESENT');
    expect(day()?.source).toBe('ADMIN');
  });

  it('touches nothing when the request is rejected', async () => {
    const { service, sessions } = makeService({
      requestedIn: at('09:00'),
      requestedOut: at('18:00'),
      sessions: [{ id: 's1', checkIn: at('09:24'), checkOut: at('17:00') }],
    });

    await service.decide(claims(), 'r1', 'REJECTED', {});
    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.checkIn).toEqual(at('09:24'));
  });

  it('will not let someone approve their own correction', async () => {
    const { service } = makeService({
      requestedIn: at('09:00'),
      sessions: [{ id: 's1', checkIn: at('10:05'), checkOut: at('18:00') }],
    });

    await expect(
      service.decide(
        claims({ employeeId: 'e1', perms: ['attendance.approve'] }),
        'r1',
        'APPROVED',
        {},
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('will not decide a request twice', async () => {
    const { service } = makeService({ requestedIn: at('09:00'), status: 'APPROVED' });
    await expect(service.decide(claims(), 'r1', 'APPROVED', {})).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});
