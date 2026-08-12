import { PERMISSIONS } from '@hrms/shared';
import type { AccessTokenClaims } from '@hrms/types';
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { auditMutation } from '../../common/utils/audit';
import { PrismaService } from '../../database/prisma.service';
import { applyGuardrails, lockoutReason, type RoleGrants } from './rbac.guardrails';

@Injectable()
export class RbacService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Every role in the organization, plus how many people *who can still sign
   * in* hold each one.
   *
   * The count is a separate `groupBy` rather than `_count: { users: true }`
   * because that shape includes SUSPENDED logins, and softDelete suspends a
   * user while leaving its roleId intact. The floor in `lockoutReason` is
   * keyed on "is at least one person still holding this" — an offboarded admin
   * nobody can log in as must not answer yes. `EmployeesService.changeRole`
   * documents the same trap for the membership side.
   */
  private async orgRoles(orgId: string) {
    const [roles, active] = await Promise.all([
      this.prisma.role.findMany({
        where: { organizationId: orgId },
        include: {
          permissions: { select: { permission: { select: { code: true } } } },
          _count: { select: { users: true } },
        },
        orderBy: { name: 'asc' },
      }),
      this.prisma.user.groupBy({
        by: ['roleId'],
        where: { organizationId: orgId, status: 'ACTIVE' },
        _count: { _all: true },
      }),
    ]);
    const activeByRole = new Map(active.map((row) => [row.roleId, row._count._all]));
    const grants: RoleGrants[] = roles.map((role) => ({
      id: role.id,
      code: role.code,
      userCount: activeByRole.get(role.id) ?? 0,
      permissions: role.permissions.map((rp) => rp.permission.code).sort(),
    }));
    return { roles, grants };
  }

  /** Roles of the caller's organization, with their grants and user counts. */
  async roles(claims: AccessTokenClaims) {
    const { roles, grants } = await this.orgRoles(claims.orgId);

    return roles.map((role, i) => {
      const mine = grants[i] as RoleGrants;
      return {
        id: role.id,
        code: role.code,
        name: role.name,
        description: role.description,
        isSystem: role.isSystem,
        // Everybody attached to the role, suspended logins included — the
        // matrix is showing who holds it. The floor below deliberately counts
        // a smaller set: only people who can still sign in.
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
    // Scoped by organization: a role id from another tenant must 404.
    const { roles: all, grants } = await this.orgRoles(claims.orgId);
    const role = all.find((r) => r.id === roleId);
    if (!role) throw new NotFoundException('Role not found');

    /*
     * Editing the role you are sitting in is the same shape `changeRole`
     * refuses on the membership side (employees.service.ts): self-service here
     * is either an escalation or a lockout. The ceiling below stops the
     * escalation from succeeding, but the attempt should not be dressed up as
     * a normal edit — rewriting the grants that authorise you is never the
     * legitimate use. Codes are unique per organization, so the role code in
     * the token identifies the caller's row exactly.
     */
    if (role.code === claims.roleCode) {
      throw new ForbiddenException(
        "You cannot change your own role's permissions — ask another administrator",
      );
    }

    const unknown = next.filter((code) => !PERMISSIONS.includes(code as never));
    if (unknown.length > 0) {
      throw new BadRequestException(`Unknown permission: ${unknown.join(', ')}`);
    }

    const current = role.permissions.map((rp) => rp.permission.code);

    /*
     * The escalation ceiling: nobody may hand out what they do not hold. Any
     * `role.manage` holder who is not an Admin could otherwise write the whole
     * catalogue onto a role and pick up everything the workspace has.
     *
     * Additions only, and that asymmetry is deliberate: this rule exists to
     * stop escalation, not sabotage. Gating *removals* on what the caller
     * holds would block ordinary de-escalation and risk lockouts, which the
     * admin floor already handles — and handles differently, by restoring the
     * permission rather than refusing the edit.
     *
     * Checked against `next` *before* applyGuardrails runs, which is what
     * keeps that restoration legal: the floor codes it re-adds are the system
     * undoing a lockout, not a grant this caller asked for, so a caller who
     * lacks `settings.manage` can still edit a role that must keep it.
     */
    const escalating = [
      ...new Set(next.filter((code) => !current.includes(code) && !claims.perms.includes(code))),
    ].sort();
    if (escalating.length > 0) {
      throw new ForbiddenException(
        `You cannot grant a permission you do not hold yourself: ${escalating.join(', ')}`,
      );
    }

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

    let sessionsRevoked = 0;
    if (granted.length > 0 || revoked.length > 0) {
      const [, , sessions] = await this.prisma.$transaction([
        this.prisma.rolePermission.deleteMany({ where: { roleId: role.id } }),
        this.prisma.rolePermission.createMany({
          data: rows.map((p) => ({ roleId: role.id, permissionId: p.id })),
          skipDuplicates: true,
        }),
        /*
         * Revoking every holder's refresh sessions is the *de-escalation* half
         * of this working, which is the opposite of the intuitive reading.
         * `perms` is baked into a 15-minute access token, so a permission
         * removed here keeps working on an already-issued token until it
         * expires; this caps that window and forces the next refresh to read
         * the new grants. The additions merely arrive sooner, which is
         * harmless — a grant taking effect early is what was asked for.
         * Same move as `EmployeesService.changeRole`.
         */
        this.prisma.refreshSession.updateMany({
          where: { user: { roleId: role.id }, revokedAt: null },
          data: { revokedAt: new Date() },
        }),
      ]);
      sessionsRevoked = sessions.count;
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
      sessionsRevoked,
      permissions: persisted.sort(),
      // Catalog codes with no Permission row — the seed creates them all, so
      // this is only non-empty if the catalog moved ahead of the database.
      ...(missing.length > 0 ? { unavailable: missing } : {}),
    };
  }
}
