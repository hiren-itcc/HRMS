import type {
  ResignationCreateInput,
  ResignationDecisionInput,
  ResignationQuery,
  ResignationStatusCode,
  ResignationWithdrawInput,
} from '@hrms/shared';
import { ACTIVE_RESIGNATION_STATUSES } from '@hrms/shared';
import type { AccessTokenClaims } from '@hrms/types';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { auditMutation } from '../../common/utils/audit';
import { dateKeyOf, displayDate, toDate } from '../../common/utils/calendar';
import { buildListArgs, toPaginated } from '../../common/utils/list-query';
import { PrismaService } from '../../database/prisma.service';
import type { Prisma } from '../../generated/prisma/client';
import { AuditService } from '../audit/audit.service';
import { LifecyclePolicyService } from '../lifecycle/lifecycle-policy.service';
import { NotificationsService } from '../notifications/notifications.service';
import { OffboardingsService } from '../offboarding/offboardings.service';
import {
  awaitingDesk,
  canTransition,
  isWithEmployee,
  nextStatus,
  type ResignationAction,
  transitionError,
} from './resignation.workflow';

const SORTABLE = ['submittedAt', 'requestedLastWorkingDate', 'status'] as const;

const EMPLOYEE_SELECT = {
  id: true,
  firstName: true,
  lastName: true,
  employeeCode: true,
  avatarUrl: true,
  workEmail: true,
  managerId: true,
  // Read by the last-working-date validation on both the employee's edit and
  // HR's approval override.
  joinDate: true,
  department: { select: { id: true, name: true } },
  designation: { select: { id: true, title: true } },
} as const;

const LIST_INCLUDE = {
  employee: { select: EMPLOYEE_SELECT },
  offboarding: { select: { id: true, status: true, lastWorkingDate: true } },
} as const;

interface Ctx {
  orgId: string;
  userId: string;
  employeeId?: string;
  perms: Set<string>;
}

function ctxOf(claims: AccessTokenClaims): Ctx {
  return {
    orgId: claims.orgId,
    userId: claims.sub,
    employeeId: claims.employeeId,
    perms: new Set(claims.perms),
  };
}

@Injectable()
export class ResignationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly lifecycle: LifecyclePolicyService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly offboardings: OffboardingsService,
  ) {}

  /**
   * What the employee needs before the form is any use: how much notice they
   * owe, the earliest day that allows, and whether they already have one open.
   *
   * Computed here rather than in the browser so the client never has to know
   * the policy — and so the date it defaults to is the same date the server
   * will validate against, in the organization's timezone rather than the
   * laptop's.
   */
  async eligibility(claims: AccessTokenClaims) {
    const ctx = ctxOf(claims);
    const employee = await this.requireSelf(ctx);
    const lifecycleCtx = await this.lifecycle.contextFor(ctx.orgId);
    const notice = this.lifecycle.noticeFor(employee, lifecycleCtx);

    const open = await this.prisma.resignation.findFirst({
      where: { employeeId: employee.id, status: { in: [...ACTIVE_RESIGNATION_STATUSES] } },
      include: LIST_INCLUDE,
    });

    return {
      ...notice,
      today: lifecycleCtx.todayKey,
      canSubmit: !open && employee.status === 'ACTIVE',
      /** Why not, when they cannot — the form shows this instead of a dead button. */
      blockedReason: open
        ? 'You already have a resignation in progress'
        : employee.status === 'ONBOARDING'
          ? 'You have not started yet'
          : employee.status === 'EXITED'
            ? 'You have already left'
            : employee.status === 'ON_NOTICE' && !open
              ? 'Your exit is already being handled by HR'
              : null,
      current: open ? this.present(open, lifecycleCtx.todayKey) : null,
    };
  }

  async submit(claims: AccessTokenClaims, input: ResignationCreateInput) {
    const ctx = ctxOf(claims);
    const employee = await this.requireSelf(ctx);
    const lifecycleCtx = await this.lifecycle.contextFor(ctx.orgId);

    if (employee.status !== 'ACTIVE') {
      throw new BadRequestException(
        employee.status === 'ONBOARDING'
          ? 'You cannot resign before you have started'
          : 'Your exit is already being handled — talk to HR',
      );
    }
    this.assertLastWorkingDateSane(input.lastWorkingDate, lifecycleCtx.todayKey, employee.joinDate);

    // Checked for the message; the partial unique index is what actually stops
    // a double-clicked submit button creating two.
    const open = await this.prisma.resignation.count({
      where: { employeeId: employee.id, status: { in: [...ACTIVE_RESIGNATION_STATUSES] } },
    });
    if (open > 0) throw new ConflictException('You already have a resignation in progress');

    const notice = this.lifecycle.noticeFor(employee, lifecycleCtx);
    const created = await this.prisma
      .$transaction(async (tx) =>
        tx.resignation.create({
          data: {
            organizationId: ctx.orgId,
            employeeId: employee.id,
            reason: input.reason,
            remarks: input.remarks ?? null,
            requestedLastWorkingDate: toDate(input.lastWorkingDate),
            // Frozen at submit: a later change to the company default must not
            // rewrite what this person was told they owed.
            noticeDays: notice.noticeDays,
            earliestLastWorkingDate: toDate(notice.earliestLastWorkingDate),
            /*
             * Captured now. Reading `employee.managerId` at decision time
             * would mean a reorganisation mid-notice moved the request to
             * somebody who knows nothing about it — or to nobody.
             */
            routedManagerId: this.routeTo(employee.managerId, lifecycleCtx.policy),
          },
          include: LIST_INCLUDE,
        }),
      )
      .catch(this.rethrowDuplicate);

    await auditMutation(this.prisma, ctx, 'resignation.submit', 'Resignation', created.id, {
      after: {
        reason: created.reason,
        lastWorkingDate: input.lastWorkingDate,
        noticeDays: notice.noticeDays,
        isShortNotice: input.lastWorkingDate < notice.earliestLastWorkingDate,
      },
    });
    await this.announceSubmission(ctx, created, input.lastWorkingDate);
    return this.present(created, lifecycleCtx.todayKey);
  }

  /**
   * Tell whoever has to act on it.
   *
   * Routed to a manager, it goes to that one person. Routed to nobody — the
   * top of the org chart, or an organization with the manager step off — it
   * goes to everyone who can give final approval, because otherwise the
   * request sits on a desk nobody has been told about.
   */
  private async announceSubmission(
    ctx: Ctx,
    created: {
      id: string;
      routedManagerId: string | null;
      employee: { firstName: string; lastName: string };
    },
    lastWorkingDate: string,
  ) {
    const who = `${created.employee.firstName} ${created.employee.lastName}`;
    const payload = {
      type: 'resignation.submitted',
      title: `${who} has resigned`,
      body: `Last working day ${displayDate(lastWorkingDate)}. It is waiting on you.`,
      linkPath: `/resignations/${created.id}`,
    };

    if (created.routedManagerId) {
      await this.notifications.notify(await this.usersOf([created.routedManagerId]), payload);
      return;
    }
    await this.notifications.notifyPermission(ctx.orgId, 'resignation.approve', payload, {
      except: ctx.userId,
    });
  }

  /** Employee ids to the sign-ins behind them; anyone without one is dropped. */
  private async usersOf(employeeIds: (string | null | undefined)[]): Promise<string[]> {
    const ids = employeeIds.filter((v): v is string => Boolean(v));
    if (ids.length === 0) return [];
    const rows = await this.prisma.employee.findMany({
      where: { id: { in: ids }, userId: { not: null } },
      select: { userId: true },
    });
    return rows.map((row) => row.userId as string);
  }

  /** The employee changing their own request, while it is still theirs to change. */
  async update(claims: AccessTokenClaims, id: string, input: ResignationCreateInput) {
    const ctx = ctxOf(claims);
    const record = await this.requireOwn(ctx, id);
    const lifecycleCtx = await this.lifecycle.contextFor(ctx.orgId);

    if (!isWithEmployee(record.status)) {
      throw new BadRequestException(transitionError(record.status, 'resubmit'));
    }
    this.assertLastWorkingDateSane(
      input.lastWorkingDate,
      lifecycleCtx.todayKey,
      record.employee.joinDate,
    );

    /*
     * Editing a sent-back request resubmits it. Leaving it in
     * CHANGES_REQUESTED would mean the employee makes the change and nothing
     * tells the reviewer, which is how a request sits untouched for a week.
     */
    const status: ResignationStatusCode =
      record.status === 'CHANGES_REQUESTED' ? 'SUBMITTED' : record.status;

    const updated = await this.prisma.resignation.update({
      where: { id },
      data: {
        reason: input.reason,
        remarks: input.remarks ?? null,
        requestedLastWorkingDate: toDate(input.lastWorkingDate),
        status,
      },
      include: LIST_INCLUDE,
    });

    await auditMutation(this.prisma, ctx, 'resignation.update', 'Resignation', id, {
      before: {
        reason: record.reason,
        lastWorkingDate: dateKeyOf(record.requestedLastWorkingDate),
        status: record.status,
      },
      after: { reason: input.reason, lastWorkingDate: input.lastWorkingDate, status },
    });
    return this.present(updated, lifecycleCtx.todayKey);
  }

  async withdraw(claims: AccessTokenClaims, id: string, input: ResignationWithdrawInput) {
    const ctx = ctxOf(claims);
    const record = await this.requireOwn(ctx, id);
    const lifecycleCtx = await this.lifecycle.contextFor(ctx.orgId);

    if (!canTransition(record.status, 'withdraw')) {
      throw new BadRequestException(transitionError(record.status, 'withdraw'));
    }

    const updated = await this.prisma.resignation.update({
      where: { id },
      data: { status: 'WITHDRAWN', withdrawnAt: new Date(), remarks: input.remarks ?? undefined },
      include: LIST_INCLUDE,
    });
    await auditMutation(this.prisma, ctx, 'resignation.withdraw', 'Resignation', id, {
      before: { status: record.status },
      after: { status: 'WITHDRAWN' },
      note: input.remarks ?? null,
    });
    return this.present(updated, lifecycleCtx.todayKey);
  }

  /**
   * The manager's or HR's decision.
   *
   * One endpoint for both desks and all three verbs. Which desk the caller is
   * acting as comes from the record's own status, not from anything they send
   * — so an HR user who also happens to be somebody's manager cannot skip the
   * manager step by claiming to be HR, and a manager cannot give final sign-off
   * by claiming the request had already reached HR.
   */
  async decide(claims: AccessTokenClaims, id: string, input: ResignationDecisionInput) {
    const ctx = ctxOf(claims);
    const record = await this.requireReadable(ctx, id);
    const lifecycleCtx = await this.lifecycle.contextFor(ctx.orgId);

    const parked = awaitingDesk(record.status, record.routedManagerId);
    if (!parked) throw new BadRequestException(transitionError(record.status, 'hr_approve'));

    /*
     * HR acting on a request still at the manager's desk gives final approval
     * rather than approving on the manager's behalf. That is what unsticks a
     * request whose reviewer has themselves left, or is on leave for a month —
     * and it is recorded as a skipped manager step rather than as a decision
     * the manager never made.
     */
    const overriding =
      parked === 'MANAGER' &&
      ctx.perms.has('resignation.approve') &&
      record.routedManagerId !== ctx.employeeId;
    const desk = overriding ? 'HR' : parked;

    const action = this.actionFor(desk, input.action);
    if (!canTransition(record.status, action)) {
      throw new BadRequestException(transitionError(record.status, action));
    }
    this.assertMayDecide(ctx, record, desk);

    const to = nextStatus(record.status, action) as ResignationStatusCode;
    const stamp =
      desk === 'MANAGER'
        ? {
            managerDecidedAt: new Date(),
            managerDecidedById: ctx.userId,
            managerRemarks: input.remarks ?? null,
          }
        : {
            hrDecidedAt: new Date(),
            hrDecidedById: ctx.userId,
            hrRemarks: input.remarks ?? null,
          };

    /*
     * Approval is the one decision with consequences outside this table: it
     * opens the offboarding and moves the employee to ON_NOTICE with an exit
     * date. All three happen together or none does — a resignation marked
     * approved with no offboarding is invisible work.
     */
    if (action === 'hr_approve') {
      const lastWorkingDate = input.lastWorkingDate ?? dateKeyOf(record.requestedLastWorkingDate);
      this.assertLastWorkingDateSane(
        lastWorkingDate,
        lifecycleCtx.todayKey,
        record.employee.joinDate,
      );

      await this.prisma.resignation.update({
        where: { id },
        data: { ...stamp, status: to, approvedLastWorkingDate: toDate(lastWorkingDate) },
      });
      await this.offboardings.startFromResignation(ctx, {
        resignationId: id,
        employeeId: record.employeeId,
        lastWorkingDate,
      });
    } else {
      await this.prisma.resignation.update({ where: { id }, data: { ...stamp, status: to } });
    }

    await auditMutation(this.prisma, ctx, `resignation.${action}`, 'Resignation', id, {
      before: { status: record.status },
      after: {
        status: to,
        ...(action === 'hr_approve'
          ? { lastWorkingDate: input.lastWorkingDate ?? dateKeyOf(record.requestedLastWorkingDate) }
          : {}),
      },
      note: input.remarks ?? null,
      ...(overriding ? { managerStepSkipped: record.routedManagerId } : {}),
    });

    await this.announceDecision(record.employeeId, id, input, to);
    return this.detail(claims, id);
  }

  /**
   * Tell the employee what was decided.
   *
   * A rejection or a send-back carries the remarks, because those are the only
   * explanation they get and the API already made them mandatory.
   */
  private async announceDecision(
    employeeId: string,
    resignationId: string,
    input: ResignationDecisionInput,
    to: ResignationStatusCode,
  ) {
    // A manager approval is a step, not an outcome — telling the employee
    // "approved" halfway would be wrong, and telling them "your manager
    // agreed" is noise before the decision that matters.
    if (to === 'MANAGER_APPROVED') return;

    const title =
      to === 'APPROVED'
        ? 'Your resignation has been approved'
        : to === 'REJECTED'
          ? 'Your resignation was not approved'
          : 'Your resignation needs a change';

    await this.notifications.notify(await this.usersOf([employeeId]), {
      type: `resignation.${to.toLowerCase()}`,
      title,
      body: input.remarks ?? null,
      linkPath: `/resignations/${resignationId}`,
    });
  }

  /** Called by the offboarding service; never routed to directly. */
  async markCompleted(ctx: { orgId: string; userId: string | null }, resignationId: string) {
    const record = await this.prisma.resignation.findFirst({
      where: { id: resignationId, organizationId: ctx.orgId },
      select: { status: true },
    });
    if (!record || !canTransition(record.status, 'complete')) return;
    await this.prisma.resignation.update({
      where: { id: resignationId },
      data: { status: 'COMPLETED' },
    });
    await auditMutation(this.prisma, ctx, 'resignation.complete', 'Resignation', resignationId, {
      before: { status: record.status },
      after: { status: 'COMPLETED' },
    });
  }

  /** Called when an offboarding is cancelled — the request is live again. */
  async reopen(ctx: { orgId: string; userId: string | null }, resignationId: string) {
    const record = await this.prisma.resignation.findFirst({
      where: { id: resignationId, organizationId: ctx.orgId },
      select: { status: true },
    });
    if (!record || !canTransition(record.status, 'reopen')) return;
    await this.prisma.resignation.update({
      where: { id: resignationId },
      // Back to HR's desk with the approval cleared, so approving again is a
      // fresh decision rather than a date that silently survived the reversal.
      data: { status: 'MANAGER_APPROVED', approvedLastWorkingDate: null, hrDecidedAt: null },
    });
    await auditMutation(this.prisma, ctx, 'resignation.reopen', 'Resignation', resignationId, {
      before: { status: record.status },
      after: { status: 'MANAGER_APPROVED' },
    });
  }

  // ── reads ─────────────────────────────────────────────────────────────

  async list(claims: AccessTokenClaims, query: ResignationQuery) {
    const ctx = ctxOf(claims);
    const lifecycleCtx = await this.lifecycle.contextFor(ctx.orgId);
    const where: Prisma.ResignationWhereInput = {
      organizationId: ctx.orgId,
      ...this.scopeFilter(ctx),
      ...(query.status ? { status: query.status } : {}),
      ...(query.reason ? { reason: query.reason } : {}),
      ...(query.departmentId ? { employee: { departmentId: query.departmentId } } : {}),
      ...(query.awaitingMe ? this.awaitingFilter(ctx) : {}),
    };

    const [data, total] = await this.prisma.$transaction([
      this.prisma.resignation.findMany({
        where,
        include: LIST_INCLUDE,
        ...buildListArgs(query, SORTABLE, 'submittedAt'),
      }),
      this.prisma.resignation.count({ where }),
    ]);
    return toPaginated(
      data.map((row) => this.present(row, lifecycleCtx.todayKey)),
      total,
      query,
    );
  }

  /** Every resignation this employee has ever filed, newest first. */
  async mine(claims: AccessTokenClaims) {
    const ctx = ctxOf(claims);
    if (!ctx.employeeId) return [];
    const lifecycleCtx = await this.lifecycle.contextFor(ctx.orgId);
    const rows = await this.prisma.resignation.findMany({
      where: { employeeId: ctx.employeeId },
      include: LIST_INCLUDE,
      orderBy: { submittedAt: 'desc' },
    });
    return rows.map((row) => this.present(row, lifecycleCtx.todayKey));
  }

  async detail(claims: AccessTokenClaims, id: string) {
    const ctx = ctxOf(claims);
    const record = await this.requireReadable(ctx, id);
    const lifecycleCtx = await this.lifecycle.contextFor(ctx.orgId);
    return this.present(record, lifecycleCtx.todayKey);
  }

  /**
   * The trail for one resignation, from the audit log.
   *
   * A scoped read rather than pointing people at `/audit`: that endpoint is
   * behind `audit.read`, which only Admin holds, and the whole point is that
   * the employee and their manager can see what happened to their own request.
   * Reusing the table means there is no second history to keep in step.
   */
  async activity(claims: AccessTokenClaims, id: string) {
    const ctx = ctxOf(claims);
    await this.requireReadable(ctx, id);
    return this.audit.forEntity(ctx.orgId, 'Resignation', id);
  }

  // ── internals ─────────────────────────────────────────────────────────

  /**
   * The scope narrowing guards cannot do, using the idiom the rest of the API
   * uses: the sentinel makes a manager with no reports match zero rows rather
   * than every row.
   */
  private scopeFilter(ctx: Ctx): Prisma.ResignationWhereInput {
    if (ctx.perms.has('resignation.read')) return {};
    if (ctx.perms.has('resignation.read.team')) {
      return { employee: { managerId: ctx.employeeId ?? '__none__' } };
    }
    return { employeeId: ctx.employeeId ?? '__none__' };
  }

  /** Only what is sitting on this caller's desk right now. */
  private awaitingFilter(ctx: Ctx): Prisma.ResignationWhereInput {
    const desks: Prisma.ResignationWhereInput[] = [];
    if (ctx.perms.has('resignation.approve.team') && ctx.employeeId) {
      desks.push({ status: 'SUBMITTED', routedManagerId: ctx.employeeId });
    }
    if (ctx.perms.has('resignation.approve')) {
      // HR sees anything at their step, plus anything routed to nobody —
      // a request from somebody with no manager would otherwise be invisible
      // to every desk in the product.
      desks.push({ status: 'MANAGER_APPROVED' });
      desks.push({ status: 'SUBMITTED', routedManagerId: null });
    }
    return desks.length ? { OR: desks } : { id: '__none__' };
  }

  private actionFor(desk: 'MANAGER' | 'HR', verb: ResignationDecisionInput['action']) {
    const table: Record<'MANAGER' | 'HR', Record<typeof verb, ResignationAction>> = {
      MANAGER: {
        approve: 'manager_approve',
        reject: 'manager_reject',
        request_changes: 'request_changes',
      },
      HR: { approve: 'hr_approve', reject: 'hr_reject', request_changes: 'request_changes' },
    };
    return table[desk][verb];
  }

  /**
   * Who may act at each desk.
   *
   * The manager desk demands the caller actually be the manager it was routed
   * to — `resignation.approve.team` says "you may approve for your team", and
   * the guard cannot tell whose team. Somebody holding the org-wide permission
   * may act at either desk, which is how HR unsticks a request whose manager
   * has themselves left.
   */
  private assertMayDecide(
    ctx: Ctx,
    record: { routedManagerId: string | null; employeeId: string },
    desk: 'MANAGER' | 'HR',
  ) {
    if (record.employeeId === ctx.employeeId) {
      throw new ForbiddenException('You cannot decide on your own resignation');
    }
    if (ctx.perms.has('resignation.approve')) return;
    if (desk === 'HR') {
      throw new ForbiddenException('Only HR can give final approval');
    }
    if (!ctx.perms.has('resignation.approve.team') || record.routedManagerId !== ctx.employeeId) {
      throw new ForbiddenException('This resignation is not waiting on you');
    }
  }

  private assertLastWorkingDateSane(dateKey: string, todayKey: string, joinDate: Date) {
    if (dateKey < todayKey) {
      throw new BadRequestException('The last working date cannot be in the past');
    }
    if (dateKey < dateKeyOf(joinDate)) {
      throw new BadRequestException('The last working date cannot be before the joining date');
    }
  }

  /** Who reviews first — nobody, when there is no manager or the org skips it. */
  private routeTo(managerId: string | null, policy: { requireManagerApproval: boolean }) {
    return policy.requireManagerApproval ? managerId : null;
  }

  private async requireSelf(ctx: Ctx) {
    if (!ctx.employeeId) {
      throw new NotFoundException('No employee record is linked to this account');
    }
    const employee = await this.prisma.employee.findFirst({
      where: { id: ctx.employeeId, organizationId: ctx.orgId, deletedAt: null },
      select: {
        id: true,
        status: true,
        joinDate: true,
        managerId: true,
        noticePeriodDays: true,
      },
    });
    if (!employee) throw new NotFoundException('No employee record is linked to this account');
    return employee;
  }

  private async requireOwn(ctx: Ctx, id: string) {
    const record = await this.prisma.resignation.findFirst({
      where: { id, organizationId: ctx.orgId, employeeId: ctx.employeeId ?? '__none__' },
      include: LIST_INCLUDE,
    });
    if (!record) throw new NotFoundException('Resignation not found');
    return record;
  }

  private async requireReadable(ctx: Ctx, id: string) {
    const record = await this.prisma.resignation.findFirst({
      where: { id, organizationId: ctx.orgId },
      include: LIST_INCLUDE,
    });
    if (!record) throw new NotFoundException('Resignation not found');

    const isSelf = record.employeeId === ctx.employeeId;
    const isTeam =
      record.employee.managerId != null && record.employee.managerId === ctx.employeeId;
    if (
      !isSelf &&
      !ctx.perms.has('resignation.read') &&
      !(ctx.perms.has('resignation.read.team') && isTeam)
    ) {
      throw new ForbiddenException('You cannot view this resignation');
    }
    return record;
  }

  /** Adds the two facts every caller derives, so nobody derives them wrongly. */
  private present<
    T extends {
      status: ResignationStatusCode;
      routedManagerId: string | null;
      requestedLastWorkingDate: Date;
      approvedLastWorkingDate: Date | null;
      earliestLastWorkingDate: Date;
    },
  >(row: T, todayKey: string) {
    const effective = row.approvedLastWorkingDate ?? row.requestedLastWorkingDate;
    return {
      ...row,
      /**
       * Asked to leave sooner than the notice allows. Flagged rather than
       * refused: shortfalls get negotiated, and a form that rejects one just
       * moves the conversation to email.
       */
      isShortNotice:
        dateKeyOf(row.requestedLastWorkingDate) < dateKeyOf(row.earliestLastWorkingDate),
      lastWorkingDate: dateKeyOf(effective),
      daysUntilLastWorkingDate: Math.round(
        (toDate(dateKeyOf(effective)).getTime() - toDate(todayKey).getTime()) / 86_400_000,
      ),
      awaitingDesk: awaitingDesk(row.status, row.routedManagerId),
    };
  }

  /** Turns the partial unique index into the sentence the check would have given. */
  private rethrowDuplicate = (err: unknown): never => {
    const code = (err as { code?: string }).code;
    if (code === 'P2002') {
      throw new ConflictException('You already have a resignation in progress');
    }
    throw err;
  };
}
