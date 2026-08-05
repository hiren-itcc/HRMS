import type {
  OffboardingCancelInput,
  OffboardingCompleteInput,
  OffboardingCreateInput,
  OffboardingQuery,
  OffboardingUpdateInput,
} from '@hrms/shared';
import type { AccessTokenClaims } from '@hrms/types';
import {
  BadRequestException,
  ConflictException,
  forwardRef,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { auditMutation } from '../../common/utils/audit';
import { dateKeyOf, toDate } from '../../common/utils/calendar';
import { buildListArgs, toPaginated } from '../../common/utils/list-query';
import { PrismaService } from '../../database/prisma.service';
import type { Prisma } from '../../generated/prisma/client';
import { EmploymentTransitionService } from '../lifecycle/employment-transition.service';
import { LifecyclePolicyService } from '../lifecycle/lifecycle-policy.service';
import { ResignationsService } from '../resignations/resignations.service';

const SORTABLE = ['lastWorkingDate', 'startedAt', 'status'] as const;

const LIST_INCLUDE = {
  employee: {
    select: {
      id: true,
      firstName: true,
      lastName: true,
      employeeCode: true,
      avatarUrl: true,
      workEmail: true,
      status: true,
      managerId: true,
    },
  },
  resignation: { select: { id: true, reason: true, status: true, submittedAt: true } },
} as const;

export interface OffboardingCtx {
  orgId: string;
  /** Null for the daily tick — nobody pressed anything. */
  userId: string | null;
}

/**
 * The operational half of somebody leaving: the record that exists from the
 * moment an exit is agreed until their last day has passed.
 *
 * Deliberately one table for every way of leaving. A resignation, a
 * termination and a contract ending produce identical work — notice is served,
 * a date arrives, access is closed — and splitting them would mean two lists,
 * two ways to reach EXITED, and an attrition report that has to union them.
 *
 * Nothing here writes `Employee.status` or `Employee.exitDate` itself. Every
 * one goes through `EmploymentTransitionService`, which is also what the HR
 * offboard dialog has always used.
 */
@Injectable()
export class OffboardingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly transitions: EmploymentTransitionService,
    private readonly lifecycle: LifecyclePolicyService,
    /*
     * The one cycle in this feature, and it is real rather than accidental:
     * approving a resignation opens an offboarding, and completing an
     * offboarding closes the resignation. Both directions are needed and
     * neither call can be pushed to a third party without inventing a
     * coordinator that does nothing else.
     */
    @Inject(forwardRef(() => ResignationsService))
    private readonly resignations: ResignationsService,
  ) {}

  /**
   * Opened by HR approving a resignation. Not routed to — there is no endpoint
   * that reaches this, because an offboarding with reason RESIGNATION and no
   * resignation behind it is a record nobody can explain.
   */
  async startFromResignation(
    ctx: OffboardingCtx,
    input: { resignationId: string; employeeId: string; lastWorkingDate: string },
  ) {
    return this.start(ctx, {
      employeeId: input.employeeId,
      resignationId: input.resignationId,
      reason: 'RESIGNATION',
      reasonNote: null,
      lastWorkingDate: input.lastWorkingDate,
    });
  }

  /** HR starting an exit directly: a termination, a contract ending, a retirement. */
  async create(claims: AccessTokenClaims, input: OffboardingCreateInput) {
    const ctx: OffboardingCtx = { orgId: claims.orgId, userId: claims.sub };
    const lifecycleCtx = await this.lifecycle.contextFor(ctx.orgId);
    if (input.lastWorkingDate < lifecycleCtx.todayKey) {
      throw new BadRequestException('The last working date cannot be in the past');
    }
    return this.start(ctx, {
      employeeId: input.employeeId,
      resignationId: null,
      reason: input.reason,
      reasonNote: input.reasonNote ?? null,
      lastWorkingDate: input.lastWorkingDate,
    });
  }

  private async start(
    ctx: OffboardingCtx,
    input: {
      employeeId: string;
      resignationId: string | null;
      reason: OffboardingCreateInput['reason'];
      reasonNote: string | null;
      lastWorkingDate: string;
    },
  ) {
    const employee = await this.prisma.employee.findFirst({
      where: { id: input.employeeId, organizationId: ctx.orgId, deletedAt: null },
      select: {
        id: true,
        joinDate: true,
        status: true,
        department: { select: { name: true } },
        designation: { select: { title: true } },
        manager: { select: { firstName: true, lastName: true } },
      },
    });
    if (!employee) throw new NotFoundException('Employee not found');
    if (employee.status === 'ONBOARDING') {
      throw new BadRequestException('They have not started yet — cancel their onboarding instead');
    }
    if (employee.status === 'EXITED') {
      throw new BadRequestException('They have already left');
    }

    const open = await this.prisma.offboarding.count({
      where: { employeeId: employee.id, status: 'IN_PROGRESS' },
    });
    if (open > 0) throw new ConflictException('This employee is already being offboarded');

    const created = await this.prisma.offboarding
      .create({
        data: {
          organizationId: ctx.orgId,
          employeeId: employee.id,
          resignationId: input.resignationId,
          reason: input.reason,
          reasonNote: input.reasonNote,
          lastWorkingDate: toDate(input.lastWorkingDate),
          startedById: ctx.userId,
          /*
           * Frozen now, the way a Letter freezes its variables. Six months
           * later the department may have been merged away and the manager may
           * have left themselves — an exit record that reads "—" for both is
           * no use to whoever is answering a reference request.
           */
          snapshotJoinDate: employee.joinDate,
          snapshotDepartment: employee.department?.name ?? null,
          snapshotDesignation: employee.designation?.title ?? null,
          snapshotManagerName: employee.manager
            ? `${employee.manager.firstName} ${employee.manager.lastName}`
            : null,
        },
        include: LIST_INCLUDE,
      })
      .catch(this.rethrowDuplicate);

    // Serving notice, not gone: the login is untouched and they keep clocking
    // in, booking leave and being paid until the date arrives.
    await this.transitions.apply(ctx, employee.id, {
      status: 'ON_NOTICE',
      exitDate: input.lastWorkingDate,
      reason: input.reasonNote,
      action: 'offboarding.start',
    });

    await auditMutation(this.prisma, ctx, 'offboarding.start', 'Offboarding', created.id, {
      after: {
        employeeId: employee.id,
        reason: input.reason,
        lastWorkingDate: input.lastWorkingDate,
        resignationId: input.resignationId,
      },
    });
    return created;
  }

  /** Notice gets extended and shortened; this is that, and it moves exitDate with it. */
  async update(claims: AccessTokenClaims, id: string, input: OffboardingUpdateInput) {
    const ctx: OffboardingCtx = { orgId: claims.orgId, userId: claims.sub };
    const record = await this.requireOpen(ctx.orgId, id);
    const lifecycleCtx = await this.lifecycle.contextFor(ctx.orgId);

    if (input.lastWorkingDate < lifecycleCtx.todayKey) {
      throw new BadRequestException('The last working date cannot be in the past');
    }

    const updated = await this.prisma.offboarding.update({
      where: { id },
      data: {
        lastWorkingDate: toDate(input.lastWorkingDate),
        reasonNote: input.reasonNote ?? record.reasonNote,
      },
      include: LIST_INCLUDE,
    });

    /*
     * The employee's exitDate has to move too. It is what attendance, payroll
     * and every report actually read — leaving it behind would mean the exit
     * screen said one date and the final payslip used another.
     */
    await this.transitions.apply(ctx, record.employeeId, {
      status: 'ON_NOTICE',
      exitDate: input.lastWorkingDate,
      action: 'offboarding.reschedule',
    });

    if (record.resignationId) {
      await this.prisma.resignation.update({
        where: { id: record.resignationId },
        data: { approvedLastWorkingDate: toDate(input.lastWorkingDate) },
      });
    }

    await auditMutation(this.prisma, ctx, 'offboarding.reschedule', 'Offboarding', id, {
      before: { lastWorkingDate: dateKeyOf(record.lastWorkingDate) },
      after: { lastWorkingDate: input.lastWorkingDate },
    });
    return updated;
  }

  /**
   * Their last day has passed (or HR is closing it early).
   *
   * This is where the sign-in is finally suspended and every session revoked,
   * and it is the same code path the HR dialog's "Left the company" always
   * took. Callable by hand or by the daily tick, which is why the context
   * carries a nullable actor.
   */
  async complete(ctx: OffboardingCtx, id: string, input: OffboardingCompleteInput = {}) {
    const record = await this.requireOpen(ctx.orgId, id);
    const lastWorkingDate = input.lastWorkingDate ?? dateKeyOf(record.lastWorkingDate);

    await this.transitions.apply(ctx, record.employeeId, {
      status: 'EXITED',
      exitDate: lastWorkingDate,
      reason: input.note ?? record.reasonNote,
      action: 'offboarding.complete',
    });

    const updated = await this.prisma.offboarding.update({
      where: { id },
      data: {
        status: 'COMPLETED',
        completedAt: new Date(),
        completedById: ctx.userId,
        lastWorkingDate: toDate(lastWorkingDate),
      },
      include: LIST_INCLUDE,
    });

    if (record.resignationId) await this.resignations.markCompleted(ctx, record.resignationId);

    await auditMutation(this.prisma, ctx, 'offboarding.complete', 'Offboarding', id, {
      before: { status: record.status, lastWorkingDate: dateKeyOf(record.lastWorkingDate) },
      after: { status: 'COMPLETED', lastWorkingDate },
      note: input.note ?? null,
    });
    return updated;
  }

  /** The exit is off: they are staying. Restores their sign-in if it was suspended. */
  async cancel(claims: AccessTokenClaims, id: string, input: OffboardingCancelInput) {
    const ctx: OffboardingCtx = { orgId: claims.orgId, userId: claims.sub };
    const record = await this.requireOpen(ctx.orgId, id);

    await this.transitions.apply(ctx, record.employeeId, {
      status: 'ACTIVE',
      exitDate: null,
      reason: input.reason,
      action: 'offboarding.cancel',
    });

    const updated = await this.prisma.offboarding.update({
      where: { id },
      data: { status: 'CANCELLED', cancelledAt: new Date(), cancelReason: input.reason },
      include: LIST_INCLUDE,
    });

    if (record.resignationId) await this.resignations.reopen(ctx, record.resignationId);

    await auditMutation(this.prisma, ctx, 'offboarding.cancel', 'Offboarding', id, {
      before: { status: record.status },
      after: { status: 'CANCELLED' },
      note: input.reason,
    });
    return updated;
  }

  // ── reads ─────────────────────────────────────────────────────────────

  async list(claims: AccessTokenClaims, query: OffboardingQuery) {
    const where: Prisma.OffboardingWhereInput = {
      organizationId: claims.orgId,
      ...(query.status ? { status: query.status } : {}),
      ...(query.reason ? { reason: query.reason } : {}),
      ...(query.departmentId ? { employee: { departmentId: query.departmentId } } : {}),
    };
    const [data, total] = await this.prisma.$transaction([
      this.prisma.offboarding.findMany({
        where,
        include: LIST_INCLUDE,
        ...buildListArgs(query, SORTABLE, 'lastWorkingDate'),
      }),
      this.prisma.offboarding.count({ where }),
    ]);
    return toPaginated(data, total, query);
  }

  async detail(claims: AccessTokenClaims, id: string) {
    const record = await this.prisma.offboarding.findFirst({
      where: { id, organizationId: claims.orgId },
      include: LIST_INCLUDE,
    });
    if (!record) throw new NotFoundException('Offboarding not found');
    return record;
  }

  /** Everything overdue, for the daily tick. Ordered so the oldest closes first. */
  dueForCompletion(orgId: string, todayKey: string) {
    return this.prisma.offboarding.findMany({
      where: {
        organizationId: orgId,
        status: 'IN_PROGRESS',
        lastWorkingDate: { lt: toDate(todayKey) },
      },
      select: { id: true },
      orderBy: { lastWorkingDate: 'asc' },
    });
  }

  private async requireOpen(orgId: string, id: string) {
    const record = await this.prisma.offboarding.findFirst({
      where: { id, organizationId: orgId },
    });
    if (!record) throw new NotFoundException('Offboarding not found');
    if (record.status !== 'IN_PROGRESS') {
      throw new BadRequestException(
        record.status === 'COMPLETED'
          ? 'This offboarding is already complete'
          : 'This offboarding was cancelled',
      );
    }
    return record;
  }

  private rethrowDuplicate = (err: unknown): never => {
    if ((err as { code?: string }).code === 'P2002') {
      throw new ConflictException('This employee is already being offboarded');
    }
    throw err;
  };
}
