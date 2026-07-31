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
    user: { update: jest.fn() },
    refreshSession: { updateMany: jest.fn() },
    bankDetail: { upsert: jest.fn() },
    auditLog: { create: jest.fn() },
    $transaction: jest.fn(async (ops: unknown[]) => Promise.all(ops as Promise<unknown>[])),
  };
  // biome-ignore lint/suspicious/noExplicitAny: structural test double
  return { service: new EmployeesService(prisma as any), prisma };
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
