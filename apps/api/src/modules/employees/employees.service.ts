import type {
  BankDetailInput,
  EmployeeCreateInput,
  EmployeeQuery,
  EmployeeUpdateInput,
  RoleCodeInput,
  SelfProfileUpdateInput,
} from '@hrms/shared';
import type { AccessTokenClaims } from '@hrms/types';
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as argon2 from 'argon2';
import { auditMutation } from '../../common/utils/audit';
import { buildListArgs, searchWhere, toPaginated } from '../../common/utils/list-query';
import { PrismaService } from '../../database/prisma.service';
import type { Prisma } from '../../generated/prisma/client';
import { roleMoveLockoutReason } from '../rbac/rbac.guardrails';

const SORTABLE = ['firstName', 'employeeCode', 'joinDate', 'status'] as const;

const LIST_INCLUDE = {
  department: { select: { id: true, name: true } },
  designation: { select: { id: true, title: true } },
  location: { select: { id: true, name: true } },
} as const;

const DETAIL_INCLUDE = {
  ...LIST_INCLUDE,
  shift: { select: { id: true, name: true } },
  employmentType: { select: { id: true, name: true } },
  manager: { select: { id: true, firstName: true, lastName: true, employeeCode: true } },
  reports: {
    where: { deletedAt: null },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      employeeCode: true,
      designation: { select: { title: true } },
    },
  },
  user: {
    select: { id: true, email: true, status: true, role: { select: { id: true, code: true } } },
  },
} as const;

type Ctx = { orgId: string; userId: string; employeeId?: string; perms: Set<string> };

function ctxOf(claims: AccessTokenClaims): Ctx {
  return {
    orgId: claims.orgId,
    userId: claims.sub,
    employeeId: claims.employeeId,
    perms: new Set(claims.perms),
  };
}

@Injectable()
export class EmployeesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Scope resolution (docs/04-rbac.md): `employee.read` → whole org;
   * otherwise `employee.read.team` → caller's direct reports only.
   * Soft-deleted employees never appear.
   */
  async list(claims: AccessTokenClaims, query: EmployeeQuery) {
    const ctx = ctxOf(claims);
    const where: Prisma.EmployeeWhereInput = {
      organizationId: ctx.orgId,
      deletedAt: null,
      ...this.scopeFilter(ctx),
      ...(query.departmentId ? { departmentId: query.departmentId } : {}),
      ...(query.designationId ? { designationId: query.designationId } : {}),
      ...(query.locationId ? { locationId: query.locationId } : {}),
      ...(query.employmentTypeId ? { employmentTypeId: query.employmentTypeId } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...searchWhere(query.search, ['firstName', 'lastName', 'workEmail', 'employeeCode']),
    };
    const [data, total] = await this.prisma.$transaction([
      this.prisma.employee.findMany({
        where,
        include: LIST_INCLUDE,
        ...buildListArgs(query, SORTABLE, 'firstName'),
      }),
      this.prisma.employee.count({ where }),
    ]);
    return toPaginated(data, total, query);
  }

  /** Flat list for manager pickers — org-wide, needs full read. */
  options(orgId: string) {
    return this.prisma.employee.findMany({
      where: { organizationId: orgId, deletedAt: null },
      select: { id: true, firstName: true, lastName: true, employeeCode: true },
      orderBy: { firstName: 'asc' },
    });
  }

  async detail(claims: AccessTokenClaims, id: string) {
    const ctx = ctxOf(claims);
    const employee = await this.prisma.employee.findFirst({
      where: { id, organizationId: ctx.orgId, deletedAt: null },
      include: { ...DETAIL_INCLUDE, bankDetail: true },
    });
    if (!employee) throw new NotFoundException('Employee not found');

    const isSelf = ctx.employeeId === id;
    const isTeam = employee.managerId != null && employee.managerId === ctx.employeeId;
    if (
      !isSelf &&
      !ctx.perms.has('employee.read') &&
      !(ctx.perms.has('employee.read.team') && isTeam)
    ) {
      throw new ForbiddenException('You cannot view this employee');
    }

    // Bank details are sensitive: full-read holders (HR/Admin) and self only
    const { bankDetail, ...rest } = employee;
    const canSeeBank = isSelf || ctx.perms.has('employee.read');
    return { ...rest, bankDetail: canSeeBank ? bankDetail : undefined };
  }

  async create(claims: AccessTokenClaims, input: EmployeeCreateInput) {
    const ctx = ctxOf(claims);
    await this.validateRefs(ctx.orgId, input);

    const { joinDate, dateOfBirth, employeeCode, createLogin, loginRole, ...rest } = input;

    if (createLogin) {
      const taken = await this.prisma.user.findUnique({
        where: { email: rest.workEmail },
        select: { id: true },
      });
      if (taken) {
        throw new BadRequestException(
          `${rest.workEmail} already has a sign-in — use a different work email, or create the employee without a login`,
        );
      }
      if (!new Set(claims.perms).has('employee.invite')) {
        throw new ForbiddenException('You need employee.invite to create a sign-in');
      }
    }

    for (let attempt = 0; ; attempt++) {
      const code = employeeCode ?? (await this.nextCode(ctx.orgId, attempt));
      try {
        /*
         * Employee and login are created together. Half of this succeeding is
         * the bug being fixed: an employee row nobody can sign in as.
         */
        const employee = await this.prisma.$transaction(async (tx) => {
          const created = await tx.employee.create({
            data: {
              ...rest,
              employeeCode: code,
              joinDate: new Date(joinDate),
              dateOfBirth: dateOfBirth ? new Date(dateOfBirth) : null,
              organizationId: ctx.orgId,
            },
            include: LIST_INCLUDE,
          });

          if (createLogin) {
            const role = await tx.role.findUnique({
              where: { organizationId_code: { organizationId: ctx.orgId, code: loginRole } },
              select: { id: true },
            });
            if (!role) throw new BadRequestException(`Role ${loginRole} does not exist`);

            const user = await tx.user.create({
              data: {
                organizationId: ctx.orgId,
                email: created.workEmail,
                passwordHash: await argon2.hash(this.defaultPassword(), {
                  type: argon2.argon2id,
                }),
                status: 'ACTIVE',
                // The default password is shared and therefore guessable. The
                // flag is what keeps that from mattering: they can sign in and
                // do nothing else until they set their own.
                mustChangePassword: true,
                roleId: role.id,
              },
            });
            await tx.employee.update({ where: { id: created.id }, data: { userId: user.id } });
          }
          return created;
        });

        await auditMutation(this.prisma, ctx, 'employee.create', 'Employee', employee.id, {
          after: { employeeCode: employee.employeeCode, createdLogin: createLogin, loginRole },
        });
        return {
          ...employee,
          loginCreated: createLogin,
          loginEmail: createLogin ? employee.workEmail : null,
        };
      } catch (err) {
        // Unique collision on an auto-generated code → try the next one
        if (employeeCode || attempt >= 4 || !this.isUniqueViolation(err)) throw err;
      }
    }
  }

  private defaultPassword(): string {
    return this.config.get<string>('DEFAULT_USER_PASSWORD') ?? 'Welcome@2026';
  }

  async update(claims: AccessTokenClaims, id: string, input: EmployeeUpdateInput) {
    const ctx = ctxOf(claims);
    await this.ensureExists(ctx.orgId, id);
    await this.validateRefs(ctx.orgId, input);
    if (input.managerId) {
      if (input.managerId === id)
        throw new BadRequestException('An employee cannot be their own manager');
      await this.ensureNoManagerCycle(id, input.managerId);
    }

    const { joinDate, dateOfBirth, ...rest } = input;
    const employee = await this.prisma.employee.update({
      where: { id },
      data: {
        ...rest,
        ...(joinDate ? { joinDate: new Date(joinDate) } : {}),
        ...(dateOfBirth ? { dateOfBirth: new Date(dateOfBirth) } : {}),
      },
      include: LIST_INCLUDE,
    });
    await auditMutation(this.prisma, ctx, 'employee.update', 'Employee', id);
    return employee;
  }

  /**
   * Change the role on an employee's login (docs/04-rbac.md: a role attaches to
   * the User, so an employee without a sign-in has nothing to change).
   *
   * Its own action behind `role.manage` rather than a field on the employee
   * update, so that granting somebody Admin is deliberate and separately
   * audited instead of riding along with an address correction.
   */
  async changeRole(claims: AccessTokenClaims, id: string, roleCode: RoleCodeInput) {
    const ctx = ctxOf(claims);
    const employee = await this.ensureExists(ctx.orgId, id);

    if (!employee.userId) {
      throw new BadRequestException(
        'This employee has no sign-in, so there is no role to change. Create one first.',
      );
    }
    /*
     * Self-service here is either an escalation or a lockout: nothing stops an
     * admin granting themselves Admin (they have it), so every real use is one
     * of the two. Changing someone else's role is the only legitimate shape.
     */
    if (employee.userId === ctx.userId) {
      throw new ForbiddenException('You cannot change your own role — ask another administrator');
    }

    const target = await this.prisma.role.findUnique({
      where: { organizationId_code: { organizationId: ctx.orgId, code: roleCode } },
      select: { id: true },
    });
    if (!target) throw new BadRequestException(`Role ${roleCode} does not exist`);

    const current = await this.prisma.user.findUniqueOrThrow({
      where: { id: employee.userId },
      select: { roleId: true, role: { select: { code: true } } },
    });
    if (current.roleId === target.id) return { roleCode };

    /*
     * Counted per role over ACTIVE users only. `_count: { users: true }` — the
     * shape rbac.service uses — includes SUSPENDED ones, and softDelete
     * suspends a login while leaving its roleId intact. That would let an
     * offboarded admin who cannot sign in satisfy the floor below.
     */
    const [roles, active] = await Promise.all([
      this.prisma.role.findMany({
        where: { organizationId: ctx.orgId },
        select: {
          id: true,
          code: true,
          permissions: { select: { permission: { select: { code: true } } } },
        },
      }),
      this.prisma.user.groupBy({
        by: ['roleId'],
        where: { organizationId: ctx.orgId, status: 'ACTIVE' },
        _count: { _all: true },
      }),
    ]);
    const activeByRole = new Map(active.map((row) => [row.roleId, row._count._all]));
    const blocked = roleMoveLockoutReason(
      roles.map((role) => ({
        id: role.id,
        code: role.code,
        userCount: activeByRole.get(role.id) ?? 0,
        permissions: role.permissions.map((p) => p.permission.code),
      })),
      current.roleId,
      target.id,
    );
    if (blocked) throw new BadRequestException(blocked);

    /*
     * Revoking refresh sessions is the demotion half of this working. The
     * access token carries `perms` and lives 15 minutes, so without this a
     * demoted admin keeps admin rights until it expires. This cannot kill the
     * token already in flight — it caps the exposure and forces the next
     * refresh to read the new role. Same move as softDelete.
     */
    const [, revoked] = await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: employee.userId }, data: { roleId: target.id } }),
      this.prisma.refreshSession.updateMany({
        where: { userId: employee.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);
    await auditMutation(this.prisma, ctx, 'employee.role.change', 'Employee', id, {
      before: { roleCode: current.role.code },
      after: { roleCode },
      sessionsRevoked: revoked.count,
    });
    return { roleCode, sessionsRevoked: revoked.count };
  }

  /**
   * Soft delete (docs/02 §schema-principles): the row keeps history for
   * attendance/leave/audit. A linked login is suspended and its sessions
   * revoked in the same transaction.
   */
  async softDelete(claims: AccessTokenClaims, id: string) {
    const ctx = ctxOf(claims);
    const employee = await this.ensureExists(ctx.orgId, id);
    await this.prisma.$transaction([
      this.prisma.employee.update({ where: { id }, data: { deletedAt: new Date() } }),
      ...(employee.userId
        ? [
            this.prisma.user.update({
              where: { id: employee.userId },
              data: { status: 'SUSPENDED' },
            }),
            this.prisma.refreshSession.updateMany({
              where: { userId: employee.userId, revokedAt: null },
              data: { revokedAt: new Date() },
            }),
          ]
        : []),
    ]);
    await auditMutation(this.prisma, ctx, 'employee.delete', 'Employee', id);
  }

  async upsertBank(claims: AccessTokenClaims, id: string, input: BankDetailInput) {
    const ctx = ctxOf(claims);
    await this.ensureExists(ctx.orgId, id);
    const bank = await this.prisma.bankDetail.upsert({
      where: { employeeId: id },
      update: input,
      create: { ...input, employeeId: id },
    });
    await auditMutation(this.prisma, ctx, 'employee.bank.update', 'BankDetail', bank.id);
    return bank;
  }

  // ── self service (/me/profile) ────────────────────────────────────────

  async myProfile(claims: AccessTokenClaims) {
    if (!claims.employeeId)
      throw new NotFoundException('No employee record linked to this account');
    const employee = await this.prisma.employee.findFirst({
      where: { id: claims.employeeId, deletedAt: null },
      include: { ...DETAIL_INCLUDE, bankDetail: true },
    });
    if (!employee) throw new NotFoundException('No employee record linked to this account');
    return employee;
  }

  async updateMyProfile(claims: AccessTokenClaims, input: SelfProfileUpdateInput) {
    if (!claims.employeeId)
      throw new NotFoundException('No employee record linked to this account');
    const employee = await this.prisma.employee.update({
      where: { id: claims.employeeId },
      data: input,
    });
    await auditMutation(
      this.prisma,
      ctxOf(claims),
      'employee.profile.self_update',
      'Employee',
      employee.id,
    );
    return employee;
  }

  // ── helpers ───────────────────────────────────────────────────────────

  private scopeFilter(ctx: Ctx): Prisma.EmployeeWhereInput {
    if (ctx.perms.has('employee.read')) return {};
    // employee.read.team — direct reports; a manager without an employee
    // record has no team
    return { managerId: ctx.employeeId ?? '__none__' };
  }

  private async ensureExists(orgId: string, id: string) {
    const found = await this.prisma.employee.findFirst({
      where: { id, organizationId: orgId, deletedAt: null },
    });
    if (!found) throw new NotFoundException('Employee not found');
    return found;
  }

  /** Validates that every referenced org entity belongs to this tenant. */
  private async validateRefs(orgId: string, input: EmployeeUpdateInput) {
    const checks: [string | null | undefined, () => Promise<unknown>, string][] = [
      [
        input.departmentId,
        () =>
          this.prisma.department.findFirst({
            where: { id: input.departmentId ?? '', organizationId: orgId },
          }),
        'Department',
      ],
      [
        input.designationId,
        () =>
          this.prisma.designation.findFirst({
            where: { id: input.designationId ?? '', organizationId: orgId },
          }),
        'Designation',
      ],
      [
        input.locationId,
        () =>
          this.prisma.location.findFirst({
            where: { id: input.locationId ?? '', organizationId: orgId },
          }),
        'Location',
      ],
      [
        input.shiftId,
        () =>
          this.prisma.shift.findFirst({
            where: { id: input.shiftId ?? '', organizationId: orgId },
          }),
        'Shift',
      ],
      [
        input.employmentTypeId,
        () =>
          this.prisma.employmentType.findFirst({
            where: { id: input.employmentTypeId ?? '', organizationId: orgId },
          }),
        'Employment type',
      ],
      [
        input.managerId,
        () =>
          this.prisma.employee.findFirst({
            where: { id: input.managerId ?? '', organizationId: orgId, deletedAt: null },
          }),
        'Manager',
      ],
    ];
    for (const [value, find, label] of checks) {
      if (value && !(await find())) throw new NotFoundException(`${label} not found`);
    }
  }

  /** Rejects a manager who reports (transitively) to this employee. */
  private async ensureNoManagerCycle(id: string, proposedManagerId: string) {
    let cursor: string | null = proposedManagerId;
    for (let depth = 0; cursor && depth < 100; depth++) {
      if (cursor === id) {
        throw new BadRequestException('Cannot assign a manager who reports to this employee');
      }
      const manager: { managerId: string | null } | null = await this.prisma.employee.findUnique({
        where: { id: cursor },
        select: { managerId: true },
      });
      cursor = manager?.managerId ?? null;
    }
  }

  /**
   * Next free `EMP-####`.
   *
   * Derived from the highest code in use, not from a row count: once anyone
   * has been deleted or given a manual code, a count collides on every
   * subsequent create and only the retry loop saves it.
   */
  private async nextCode(orgId: string, offset: number): Promise<string> {
    const rows = await this.prisma.employee.findMany({
      where: { organizationId: orgId, employeeCode: { startsWith: 'EMP-' } },
      select: { employeeCode: true },
    });
    const highest = rows.reduce((max, row) => {
      const n = Number.parseInt(row.employeeCode.slice(4), 10);
      return Number.isFinite(n) && n > max ? n : max;
    }, 0);
    return `EMP-${String(highest + 1 + offset).padStart(4, '0')}`;
  }

  private isUniqueViolation(err: unknown): boolean {
    return typeof err === 'object' && err !== null && (err as { code?: string }).code === 'P2002';
  }
}
