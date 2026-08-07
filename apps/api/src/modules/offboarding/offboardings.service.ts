import type {
  ExitInterviewInput,
  OffboardingCancelInput,
  OffboardingCompleteInput,
  OffboardingCreateInput,
  OffboardingQuery,
  OffboardingTaskUpdateInput,
  OffboardingUpdateInput,
} from '@hrms/shared';
import type { AccessTokenClaims } from '@hrms/types';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  forwardRef,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { auditMutation } from '../../common/utils/audit';
import { dateKeyOf, displayDate, toDate } from '../../common/utils/calendar';
import { buildListArgs, toPaginated } from '../../common/utils/list-query';
import { PrismaService } from '../../database/prisma.service';
import type { ClearanceOwner, Prisma } from '../../generated/prisma/client';
import { AssetClearanceService } from '../assets/asset-clearance.service';
import { AuditService } from '../audit/audit.service';
import { EmploymentTransitionService } from '../lifecycle/employment-transition.service';
import { LifecyclePolicyService } from '../lifecycle/lifecycle-policy.service';
import { NotificationsService } from '../notifications/notifications.service';
import { ResignationsService } from '../resignations/resignations.service';
import { SettingsService } from '../settings/settings.service';

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
  tasks: { orderBy: { order: 'asc' } },
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
    private readonly notifications: NotificationsService,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
    /*
     * One direction only: this module knows about assets, assets does not know
     * about this one. The clearance service reads Offboarding through Prisma,
     * exactly as SettlementsService does, so there is no cycle to guard.
     */
    private readonly assetClearance: AssetClearanceService,
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
        userId: true,
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
          /*
           * The checklist is copied from the organization's template, not
           * joined to it. Editing the template next week must not rewrite an
           * exit that is half signed off — somebody who has already returned
           * their laptop has returned it whatever the list says afterwards.
           * Same freezing rule as the snapshot fields above.
           */
          tasks: {
            create: (await this.settings.get(ctx.orgId)).exitChecklist.items.map((item, index) => ({
              label: item.label,
              description: item.description ?? null,
              owner: item.owner,
              required: item.required,
              kind: item.kind,
              order: index,
            })),
          },
        },
        include: LIST_INCLUDE,
      })
      .catch(this.rethrowDuplicate);

    /*
     * Settle the asset item once, now, against what they actually hold.
     *
     * Without this a leaver who was never issued anything is blocked forever
     * by an item nobody can tick — it is `ASSET_RETURN`, so signing it off by
     * hand is refused, and only the register can settle it.
     */
    await this.assetClearance.sync(ctx.orgId, employee.id);

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

    /*
     * The employee is told their exit is scheduled whichever way it began —
     * including the ones they did not ask for. Somebody whose contract is
     * ending should not find out by noticing their access stopped.
     */
    await this.notifications.notify(employee.userId ? [employee.userId] : [], {
      type: 'offboarding.started',
      title: 'Your exit has been scheduled',
      body: `Your last working day is ${displayDate(input.lastWorkingDate)}. Your sign-in keeps working until then.`,
      linkPath: '/resignations',
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
    await this.assertCleared(id);
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

    /*
     * HR, not the employee: their sign-in was just suspended and every session
     * revoked, so a notification for them would land in an account nobody can
     * open. This is also the one that matters when the daily tick closed it —
     * somebody has to know an exit completed itself overnight.
     */
    const who = `${updated.employee.firstName} ${updated.employee.lastName}`;
    await this.notifications.notifyPermission(
      ctx.orgId,
      'employee.offboard',
      {
        type: 'offboarding.completed',
        title: `${who} has left`,
        body: `Last working day ${displayDate(lastWorkingDate)}. Their sign-in has been suspended.`,
        linkPath: '/resignations/offboarding',
      },
      { except: ctx.userId },
    );
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

  // ── clearance ─────────────────────────────────────────────────────────

  /**
   * Sign one line off, waive it, or put it back.
   *
   * Putting it back is deliberately allowed: a laptop that turned out not to
   * have come back has not come back, and the only alternative is a record
   * that is wrong.
   */
  async updateTask(claims: AccessTokenClaims, taskId: string, input: OffboardingTaskUpdateInput) {
    const ctx: OffboardingCtx = { orgId: claims.orgId, userId: claims.sub };
    const task = await this.prisma.offboardingTask.findFirst({
      where: { id: taskId, offboarding: { organizationId: ctx.orgId } },
      include: {
        offboarding: {
          select: { id: true, status: true, employee: { select: { managerId: true } } },
        },
      },
    });
    if (!task) throw new NotFoundException('Clearance item not found');
    if (task.offboarding.status !== 'IN_PROGRESS') {
      throw new BadRequestException(
        task.offboarding.status === 'COMPLETED'
          ? 'This offboarding is already complete'
          : 'This offboarding was cancelled',
      );
    }
    this.assertMaySignOff(claims, task.owner, task.offboarding.employee.managerId);

    /*
     * An asset item is settled by the register, not by a person. Ticking it
     * DONE by hand would be asserting the laptops came back while the register
     * says they did not, and the two disagreeing is exactly what this item was
     * made computed to stop.
     *
     * Waiving it is still allowed, and is the escape hatch: NOT_APPLICABLE
     * already demands a reason, so "they posted it back" and "written off"
     * both have somewhere honest to go.
     */
    if (task.kind === 'ASSET_RETURN' && input.status === 'DONE') {
      throw new BadRequestException(
        'This settles itself when their assets come back. Take them back on the asset record, or waive it with a reason',
      );
    }

    const done = input.status !== 'PENDING';
    const updated = await this.prisma.offboardingTask.update({
      where: { id: taskId },
      data: {
        status: input.status,
        note: input.note ?? null,
        // Cleared by nobody at no time is what PENDING means; leaving the
        // stamps behind would make a reopened item look signed off.
        doneAt: done ? new Date() : null,
        doneById: done ? ctx.userId : null,
      },
    });

    await auditMutation(
      this.prisma,
      ctx,
      'offboarding.clearance',
      'Offboarding',
      task.offboardingId,
      {
        before: { task: task.label, status: task.status },
        after: { status: input.status },
        note: input.note ?? null,
      },
    );
    return updated;
  }

  /**
   * Who may sign off what.
   *
   * `offboarding.clearance` says "you may clear an exit item"; it cannot say
   * whose. A `MANAGER`-owned item therefore demands the caller actually be that
   * employee's manager — otherwise every manager in the organization could
   * sign off every handover.
   *
   * `employee.offboard` holders may sign off anything, which is also what
   * covers `IT_ADMIN` items until an IT role exists.
   */
  private assertMaySignOff(
    claims: AccessTokenClaims,
    owner: ClearanceOwner,
    managerId: string | null,
  ) {
    const perms = new Set(claims.perms);
    if (perms.has('employee.offboard')) return;
    if (!perms.has('offboarding.clearance')) {
      throw new ForbiddenException('You cannot sign off exit clearance');
    }
    if (owner === 'MANAGER' && managerId !== claims.employeeId) {
      throw new ForbiddenException('Only their reporting manager can sign this off');
    }
  }

  /**
   * The gate.
   *
   * This one rule is "employees cannot complete exit until required assets are
   * returned" — generic, so it covers the handover and the dues as well, and
   * so Asset Management can later make one of these items compute itself
   * without the gate changing at all.
   */
  private async assertCleared(offboardingId: string) {
    const outstanding = await this.prisma.offboardingTask.findMany({
      where: { offboardingId, required: true, status: 'PENDING' },
      select: { label: true },
      orderBy: { order: 'asc' },
    });
    if (outstanding.length === 0) return;
    // Named, not counted: "3 items outstanding" sends somebody hunting.
    throw new BadRequestException(
      `Still outstanding: ${outstanding.map((t) => t.label).join(', ')}`,
    );
  }

  // ── exit interview ────────────────────────────────────────────────────

  /**
   * Record the conversation, or amend what was recorded.
   *
   * An upsert rather than a create-then-edit pair, because the interview is
   * written *during* the conversation: half of it saved is better than a form
   * somebody abandons because they had to finish it in one sitting.
   *
   * Editable after the offboarding completes, deliberately. The interview
   * often happens on the last day and gets written up afterwards, and refusing
   * then would mean the record is whatever was typed in a hurry.
   */
  async saveInterview(claims: AccessTokenClaims, id: string, input: ExitInterviewInput) {
    const ctx: OffboardingCtx = { orgId: claims.orgId, userId: claims.sub };
    const record = await this.prisma.offboarding.findFirst({
      where: { id, organizationId: ctx.orgId },
      select: { id: true },
    });
    if (!record) throw new NotFoundException('Offboarding not found');

    const data = {
      conductedOn: input.conductedOn ? toDate(input.conductedOn) : null,
      conductedById: ctx.userId,
      responses: input.responses,
      notes: input.notes ?? null,
      wouldRecommend: input.wouldRecommend ?? null,
      rehireEligible: input.rehireEligible ?? null,
    };
    const existed = await this.prisma.exitInterview.findUnique({
      where: { offboardingId: id },
      select: { id: true },
    });

    const saved = await this.prisma.exitInterview.upsert({
      where: { offboardingId: id },
      create: { offboardingId: id, ...data },
      update: data,
    });

    await auditMutation(this.prisma, ctx, 'offboarding.interview', 'Offboarding', id, {
      // The answers are not in the audit meta on purpose: they are the most
      // sensitive text in the record, and the audit log is a wider read than
      // the interview itself.
      after: { recorded: true, amended: Boolean(existed), answered: input.responses.length },
    });
    return saved;
  }

  /**
   * Read it back.
   *
   * `employee.offboard` only — deliberately not the leaver's own manager, who
   * is very often the subject of the answers. The route enforces that; this
   * exists so the offboarding detail read does not have to carry it.
   */
  async interview(claims: AccessTokenClaims, id: string) {
    return this.prisma.exitInterview.findFirst({
      where: { offboardingId: id, offboarding: { organizationId: claims.orgId } },
    });
  }

  /**
   * The trail for one exit: started, rescheduled, cleared, interviewed,
   * completed or cancelled.
   *
   * Every one of those already wrote an `Offboarding` audit row; nothing
   * exposed them. Without this an HR-initiated termination had no history at
   * all on screen, because the only trail on the page was the resignation's —
   * and a termination has no resignation.
   */
  async activity(claims: AccessTokenClaims, id: string) {
    await this.detail(claims, id);
    return this.audit.forEntity(claims.orgId, 'Offboarding', id);
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
