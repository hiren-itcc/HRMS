import { PERMISSIONS } from '@hrms/shared';
import type { AccessTokenClaims } from '@hrms/types';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { RbacService } from './rbac.service';

interface RoleRow {
  id: string;
  code: string;
  isSystem: boolean;
  /** Every attached user, suspended included — what the FK restricts on. */
  users: number;
}

const ORG: RoleRow[] = [
  { id: 'admin', code: 'ADMIN', isSystem: true, users: 1 },
  { id: 'ops', code: 'OPS', isSystem: false, users: 0 },
  { id: 'field', code: 'FIELD', isSystem: false, users: 2 },
];

function makeService(rows: RoleRow[] = ORG) {
  const find = (where: { id?: string; organizationId?: string; code?: string }) => {
    if (where.organizationId && where.organizationId !== 'org1') return null;
    const row = rows.find((r) => (where.id ? r.id === where.id : r.code === where.code));
    return row ?? null;
  };

  const prisma = {
    role: {
      findFirst: jest.fn(async ({ where }: { where: Record<string, string> }) => {
        const row = find(where);
        return row && { ...row, _count: { users: row.users } };
      }),
      findUnique: jest.fn(async ({ where }: { where: Record<string, Record<string, string>> }) => {
        const key = where.organizationId_code;
        return find({ organizationId: key?.organizationId, code: key?.code });
      }),
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({
        id: 'new',
        code: data.code,
        name: data.name,
        description: data.description,
        isSystem: data.isSystem,
      })),
      update: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({
        id: 'ops',
        code: 'OPS',
        name: data.name ?? 'Ops',
        description: data.description ?? null,
        isSystem: false,
      })),
      delete: jest.fn(),
    },
    permission: {
      findMany: jest.fn(async (args: { where: { code: { in: string[] } } }) =>
        args.where.code.in.map((code) => ({ id: `perm-${code}`, code })),
      ),
    },
    rolePermission: { deleteMany: jest.fn() },
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

/** A `role.manage` holder who is not an Admin — the case the ceiling exists for. */
const roleManager = claims({ perms: ['role.manage', 'leave.manage'] });
const admin = claims({ roleCode: 'ADMIN', perms: [...PERMISSIONS] });

describe('RbacService.createRole', () => {
  it('composes a custom role', async () => {
    const { service } = makeService();
    const role = await service.createRole(roleManager, {
      code: 'IT_ADMIN',
      name: 'IT Admin',
      description: null,
      permissions: ['leave.manage'],
    });
    expect(role.code).toBe('IT_ADMIN');
    expect(role.permissions).toEqual(['leave.manage']);
    expect(role.userCount).toBe(0);
  });

  it('never marks a composed role as a system role', async () => {
    const { service, prisma } = makeService();
    await service.createRole(roleManager, {
      code: 'IT_ADMIN',
      name: 'IT Admin',
      description: null,
      permissions: [],
    });
    expect(prisma.role.create.mock.calls[0][0].data.isSystem).toBe(false);
  });

  it('refuses to seed a role with a permission the caller does not hold', async () => {
    // The ceiling's back door: mint the role, then move somebody into it.
    const { service, prisma } = makeService();
    await expect(
      service.createRole(roleManager, {
        code: 'IT_ADMIN',
        name: 'IT Admin',
        description: null,
        permissions: ['payroll.pay'],
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.role.create).not.toHaveBeenCalled();
  });

  it('names the permission it refused', async () => {
    const { service } = makeService();
    await expect(
      service.createRole(roleManager, {
        code: 'IT_ADMIN',
        name: 'IT Admin',
        description: null,
        permissions: ['payroll.pay'],
      }),
    ).rejects.toThrow(/payroll\.pay/);
  });

  it('leaves an Admin unaffected — the whole catalog still composes', async () => {
    const { service } = makeService();
    const role = await service.createRole(admin, {
      code: 'IT_ADMIN',
      name: 'IT Admin',
      description: null,
      permissions: [...PERMISSIONS],
    });
    expect(role.permissions).toEqual([...new Set<string>(PERMISSIONS)].sort());
  });

  it('refuses a code that already exists in this organization', async () => {
    const { service } = makeService();
    await expect(
      service.createRole(admin, { code: 'OPS', name: 'Ops', description: null, permissions: [] }),
    ).rejects.toThrow(/already exists/);
  });

  it('rejects an unknown permission with 400, not 403', async () => {
    const { service } = makeService();
    await expect(
      service.createRole(admin, {
        code: 'IT_ADMIN',
        name: 'IT',
        description: null,
        permissions: ['not.a.permission'],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('RbacService.updateRole', () => {
  it('renames a custom role', async () => {
    const { service } = makeService();
    const role = await service.updateRole(admin, 'ops', { name: 'Operations' });
    expect(role.name).toBe('Operations');
  });

  it('refuses to rename a system role', async () => {
    // `editBlockedReason` had no production caller until this route existed.
    const { service, prisma } = makeService();
    await expect(service.updateRole(admin, 'admin', { name: 'Superuser' })).rejects.toThrow(
      /System roles cannot be renamed/,
    );
    expect(prisma.role.update).not.toHaveBeenCalled();
  });

  it('404s for a role outside the organization', async () => {
    const { service } = makeService();
    await expect(
      service.updateRole(claims({ orgId: 'other', perms: ['role.manage'] }), 'ops', { name: 'X' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('RbacService.deleteRole', () => {
  it('deletes a custom role nobody holds', async () => {
    const { service, prisma } = makeService();
    await service.deleteRole(admin, 'ops');
    expect(prisma.rolePermission.deleteMany).toHaveBeenCalled();
    expect(prisma.role.delete).toHaveBeenCalled();
  });

  it('refuses to delete a system role', async () => {
    const { service, prisma } = makeService();
    await expect(service.deleteRole(admin, 'admin')).rejects.toThrow(/System roles/);
    expect(prisma.role.delete).not.toHaveBeenCalled();
  });

  it('refuses while anybody still holds it, and says how many', async () => {
    const { service } = makeService();
    await expect(service.deleteRole(admin, 'field')).rejects.toThrow(/2 people still hold/);
  });

  it('counts a suspended holder too — the foreign key does not care', async () => {
    // The opposite of the admin-floor rule, which counts ACTIVE users only.
    const { service } = makeService([{ id: 'ops', code: 'OPS', isSystem: false, users: 1 }]);
    await expect(service.deleteRole(admin, 'ops')).rejects.toThrow(/1 person still holds/);
  });

  it('404s for a role outside the organization', async () => {
    const { service } = makeService();
    await expect(
      service.deleteRole(claims({ orgId: 'other', perms: ['role.manage'] }), 'ops'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
