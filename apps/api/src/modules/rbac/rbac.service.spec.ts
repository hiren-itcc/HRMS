import { PERMISSIONS } from '@hrms/shared';
import type { AccessTokenClaims } from '@hrms/types';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { RbacService } from './rbac.service';

type Mock = jest.Mock;

const FLOOR = ['settings.manage', 'role.manage'];

interface RoleFixture {
  id: string;
  code: string;
  permissions: string[];
  /** Everybody attached to the role — what `_count: { users: true }` returns. */
  users: number;
  /** Of those, the ones who can still sign in. Defaults to `users`. */
  active?: number;
}

const ORG: RoleFixture[] = [
  { id: 'admin', code: 'ADMIN', permissions: [...PERMISSIONS], users: 1 },
  { id: 'hr', code: 'HR', permissions: ['leave.manage', 'report.view', 'role.manage'], users: 2 },
  { id: 'emp', code: 'EMPLOYEE', permissions: ['leave.read.own'], users: 8 },
];

function makeService(fixtures: RoleFixture[] = ORG) {
  const prisma = {
    role: {
      findMany: jest.fn(async () =>
        fixtures.map((r) => ({
          id: r.id,
          code: r.code,
          name: r.code,
          description: null,
          isSystem: true,
          permissions: r.permissions.map((code) => ({ permission: { code } })),
          _count: { users: r.users },
        })),
      ),
    },
    user: {
      groupBy: jest.fn(async () =>
        fixtures
          .map((r) => ({ roleId: r.id, _count: { _all: r.active ?? r.users } }))
          .filter((row) => row._count._all > 0),
      ),
    },
    permission: {
      // Every catalog code has a row, which is what the seed produces.
      findMany: jest.fn(async (args: { where: { code: { in: string[] } } }) =>
        args.where.code.in.map((code) => ({ id: `perm-${code}`, code })),
      ),
    },
    rolePermission: { deleteMany: jest.fn(), createMany: jest.fn() },
    refreshSession: { updateMany: jest.fn().mockResolvedValue({ count: 3 }) },
    auditLog: { create: jest.fn() },
    $transaction: jest.fn(async (ops: unknown[]) => Promise.all(ops as Promise<unknown>[])),
  };
  // biome-ignore lint/suspicious/noExplicitAny: structural test double
  const service = new RbacService(prisma as any);
  return { service, prisma };
}

const claims = (over: Partial<AccessTokenClaims>): AccessTokenClaims => ({
  sub: 'u1',
  orgId: 'org1',
  roleCode: 'HR',
  perms: [],
  ...over,
});

/** A `role.manage` holder who is not an Admin — the whole point of the ceiling. */
const roleManager = claims({
  roleCode: 'HR',
  perms: ['leave.manage', 'report.view', 'role.manage'],
});

/** The default configuration: Admin holds the entire catalog. */
const admin = claims({ sub: 'u-admin', roleCode: 'ADMIN', perms: [...PERMISSIONS] });

describe('RbacService.setPermissions escalation ceiling', () => {
  it('refuses to add a permission the caller does not hold', async () => {
    const { service } = makeService();
    await expect(
      service.setPermissions(roleManager, 'emp', ['leave.read.own', 'payroll.pay']),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('names the permission it refused', async () => {
    const { service } = makeService();
    await expect(
      service.setPermissions(roleManager, 'emp', ['leave.read.own', 'payroll.pay', 'audit.read']),
    ).rejects.toThrow(/audit\.read, payroll\.pay/);
  });

  it('writes nothing when it refuses', async () => {
    const { service, prisma } = makeService();
    await expect(service.setPermissions(roleManager, 'emp', ['audit.read'])).rejects.toThrow();
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
  });

  it('allows adding a permission the caller does hold', async () => {
    const { service } = makeService();
    const result = await service.setPermissions(roleManager, 'emp', [
      'leave.read.own',
      'report.view',
    ]);
    expect(result.granted).toEqual(['report.view']);
  });

  it('allows removals unrestricted — the ceiling is about escalation, not sabotage', async () => {
    const { service } = makeService();
    // `leave.read.own` is not among the caller's own grants, and taking it away
    // is still allowed — only additions are gated.
    const result = await service.setPermissions(roleManager, 'emp', []);
    expect(result.revoked).toEqual(['leave.read.own']);
    expect(result.permissions).toEqual([]);
  });

  it('lets the caller strip a permission they do not hold themselves', async () => {
    const { service } = makeService([
      ...ORG,
      { id: 'fin', code: 'FINANCE', permissions: ['payroll.pay', 'payroll.approve'], users: 1 },
    ]);
    const result = await service.setPermissions(roleManager, 'fin', ['payroll.approve']);
    expect(result.revoked).toEqual(['payroll.pay']);
    expect(result.granted).toEqual([]);
  });

  it('leaves an Admin unaffected — every grant in the catalog still succeeds', async () => {
    // The default configuration: `role.manage` reaches only Admin, and an
    // Admin holds everything, so the ceiling can never bite. This is the
    // regression test for "default behaviour unchanged".
    const { service } = makeService();
    const result = await service.setPermissions(admin, 'emp', [...PERMISSIONS]);
    expect(result.granted).toEqual(
      [...new Set<string>(PERMISSIONS)].filter((code) => code !== 'leave.read.own').sort(),
    );
    expect(result.revoked).toEqual([]);
  });

  it('still rejects an unknown code with 400, not 403', async () => {
    const { service } = makeService();
    await expect(service.setPermissions(admin, 'emp', ['not.a.permission'])).rejects.toThrow(
      /Unknown permission/,
    );
  });
});

describe('RbacService.setPermissions self-edit', () => {
  it("refuses to edit the caller's own role", async () => {
    const { service } = makeService();
    await expect(service.setPermissions(roleManager, 'hr', [...FLOOR])).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('says to ask another administrator', async () => {
    const { service } = makeService();
    await expect(service.setPermissions(admin, 'admin', [...PERMISSIONS])).rejects.toThrow(
      /another administrator/,
    );
  });

  it('allows editing a different role', async () => {
    const { service } = makeService();
    await expect(
      service.setPermissions(roleManager, 'emp', ['leave.read.own', 'report.view']),
    ).resolves.toBeDefined();
  });

  it('keeps 404-not-403 for a role id outside the organization', async () => {
    const { service } = makeService();
    await expect(service.setPermissions(roleManager, 'other-tenant', [])).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

describe('RbacService.setPermissions floor restoration order', () => {
  it('restores an admin-floor permission the caller does not hold', async () => {
    // ADMIN is the only staffed holder of `settings.manage`; the caller sits on
    // HR and does not hold it. Stripping ADMIN must still restore it — that
    // restoration is the system undoing a lockout, not a grant by this caller,
    // so the ceiling must not refuse the edit.
    const { service } = makeService([
      { id: 'admin', code: 'ADMIN', permissions: [...FLOOR, 'report.export'], users: 1 },
      { id: 'hr', code: 'HR', permissions: ['leave.manage', 'role.manage'], users: 2 },
    ]);
    const caller = claims({ roleCode: 'HR', perms: ['leave.manage', 'role.manage'] });
    const result = await service.setPermissions(caller, 'admin', []);
    expect(result.blocked).toEqual(['settings.manage']);
    expect(result.permissions).toEqual(['settings.manage']);
    expect(result.revoked.sort()).toEqual(['report.export', 'role.manage']);
  });
});

describe('RbacService.setPermissions session revocation', () => {
  it('revokes the live sessions of everyone holding the edited role', async () => {
    const { service, prisma } = makeService();
    const result = await service.setPermissions(roleManager, 'emp', []);
    expect(prisma.refreshSession.updateMany).toHaveBeenCalledWith({
      where: { user: { roleId: 'emp' }, revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
    expect(result.sessionsRevoked).toBe(3);
  });

  it('revokes in the same transaction as the grant rewrite', async () => {
    const { service, prisma } = makeService();
    await service.setPermissions(roleManager, 'emp', []);
    expect((prisma.$transaction as Mock).mock.calls[0][0]).toHaveLength(3);
  });

  it('leaves sessions alone when the edit changes nothing', async () => {
    const { service, prisma } = makeService();
    const result = await service.setPermissions(roleManager, 'emp', ['leave.read.own']);
    expect(prisma.refreshSession.updateMany).not.toHaveBeenCalled();
    expect(result.sessionsRevoked).toBe(0);
  });
});

describe('RbacService admin floor counts only active users', () => {
  // ADMIN holds the floor but its one login is SUSPENDED, so HR is the only
  // staffed holder and may not drop it. With `_count: { users: true }` the
  // suspended account satisfies the floor and the edit goes through.
  const suspendedAdmin: RoleFixture[] = [
    { id: 'admin', code: 'ADMIN', permissions: [...FLOOR], users: 1, active: 0 },
    { id: 'hr', code: 'HR', permissions: [...FLOOR, 'leave.manage'], users: 2 },
  ];

  it('does not let a suspended admin satisfy the floor', async () => {
    const { service } = makeService(suspendedAdmin);
    const result = await service.setPermissions(admin, 'hr', ['leave.manage']);
    expect(result.blocked.sort()).toEqual([...FLOOR].sort());
    expect(result.permissions).toEqual(['leave.manage', 'role.manage', 'settings.manage']);
  });

  it('locks the matrix cells on the same reading', async () => {
    const { service } = makeService(suspendedAdmin);
    const rows = await service.roles(claims({ roleCode: 'ADMIN' }));
    const hr = rows.find((r) => r.id === 'hr');
    expect(hr?.locked.sort()).toEqual([...FLOOR].sort());
    // The displayed count is still everybody attached to the role.
    expect(hr?.userCount).toBe(2);
    expect(rows.find((r) => r.id === 'admin')?.userCount).toBe(1);
  });

  it('counts only ACTIVE users when asking the database', async () => {
    const { service, prisma } = makeService();
    await service.roles(claims({ roleCode: 'ADMIN' }));
    expect((prisma.user.groupBy as Mock).mock.calls[0][0].where).toEqual({
      organizationId: 'org1',
      status: 'ACTIVE',
    });
  });
});
