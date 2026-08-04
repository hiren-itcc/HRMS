import type { AccessTokenClaims } from '@hrms/types';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { EmployeesService } from './employees.service';

type Mock = jest.Mock;

function makeService() {
  const prisma = {
    employee: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      count: jest.fn().mockResolvedValue(0),
      create: jest.fn(),
      update: jest.fn().mockResolvedValue({ id: 'e1' }),
    },
    user: {
      update: jest.fn(),
      updateMany: jest.fn(),
      count: jest.fn().mockResolvedValue(1),
      findUnique: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      groupBy: jest.fn().mockResolvedValue([]),
    },
    role: { findUnique: jest.fn(), findMany: jest.fn().mockResolvedValue([]) },
    refreshSession: { updateMany: jest.fn() },
    bankDetail: { upsert: jest.fn() },
    auditLog: { create: jest.fn() },
    $transaction: jest.fn(async (ops: unknown[]) => Promise.all(ops as Promise<unknown>[])),
  };
  const config = {
    get: (key: string) => (key === 'DEFAULT_USER_PASSWORD' ? 'Welcome@2026' : undefined),
  };
  // biome-ignore lint/suspicious/noExplicitAny: structural test double
  return { service: new EmployeesService(prisma as any, config as any), prisma };
}

const claims = (over: Partial<AccessTokenClaims>): AccessTokenClaims => ({
  sub: 'u1',
  orgId: 'org1',
  roleCode: 'MANAGER',
  perms: [],
  ...over,
});

const query = { page: 1, limit: 10, order: 'asc' as const, sort: undefined, search: undefined };

describe('EmployeesService.list scoping', () => {
  it('org-wide for employee.read holders', async () => {
    const { service, prisma } = makeService();
    await service.list(claims({ perms: ['employee.read'] }), query);
    const where = (prisma.employee.findMany as Mock).mock.calls[0][0].where;
    expect(where.managerId).toBeUndefined();
    expect(where.deletedAt).toBeNull();
  });

  it('direct reports only for employee.read.team holders', async () => {
    const { service, prisma } = makeService();
    await service.list(claims({ perms: ['employee.read.team'], employeeId: 'e-mgr' }), query);
    expect((prisma.employee.findMany as Mock).mock.calls[0][0].where.managerId).toBe('e-mgr');
  });

  it('matches nothing for a team-scoped caller without an employee record', async () => {
    const { service, prisma } = makeService();
    await service.list(claims({ perms: ['employee.read.team'] }), query);
    expect((prisma.employee.findMany as Mock).mock.calls[0][0].where.managerId).toBe('__none__');
  });
});

describe('EmployeesService.detail access', () => {
  const target = {
    id: 'e2',
    managerId: 'someone-else',
    bankDetail: { id: 'b1', accountNumber: '123456' },
  };

  it("rejects a manager viewing a non-report's record", async () => {
    const { service, prisma } = makeService();
    (prisma.employee.findFirst as Mock).mockResolvedValue(target);
    await expect(
      service.detail(claims({ perms: ['employee.read.team'], employeeId: 'e-mgr' }), 'e2'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('hides bank details from a team manager but shows the record', async () => {
    const { service, prisma } = makeService();
    (prisma.employee.findFirst as Mock).mockResolvedValue({ ...target, managerId: 'e-mgr' });
    const result = await service.detail(
      claims({ perms: ['employee.read.team'], employeeId: 'e-mgr' }),
      'e2',
    );
    expect(result.bankDetail).toBeUndefined();
  });

  it('shows bank details to full-read holders', async () => {
    const { service, prisma } = makeService();
    (prisma.employee.findFirst as Mock).mockResolvedValue(target);
    const result = await service.detail(claims({ perms: ['employee.read'] }), 'e2');
    expect(result.bankDetail).toEqual(target.bankDetail);
  });

  it('shows own record incl. bank without any list permission', async () => {
    const { service, prisma } = makeService();
    (prisma.employee.findFirst as Mock).mockResolvedValue(target);
    const result = await service.detail(claims({ perms: [], employeeId: 'e2' }), 'e2');
    expect(result.bankDetail).toEqual(target.bankDetail);
  });
});

describe('EmployeesService.update manager cycle', () => {
  it('rejects assigning a transitive report as manager', async () => {
    const { service, prisma } = makeService();
    (prisma.employee.findFirst as Mock).mockResolvedValue({ id: 'e1', userId: null });
    // chain: e3 → managed by e2 → managed by e1 (the employee being edited)
    (prisma.employee.findUnique as Mock)
      .mockResolvedValueOnce({ managerId: 'e2' })
      .mockResolvedValueOnce({ managerId: 'e1' });

    await expect(
      service.update(claims({ perms: ['employee.update'] }), 'e1', { managerId: 'e3' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('EmployeesService.softDelete', () => {
  it('suspends the linked user and revokes sessions', async () => {
    const { service, prisma } = makeService();
    (prisma.employee.findFirst as Mock).mockResolvedValue({ id: 'e1', userId: 'u9' });

    await service.softDelete(claims({ perms: ['employee.delete'] }), 'e1');
    expect(prisma.employee.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { deletedAt: expect.any(Date) } }),
    );
    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'u9' }, data: { status: 'SUSPENDED' } }),
    );
    expect(prisma.refreshSession.updateMany).toHaveBeenCalled();
  });
});

describe('EmployeesService.changeRole', () => {
  const admin = claims({ perms: ['role.manage'], sub: 'u-admin' });

  /** Two roles: ADMIN holds the floor, EMPLOYEE holds nothing. */
  const ROLES = [
    {
      id: 'r-admin',
      code: 'ADMIN',
      permissions: [
        { permission: { code: 'settings.manage' } },
        { permission: { code: 'role.manage' } },
      ],
    },
    { id: 'r-emp', code: 'EMPLOYEE', permissions: [] },
  ];

  /** How many *active* people hold each role, as the groupBy returns it. */
  const activeCounts = (admins: number, employees: number) => [
    { roleId: 'r-admin', _count: { _all: admins } },
    { roleId: 'r-emp', _count: { _all: employees } },
  ];

  function arrange(over: {
    employee?: Record<string, unknown>;
    target?: { id: string } | null;
    current?: { roleId: string; role: { code: string } };
    active?: ReturnType<typeof activeCounts>;
  }) {
    const made = makeService();
    (made.prisma.employee.findFirst as Mock).mockResolvedValue(
      over.employee ?? { id: 'e1', userId: 'u9' },
    );
    (made.prisma.role.findUnique as Mock).mockResolvedValue(
      over.target === undefined ? { id: 'r-emp' } : over.target,
    );
    (made.prisma.user.findUniqueOrThrow as Mock).mockResolvedValue(
      over.current ?? { roleId: 'r-admin', role: { code: 'ADMIN' } },
    );
    (made.prisma.role.findMany as Mock).mockResolvedValue(ROLES);
    (made.prisma.user.groupBy as Mock).mockResolvedValue(over.active ?? activeCounts(2, 0));
    (made.prisma.refreshSession.updateMany as Mock).mockResolvedValue({ count: 1 });
    return made;
  }

  it('promotes a login and audits the before/after codes', async () => {
    const { service, prisma } = arrange({
      target: { id: 'r-hr' },
      current: { roleId: 'r-emp', role: { code: 'EMPLOYEE' } },
      active: activeCounts(1, 1),
    });

    await expect(service.changeRole(admin, 'e1', 'HR')).resolves.toEqual({
      roleCode: 'HR',
      sessionsRevoked: 1,
    });
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'u9' },
      data: { roleId: 'r-hr' },
    });
    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'employee.role.change',
          meta: {
            before: { roleCode: 'EMPLOYEE' },
            after: { roleCode: 'HR' },
            sessionsRevoked: 1,
          },
        }),
      }),
    );
  });

  it('rejects an employee with no sign-in', async () => {
    const { service } = arrange({ employee: { id: 'e1', userId: null } });
    await expect(service.changeRole(admin, 'e1', 'HR')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('refuses to change your own role', async () => {
    const { service } = arrange({ employee: { id: 'e1', userId: 'u-admin' } });
    await expect(service.changeRole(admin, 'e1', 'EMPLOYEE')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('rejects a role code the organization does not have', async () => {
    const { service } = arrange({ target: null });
    await expect(service.changeRole(admin, 'e1', 'FINANCE')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('is a no-op when the role already matches', async () => {
    const { service, prisma } = arrange({
      target: { id: 'r-emp' },
      current: { roleId: 'r-emp', role: { code: 'EMPLOYEE' } },
    });
    await expect(service.changeRole(admin, 'e1', 'EMPLOYEE')).resolves.toEqual({
      roleCode: 'EMPLOYEE',
    });
    expect(prisma.user.update).not.toHaveBeenCalled();
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
  });

  it('refuses to demote the last person holding the admin floor', async () => {
    const { service, prisma } = arrange({ active: activeCounts(1, 0) });
    await expect(service.changeRole(admin, 'e1', 'EMPLOYEE')).rejects.toThrow(/lock everyone out/);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('allows the demotion once a second admin exists', async () => {
    const { service, prisma } = arrange({ active: activeCounts(2, 0) });
    await expect(service.changeRole(admin, 'e1', 'EMPLOYEE')).resolves.toEqual({
      roleCode: 'EMPLOYEE',
      sessionsRevoked: 1,
    });
    expect(prisma.user.update).toHaveBeenCalled();
  });
});

describe('EmployeesService.changeRole session and status handling', () => {
  const admin = claims({ perms: ['role.manage'], sub: 'u-admin' });

  function arrangeDemotion(active: { roleId: string; _count: { _all: number } }[]) {
    const made = makeService();
    (made.prisma.employee.findFirst as Mock).mockResolvedValue({ id: 'e1', userId: 'u9' });
    (made.prisma.role.findUnique as Mock).mockResolvedValue({ id: 'r-emp' });
    (made.prisma.user.findUniqueOrThrow as Mock).mockResolvedValue({
      roleId: 'r-admin',
      role: { code: 'ADMIN' },
    });
    (made.prisma.role.findMany as Mock).mockResolvedValue([
      {
        id: 'r-admin',
        code: 'ADMIN',
        permissions: [
          { permission: { code: 'settings.manage' } },
          { permission: { code: 'role.manage' } },
        ],
      },
      { id: 'r-emp', code: 'EMPLOYEE', permissions: [] },
    ]);
    (made.prisma.user.groupBy as Mock).mockResolvedValue(active);
    (made.prisma.refreshSession.updateMany as Mock).mockResolvedValue({ count: 3 });
    return made;
  }

  it('revokes the demoted login\u2019s refresh sessions so the change takes effect', async () => {
    const { service, prisma } = arrangeDemotion([
      { roleId: 'r-admin', _count: { _all: 2 } },
      { roleId: 'r-emp', _count: { _all: 0 } },
    ]);
    await service.changeRole(admin, 'e1', 'EMPLOYEE');
    expect(prisma.refreshSession.updateMany).toHaveBeenCalledWith({
      where: { userId: 'u9', revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
  });

  it('counts only ACTIVE users \u2014 a suspended admin is not a safety net', async () => {
    // One admin remains on paper, but they are SUSPENDED so groupBy omits them.
    const { service, prisma } = arrangeDemotion([{ roleId: 'r-emp', _count: { _all: 0 } }]);

    await expect(service.changeRole(admin, 'e1', 'EMPLOYEE')).rejects.toThrow(/lock everyone out/);
    expect(prisma.user.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ status: 'ACTIVE' }) }),
    );
    expect(prisma.user.update).not.toHaveBeenCalled();
  });
});

describe('EmployeesService.offboard', () => {
  const hr = claims({ sub: 'hr-user', roleCode: 'HR', perms: ['employee.offboard'] });
  const employee: {
    id: string;
    userId: string | null;
    status: string;
    joinDate: Date;
    exitDate: Date | null;
  } = {
    id: 'e1',
    userId: 'u-target',
    status: 'ACTIVE',
    joinDate: new Date('2024-01-15'),
    exitDate: null,
  };

  function arrange(over: Partial<typeof employee> = {}) {
    const { service, prisma } = makeService();
    (prisma.employee.findFirst as Mock).mockResolvedValue({ ...employee, ...over });
    (prisma.user.findUnique as Mock).mockResolvedValue({ role: { code: 'EMPLOYEE' } });
    return { service, prisma };
  }

  it('putting somebody on notice leaves their sign-in alone', async () => {
    const { service, prisma } = arrange();
    await service.offboard(hr, 'e1', { status: 'ON_NOTICE', exitDate: '2026-09-30', reason: null });

    // They still work the notice period: clock in, book leave, get paid.
    expect(prisma.user.update).not.toHaveBeenCalled();
    expect(prisma.refreshSession.updateMany).not.toHaveBeenCalled();
  });

  it('marking somebody exited suspends the login and revokes every session', async () => {
    const { service, prisma } = arrange();
    await service.offboard(hr, 'e1', { status: 'EXITED', exitDate: '2026-09-30', reason: null });

    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'SUSPENDED' } }),
    );
    expect(prisma.refreshSession.updateMany).toHaveBeenCalled();
  });

  it('never soft-deletes — a leaver’s payslips are last year’s accounts', async () => {
    const { service, prisma } = arrange();
    await service.offboard(hr, 'e1', { status: 'EXITED', exitDate: '2026-09-30', reason: null });

    const update = (prisma.employee.update as Mock).mock.calls[0][0];
    expect(update.data).not.toHaveProperty('deletedAt');
    expect(update.data.status).toBe('EXITED');
  });

  it('withdrawing a resignation clears the exit date', async () => {
    const { service, prisma } = arrange({ status: 'ON_NOTICE', exitDate: new Date('2026-09-30') });
    await service.offboard(hr, 'e1', { status: 'ACTIVE', exitDate: null, reason: null });

    const update = (prisma.employee.update as Mock).mock.calls[0][0];
    expect(update.data.exitDate).toBeNull();
  });

  it('reinstating only revives a SUSPENDED login, never an INVITED one', async () => {
    const { service, prisma } = arrange({ status: 'EXITED' });
    await service.offboard(hr, 'e1', { status: 'ACTIVE', exitDate: null, reason: null });

    // An INVITED account has never had a password set; flipping it to ACTIVE
    // would hand out a sign-in nobody can use but everybody can try.
    const call = (prisma.user.updateMany as Mock).mock.calls[0][0];
    expect(call.where).toMatchObject({ status: 'SUSPENDED' });
  });

  it('refuses an exit date before the join date', async () => {
    const { service } = arrange();
    await expect(
      service.offboard(hr, 'e1', { status: 'EXITED', exitDate: '2023-01-01', reason: null }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('refuses to offboard your own account', async () => {
    const { service } = arrange({ userId: 'hr-user' });
    await expect(
      service.offboard(hr, 'e1', { status: 'EXITED', exitDate: '2026-09-30', reason: null }),
    ).rejects.toThrow(/your own account/i);
  });

  it('refuses to exit the last active administrator', async () => {
    const { service, prisma } = arrange();
    (prisma.user.findUnique as Mock).mockResolvedValue({ role: { code: 'ADMIN' } });
    (prisma.user.count as Mock).mockResolvedValue(0);

    await expect(
      service.offboard(hr, 'e1', { status: 'EXITED', exitDate: '2026-09-30', reason: null }),
    ).rejects.toThrow(/only active administrator/i);
  });
});
