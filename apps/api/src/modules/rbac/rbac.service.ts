import { PERMISSIONS } from '@hrms/shared';
import type { AccessTokenClaims } from '@hrms/types';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { auditMutation } from '../../common/utils/audit';
import { PrismaService } from '../../database/prisma.service';
import { applyGuardrails, lockoutReason, type RoleGrants } from './rbac.guardrails';

@Injectable()
export class RbacService {
  constructor(private readonly prisma: PrismaService) {}

  /** Roles of the caller's organization, with their grants and user counts. */
  async roles(claims: AccessTokenClaims) {
    const roles = await this.prisma.role.findMany({
      where: { organizationId: claims.orgId },
      include: {
        permissions: { select: { permission: { select: { code: true } } } },
        _count: { select: { users: true } },
      },
      orderBy: { name: 'asc' },
    });

    const grants: RoleGrants[] = roles.map((role) => ({
      id: role.id,
      code: role.code,
      userCount: role._count.users,
      permissions: role.permissions.map((rp) => rp.permission.code).sort(),
    }));

    return roles.map((role, i) => {
      const mine = grants[i] as RoleGrants;
      return {
        id: role.id,
        code: role.code,
        name: role.name,
        description: role.description,
        isSystem: role.isSystem,
        userCount: role._count.users,
        permissions: mine.permissions,
        // Codes this role may not lose *given what every other role holds*,
        // so the matrix can disable exactly those cells.
        locked: mine.permissions.filter(
          (code) =>
            lockoutReason(
              grants,
              role.id,
              mine.permissions.filter((c) => c !== code),
            ) !== null,
        ),
      };
    });
  }

  /**
   * The catalog, grouped by resource for the matrix. Sourced from the shared
   * constant rather than the Permission table so a code that exists in the
   * catalog but was never seeded still appears (and can be granted).
   */
  permissions() {
    const groups = new Map<string, { code: string; action: string }[]>();
    for (const code of PERMISSIONS) {
      const [resource = code, ...rest] = code.split('.');
      const list = groups.get(resource) ?? [];
      list.push({ code, action: rest.join('.') || 'all' });
      groups.set(resource, list);
    }
    return [...groups.entries()].map(([resource, items]) => ({ resource, permissions: items }));
  }

  /**
   * Replaces a role's grants wholesale. Guardrail-protected codes are added
   * back rather than rejecting the edit, and the response says which — a
   * silent no-op would read as success.
   */
  async setPermissions(claims: AccessTokenClaims, roleId: string, next: string[]) {
    // The lockout rule spans every role in the organization — "is anyone left
    // who can administer this workspace" cannot be answered from one row.
    const all = await this.prisma.role.findMany({
      // Scoped by organization: a role id from another tenant must 404.
      where: { organizationId: claims.orgId },
      include: {
        permissions: { select: { permission: { select: { code: true } } } },
        _count: { select: { users: true } },
      },
    });
    const role = all.find((r) => r.id === roleId);
    if (!role) throw new NotFoundException('Role not found');

    const grants: RoleGrants[] = all.map((r) => ({
      id: r.id,
      code: r.code,
      userCount: r._count.users,
      permissions: r.permissions.map((rp) => rp.permission.code),
    }));

    const unknown = next.filter((code) => !PERMISSIONS.includes(code as never));
    if (unknown.length > 0) {
      throw new BadRequestException(`Unknown permission: ${unknown.join(', ')}`);
    }

    const current = role.permissions.map((rp) => rp.permission.code);
    const { permissions, blocked } = applyGuardrails(grants, roleId, next);

    // Only codes that exist as Permission rows can be granted, so compute the
    // effect from those — not from what was asked for. Reporting a grant that
    // was never written would be a lie in the response.
    const rows = await this.prisma.permission.findMany({
      where: { code: { in: permissions } },
      select: { id: true, code: true },
    });
    const persisted = rows.map((r) => r.code);
    const missing = permissions.filter((code) => !persisted.includes(code));

    const granted = persisted.filter((code) => !current.includes(code));
    const revoked = current.filter((code) => !persisted.includes(code));

    if (granted.length > 0 || revoked.length > 0) {
      await this.prisma.$transaction([
        this.prisma.rolePermission.deleteMany({ where: { roleId: role.id } }),
        this.prisma.rolePermission.createMany({
          data: rows.map((p) => ({ roleId: role.id, permissionId: p.id })),
          skipDuplicates: true,
        }),
      ]);
      await auditMutation(
        this.prisma,
        { orgId: claims.orgId, userId: claims.sub },
        'role.permissions.update',
        'Role',
        role.code,
      );
    }

    return {
      granted,
      revoked,
      blocked,
      permissions: persisted.sort(),
      // Catalog codes with no Permission row — the seed creates them all, so
      // this is only non-empty if the catalog moved ahead of the database.
      ...(missing.length > 0 ? { unavailable: missing } : {}),
    };
  }
}
