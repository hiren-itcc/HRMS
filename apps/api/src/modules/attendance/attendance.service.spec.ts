import type { AccessTokenClaims } from '@hrms/types';
import { BadRequestException } from '@nestjs/common';
import { settingsDouble } from '../settings/settings.test-double';
import { AttendanceService } from './attendance.service';

type Mock = jest.Mock;

const SHIFT = { startTime: '09:00', endTime: '18:00', graceMinutes: 15 };

function makeService() {
  const prisma = {
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
      findUnique: jest.fn().mockResolvedValue(null),
      upsert: jest.fn().mockImplementation(({ create }) => ({ id: 'a1', ...create })),
      update: jest.fn().mockImplementation(({ data }) => ({ id: 'a1', ...data })),
    },
    holiday: { count: jest.fn().mockResolvedValue(0) },
    auditLog: { create: jest.fn() },
  };
  // biome-ignore lint/suspicious/noExplicitAny: structural test double
  return { service: new AttendanceService(prisma as any, settingsDouble()), prisma };
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

  it('creates the day record and audits it', async () => {
    const { service, prisma } = makeService();
    const entry = await service.checkIn(claims());
    expect(prisma.attendanceRecord.upsert).toHaveBeenCalled();
    expect(entry.checkIn).not.toBeNull();
    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: 'attendance.check_in' }) }),
    );
  });

  it('is idempotent — a second clock-in does not overwrite the first', async () => {
    const { service, prisma } = makeService();
    const first = new Date('2026-08-03T03:30:00.000Z');
    (prisma.attendanceRecord.findUnique as Mock).mockResolvedValue({
      id: 'a1',
      checkIn: first,
      checkOut: null,
      workMinutes: null,
      isLate: false,
      status: 'PRESENT',
      note: null,
    });

    const entry = await service.checkIn(claims());
    expect(entry.checkIn).toBe(first.toISOString());
    expect(prisma.attendanceRecord.upsert).not.toHaveBeenCalled();
  });
});

describe('AttendanceService.checkOut', () => {
  const openRecord = (checkIn: Date) => ({
    id: 'a1',
    checkIn,
    checkOut: null,
    workMinutes: null,
    isLate: false,
    status: 'PRESENT',
    note: null,
  });

  it('refuses to clock out without a clock-in', async () => {
    const { service } = makeService();
    await expect(service.checkOut(claims())).rejects.toBeInstanceOf(BadRequestException);
  });

  it('marks a full day PRESENT with worked minutes', async () => {
    const { service, prisma } = makeService();
    (prisma.attendanceRecord.findUnique as Mock).mockResolvedValue(
      openRecord(new Date(Date.now() - 8 * 60 * 60 * 1000)),
    );

    await service.checkOut(claims());
    const data = (prisma.attendanceRecord.update as Mock).mock.calls[0][0].data;
    expect(data.status).toBe('PRESENT');
    expect(data.workMinutes).toBeGreaterThanOrEqual(479);
  });

  it('marks a short day HALF_DAY', async () => {
    const { service, prisma } = makeService();
    (prisma.attendanceRecord.findUnique as Mock).mockResolvedValue(
      openRecord(new Date(Date.now() - 2 * 60 * 60 * 1000)),
    );

    await service.checkOut(claims());
    expect((prisma.attendanceRecord.update as Mock).mock.calls[0][0].data.status).toBe('HALF_DAY');
  });

  it('is idempotent — clocking out twice keeps the original checkout', async () => {
    const { service, prisma } = makeService();
    const out = new Date('2026-08-03T12:30:00.000Z');
    (prisma.attendanceRecord.findUnique as Mock).mockResolvedValue({
      ...openRecord(new Date('2026-08-03T03:30:00.000Z')),
      checkOut: out,
      workMinutes: 540,
    });

    const entry = await service.checkOut(claims());
    expect(entry.checkOut).toBe(out.toISOString());
    expect(prisma.attendanceRecord.update).not.toHaveBeenCalled();
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
    return { service: new AttendanceService(prisma as any, settingsDouble()), prisma };
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
