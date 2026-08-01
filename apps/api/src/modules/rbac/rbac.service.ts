import { PERMISSIONS } from '@hrms/shared';
import type { AccessTokenClaims } from '@hrms/types';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { auditMutation } from '../../common/utils/audit';
import { PrismaService } from '../../database/prisma.service';
import { applyGuardrails, revokeBlockedReason } from './rbac.guardrails';

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

    return roles.map((role) => ({
      id: role.id,
      code: role.code,
      name: role.name,
      description: role.description,
      isSystem: role.isSystem,
      userCount: role._count.users,
      permissions: role.permissions.map((rp) => rp.permission.code).sort(),
      /** Codes this role may not lose, so the UI can disable those cells. */
      locked: PERMISSIONS.filter((code) => revokeBlockedReason(role, code) !== null),
    }));
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
    const role = await this.prisma.role.findFirst({
      // Scoped by organization: a role id from another tenant must 404.
      where: { id: roleId, organizationId: claims.orgId },
      include: { permissions: { select: { permission: { select: { code: true } } } } },
    });
    if (!role) throw new NotFoundException('Role not found');

    const unknown = next.filter((code) => !PERMISSIONS.includes(code as never));
    if (unknown.length > 0) {
      throw new BadRequestException(`Unknown permission: ${unknown.join(', ')}`);
    }

    const current = role.permissions.map((rp) => rp.permission.code);
    const { permissions, blocked } = applyGuardrails(role, current, next);

    const granted = permissions.filter((code) => !current.includes(code));
    const revoked = current.filter((code) => !permissions.includes(code));

    if (granted.length > 0 || revoked.length > 0) {
      const rows = await this.prisma.permission.findMany({
        where: { code: { in: permissions } },
        select: { id: true, code: true },
      });
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

    return { granted, revoked, blocked, permissions };
  }
}
