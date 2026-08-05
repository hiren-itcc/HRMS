import type {
  SettlementApproveInput,
  SettlementCancelInput,
  SettlementCreateInput,
  SettlementLineCreateInput,
  SettlementLineUpdateInput,
  SettlementPayInput,
  SettlementQuery,
  SettlementStatusCode,
} from '@hrms/shared';
import { COMPONENT_CODES } from '@hrms/shared';
import type { AccessTokenClaims } from '@hrms/types';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { auditMutation } from '../../common/utils/audit';
import { dateKeyOf, leaveYearOf, toDate } from '../../common/utils/calendar';
import { buildListArgs, toPaginated } from '../../common/utils/list-query';
import { PrismaService } from '../../database/prisma.service';
import type { Prisma } from '../../generated/prisma/client';
import { AuditService } from '../audit/audit.service';
import { availableDays } from '../leave/leave.util';
import { NotificationsService } from '../notifications/notifications.service';
import { resolveEarnings } from '../payroll/payroll.calc';
import { SettingsService } from '../settings/settings.service';
import {
  encashmentLines,
  gratuityFor,
  noticeShortfallDays,
  perDayRate,
  settlementTotals,
} from './settlement.calc';
import { canEditLines, canTransition, editError, transitionError } from './settlement.workflow';

const SORTABLE = ['lastWorkingDate', 'netPayable', 'status', 'createdAt'] as const;

const LIST_INCLUDE = {
  employee: {
    select: {
      id: true,
      firstName: true,
      lastName: true,
      employeeCode: true,
      avatarUrl: true,
      workEmail: true,
    },
  },
  offboarding: { select: { id: true, reason: true, status: true } },
  lines: { orderBy: { order: 'asc' } },
} as const;

interface Ctx {
  orgId: string;
  userId: string | null;
}

/** A line as the calculator produced it, before it becomes a row. */
interface ComputedLine {
  kind: 'EARNING' | 'DEDUCTION';
  source: 'LEAVE_ENCASHMENT' | 'NOTICE_RECOVERY' | 'GRATUITY';
  label: string;
  basis: string | null;
  amount: number;
}

const money = (n: number) => `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
const days = (n: number) => `${n} day${n === 1 ? '' : 's'}`;

/**
 * What a leaver is owed, and the trail of somebody agreeing to it.
 *
 * Routed under `/payroll` rather than `/offboardings`, which is deliberate:
 * Finance holds `payroll.approve` and `payroll.pay` but not
 * `employee.offboard`. Hanging the settlement off the exit record would have
 * meant handing Finance read access to every offboarding in the company just so
 * they could release one payment.
 *
 * Prepared on demand rather than when the exit starts. A settlement computed
 * the day notice begins is priced off a leave balance with two months left to
 * move, and would be wrong by the time anybody read it.
 */
@Injectable()
export class SettlementsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly notifications: NotificationsService,
    private readonly audit: AuditService,
  ) {}

  // ── compute ───────────────────────────────────────────────────────────

  /** Prepare the settlement for an exit. One per offboarding, ever. */
  async create(claims: AccessTokenClaims, input: SettlementCreateInput) {
    const ctx: Ctx = { orgId: claims.orgId, userId: claims.sub };

    const existing = await this.prisma.settlement.findFirst({
      where: { offboardingId: input.offboardingId, organizationId: ctx.orgId },
      select: { id: true },
    });
    if (existing) {
      throw new ConflictException('This exit already has a settlement');
    }

    const { lines, snapshot } = await this.computeFor(ctx.orgId, input.offboardingId);
    const totals = settlementTotals(lines);

    const created = await this.prisma.settlement.create({
      data: {
        organizationId: ctx.orgId,
        offboardingId: input.offboardingId,
        employeeId: snapshot.employeeId,
        lastWorkingDate: toDate(snapshot.lastWorkingDate),
        joinDate: toDate(snapshot.joinDate),
        monthlyPay: snapshot.monthlyPay,
        perDayRate: snapshot.perDayRate,
        totalEarnings: totals.totalEarnings,
        totalDeductions: totals.totalDeductions,
        netPayable: totals.netPayable,
        notes: input.notes ?? null,
        computedAt: new Date(),
        lines: { create: lines.map((line, index) => ({ ...line, order: index })) },
      },
      include: LIST_INCLUDE,
    });

    await auditMutation(this.prisma, ctx, 'settlement.compute', 'Settlement', created.id, {
      after: {
        status: 'DRAFT',
        netPayable: totals.netPayable,
        lines: lines.length,
      },
    });
    return created;
  }

  /**
   * Throw the computed lines away and work them out again.
   *
   * Destructive, and DRAFT-only — the same bargain `payroll-runs.calculate()`
   * makes. Manual lines survive: a retention bonus somebody negotiated is not
   * something the calculator can derive a second time, and silently deleting it
   * would be the worst possible way to find that out.
   */
  async recompute(claims: AccessTokenClaims, id: string) {
    const ctx: Ctx = { orgId: claims.orgId, userId: claims.sub };
    const record = await this.requireEditable(ctx.orgId, id);

    const { lines, snapshot } = await this.computeFor(ctx.orgId, record.offboardingId);

    const manual = await this.prisma.settlementLine.findMany({
      where: { settlementId: id, source: 'MANUAL' },
      orderBy: { order: 'asc' },
    });
    const totals = settlementTotals([
      ...lines,
      ...manual.map((l) => ({ ...l, amount: +l.amount })),
    ]);

    await this.prisma.$transaction([
      this.prisma.settlementLine.deleteMany({
        where: { settlementId: id, source: { not: 'MANUAL' } },
      }),
      this.prisma.settlementLine.createMany({
        data: lines.map((line, index) => ({ ...line, settlementId: id, order: index })),
      }),
      // Manual lines keep their relative order but sort after the computed
      // ones, so a recompute cannot interleave them.
      ...manual.map((line, index) =>
        this.prisma.settlementLine.update({
          where: { id: line.id },
          data: { order: lines.length + index },
        }),
      ),
      this.prisma.settlement.update({
        where: { id },
        data: {
          lastWorkingDate: toDate(snapshot.lastWorkingDate),
          joinDate: toDate(snapshot.joinDate),
          monthlyPay: snapshot.monthlyPay,
          perDayRate: snapshot.perDayRate,
          ...totals,
          computedAt: new Date(),
        },
      }),
    ]);

    await auditMutation(this.prisma, ctx, 'settlement.recompute', 'Settlement', id, {
      before: { netPayable: +record.netPayable },
      after: { netPayable: totals.netPayable, keptManualLines: manual.length },
    });
    return this.detail(claims, id);
  }

  /**
   * The arithmetic, against the database. Everything it decides is handed to
   * `settlement.calc.ts`, which is pure — this half only fetches.
   */
  private async computeFor(orgId: string, offboardingId: string) {
    const offboarding = await this.prisma.offboarding.findFirst({
      where: { id: offboardingId, organizationId: orgId },
      include: {
        resignation: {
          select: { earliestLastWorkingDate: true, approvedLastWorkingDate: true },
        },
        employee: {
          select: { id: true, joinDate: true },
        },
      },
    });
    if (!offboarding) throw new NotFoundException('Offboarding not found');
    if (offboarding.status === 'CANCELLED') {
      throw new BadRequestException('This exit was cancelled — there is nothing to settle');
    }

    const config = (await this.settings.get(orgId)).settlement;
    const leaveConfig = (await this.settings.get(orgId)).leave;
    const lastWorkingDate = dateKeyOf(offboarding.lastWorkingDate);
    const joinDate = dateKeyOf(offboarding.employee.joinDate);

    const monthlyPay = await this.monthlyPayAsAt(
      offboarding.employeeId,
      lastWorkingDate,
      config.rateBasis,
    );
    const rate = perDayRate(monthlyPay, lastWorkingDate.slice(0, 7), config.perDayBasis);

    const lines: ComputedLine[] = [];

    // ── leave encashment ──
    const balances = await this.prisma.leaveBalance.findMany({
      where: {
        employeeId: offboarding.employeeId,
        year: leaveYearOf(lastWorkingDate, leaveConfig.yearStartMonth),
        leaveType: { encashable: true },
      },
      include: { leaveType: { select: { id: true, code: true, name: true, encashable: true } } },
    });

    for (const line of encashmentLines(
      balances.map((b) => ({
        leaveTypeId: b.leaveTypeId,
        code: b.leaveType.code,
        name: b.leaveType.name,
        encashable: b.leaveType.encashable,
        availableDays: availableDays({
          allocated: +b.allocated,
          carriedOver: +b.carriedOver,
          used: +b.used,
        }),
      })),
      rate,
    )) {
      lines.push({
        kind: 'EARNING',
        source: 'LEAVE_ENCASHMENT',
        label: `${line.name} encashment`,
        basis: `${days(line.days)} × ${money(rate)}`,
        amount: line.amount,
      });
    }

    // ── notice recovery ──
    // Null for an exit the employee did not choose. A termination owes notice
    // rather than collecting it, and passing null is how the calculator is told.
    const earliest = offboarding.resignation
      ? dateKeyOf(offboarding.resignation.earliestLastWorkingDate)
      : null;
    const shortfall = config.recoverShortNotice
      ? noticeShortfallDays(lastWorkingDate, earliest)
      : 0;
    if (shortfall > 0) {
      lines.push({
        kind: 'DEDUCTION',
        source: 'NOTICE_RECOVERY',
        label: 'Notice period recovery',
        basis: `${days(shortfall)} short × ${money(rate)}`,
        amount: Math.round(shortfall * rate * 100) / 100,
      });
    }

    // ── gratuity ──
    const gratuity = gratuityFor(joinDate, lastWorkingDate, monthlyPay, config.gratuity);
    if (gratuity.eligible && gratuity.amount > 0) {
      const formula = `${config.gratuity.daysPerYear}/${config.gratuity.divisor} × ${money(monthlyPay)} × ${gratuity.years} years`;
      lines.push({
        kind: 'EARNING',
        source: 'GRATUITY',
        label: 'Gratuity',
        basis: gratuity.cappedFrom
          ? `${formula}, capped at ${money(config.gratuity.cap)}`
          : formula,
        amount: gratuity.amount,
      });
    }

    return {
      lines,
      snapshot: {
        employeeId: offboarding.employeeId,
        lastWorkingDate,
        joinDate,
        monthlyPay,
        perDayRate: rate,
      },
    };
  }

  /**
   * The monthly figure the day rate is priced off, as at the last working day.
   *
   * Resolved through `resolveEarnings` rather than read off `monthlyCtc`,
   * because CTC includes employer contributions that were never anybody's pay.
   * Zero when they have no salary on record — which produces a settlement of
   * zero rather than a crash, and HR sees an obviously wrong number and fixes
   * the salary, which is the failure mode worth having.
   */
  private async monthlyPayAsAt(
    employeeId: string,
    dateKey: string,
    basis: 'BASIC' | 'GROSS',
  ): Promise<number> {
    const salary = await this.prisma.employeeSalary.findFirst({
      where: { employeeId, effectiveFrom: { lte: toDate(dateKey) } },
      orderBy: { effectiveFrom: 'desc' },
      include: { structure: { include: { lines: { include: { component: true } } } } },
    });
    if (!salary) return 0;

    const earnings = resolveEarnings(
      salary.structure.lines.map((line) => ({
        code: line.component.code,
        name: line.component.name,
        kind: line.component.kind,
        calcType: line.calcType,
        value: Number(line.value),
        order: line.order,
      })),
      Number(salary.monthlyCtc),
    );

    if (basis === 'BASIC') return earnings.get(COMPONENT_CODES.BASIC) ?? 0;
    return Math.round([...earnings.values()].reduce((sum, n) => sum + n, 0) * 100) / 100;
  }

  // ── lines ─────────────────────────────────────────────────────────────

  /** Change a figure. Recorded as an override, so the statement can say so. */
  async updateLine(
    claims: AccessTokenClaims,
    id: string,
    lineId: string,
    input: SettlementLineUpdateInput,
  ) {
    const ctx: Ctx = { orgId: claims.orgId, userId: claims.sub };
    await this.requireEditable(ctx.orgId, id);
    const line = await this.requireLine(id, lineId);

    await this.prisma.settlementLine.update({
      where: { id: lineId },
      data: {
        amount: input.amount,
        ...(input.label ? { label: input.label } : {}),
        ...(input.basis !== undefined ? { basis: input.basis } : {}),
        // A manual line was always somebody's own figure; marking it overridden
        // would put "changed from the computed amount" on a line that never
        // had one.
        overridden: line.source !== 'MANUAL',
      },
    });

    await auditMutation(this.prisma, ctx, 'settlement.line.override', 'Settlement', id, {
      before: { label: line.label, amount: +line.amount },
      after: { label: input.label ?? line.label, amount: input.amount },
    });
    return this.retotal(claims, id);
  }

  async addLine(claims: AccessTokenClaims, id: string, input: SettlementLineCreateInput) {
    const ctx: Ctx = { orgId: claims.orgId, userId: claims.sub };
    await this.requireEditable(ctx.orgId, id);

    const last = await this.prisma.settlementLine.findFirst({
      where: { settlementId: id },
      orderBy: { order: 'desc' },
      select: { order: true },
    });

    await this.prisma.settlementLine.create({
      data: {
        settlementId: id,
        kind: input.kind,
        // Always MANUAL. A computed source added by hand would be destroyed by
        // the next recompute, which is a trap rather than a feature.
        source: 'MANUAL',
        label: input.label,
        basis: input.basis ?? null,
        amount: input.amount,
        order: (last?.order ?? -1) + 1,
      },
    });

    await auditMutation(this.prisma, ctx, 'settlement.line.add', 'Settlement', id, {
      after: { kind: input.kind, label: input.label, amount: input.amount },
    });
    return this.retotal(claims, id);
  }

  async removeLine(claims: AccessTokenClaims, id: string, lineId: string) {
    const ctx: Ctx = { orgId: claims.orgId, userId: claims.sub };
    await this.requireEditable(ctx.orgId, id);
    const line = await this.requireLine(id, lineId);

    await this.prisma.settlementLine.delete({ where: { id: lineId } });

    await auditMutation(this.prisma, ctx, 'settlement.line.remove', 'Settlement', id, {
      before: { kind: line.kind, label: line.label, amount: +line.amount },
    });
    return this.retotal(claims, id);
  }

  /** The three figures at the bottom, after any line moved. */
  private async retotal(claims: AccessTokenClaims, id: string) {
    const lines = await this.prisma.settlementLine.findMany({
      where: { settlementId: id },
      select: { kind: true, amount: true },
    });
    await this.prisma.settlement.update({
      where: { id },
      data: settlementTotals(lines.map((l) => ({ kind: l.kind, amount: +l.amount }))),
    });
    return this.detail(claims, id);
  }

  // ── workflow ──────────────────────────────────────────────────────────

  async approve(claims: AccessTokenClaims, id: string, input: SettlementApproveInput) {
    const ctx: Ctx = { orgId: claims.orgId, userId: claims.sub };
    const record = await this.requireTransition(ctx.orgId, id, 'APPROVED');

    const updated = await this.prisma.settlement.update({
      where: { id },
      data: {
        status: 'APPROVED',
        approvedAt: new Date(),
        approvedById: ctx.userId,
        ...(input.notes !== undefined ? { notes: input.notes } : {}),
      },
      include: LIST_INCLUDE,
    });

    await auditMutation(this.prisma, ctx, 'settlement.approve', 'Settlement', id, {
      before: { status: record.status },
      after: { status: 'APPROVED', netPayable: +record.netPayable },
      note: input.notes ?? null,
    });

    /*
     * Whoever can pay it, not the leaver: their sign-in is suspended the moment
     * the exit completes, so a notification for them would land in an account
     * nobody can open. The statement is handed over instead.
     */
    const who = `${updated.employee.firstName} ${updated.employee.lastName}`;
    await this.notifications.notifyPermission(
      ctx.orgId,
      'payroll.pay',
      {
        type: 'settlement.approved',
        title: `Settlement approved for ${who}`,
        body: `${money(+updated.netPayable)} is ready to be released.`,
        linkPath: `/payroll/settlements/${id}`,
      },
      { except: ctx.userId },
    );
    return updated;
  }

  async pay(claims: AccessTokenClaims, id: string, input: SettlementPayInput) {
    const ctx: Ctx = { orgId: claims.orgId, userId: claims.sub };
    const record = await this.requireTransition(ctx.orgId, id, 'PAID');

    const updated = await this.prisma.settlement.update({
      where: { id },
      data: {
        status: 'PAID',
        paidAt: input.paidOn ? toDate(input.paidOn) : new Date(),
        paidById: ctx.userId,
        paymentRef: input.paymentRef,
      },
      include: LIST_INCLUDE,
    });

    await auditMutation(this.prisma, ctx, 'settlement.pay', 'Settlement', id, {
      before: { status: record.status },
      after: {
        status: 'PAID',
        netPayable: +record.netPayable,
        paymentRef: input.paymentRef,
        paidOn: input.paidOn ?? dateKeyOf(new Date()),
      },
    });
    return updated;
  }

  /**
   * Cancelled rather than deleted. An exit called off still leaves the fact
   * that a settlement was once prepared, and a row somebody can read beats a
   * gap they have to reconstruct.
   */
  async cancel(claims: AccessTokenClaims, id: string, input: SettlementCancelInput) {
    const ctx: Ctx = { orgId: claims.orgId, userId: claims.sub };
    const record = await this.requireTransition(ctx.orgId, id, 'CANCELLED');

    const updated = await this.prisma.settlement.update({
      where: { id },
      data: { status: 'CANCELLED', cancelledAt: new Date(), cancelReason: input.reason },
      include: LIST_INCLUDE,
    });

    await auditMutation(this.prisma, ctx, 'settlement.cancel', 'Settlement', id, {
      before: { status: record.status },
      after: { status: 'CANCELLED' },
      note: input.reason,
    });
    return updated;
  }

  // ── reads ─────────────────────────────────────────────────────────────

  async list(claims: AccessTokenClaims, query: SettlementQuery) {
    const where: Prisma.SettlementWhereInput = {
      organizationId: claims.orgId,
      ...(query.status ? { status: query.status } : {}),
      ...(query.employeeId ? { employeeId: query.employeeId } : {}),
    };
    const [data, total] = await this.prisma.$transaction([
      this.prisma.settlement.findMany({
        where,
        include: LIST_INCLUDE,
        ...buildListArgs(query, SORTABLE, 'lastWorkingDate'),
      }),
      this.prisma.settlement.count({ where }),
    ]);
    return toPaginated(data, total, query);
  }

  async detail(claims: AccessTokenClaims, id: string) {
    const record = await this.prisma.settlement.findFirst({
      where: { id, organizationId: claims.orgId },
      include: LIST_INCLUDE,
    });
    if (!record) throw new NotFoundException('Settlement not found');
    return record;
  }

  /** For the exit page's card — null rather than a 404 when none exists yet. */
  async forOffboarding(claims: AccessTokenClaims, offboardingId: string) {
    return this.prisma.settlement.findFirst({
      where: { offboardingId, organizationId: claims.orgId },
      include: LIST_INCLUDE,
    });
  }

  async activity(claims: AccessTokenClaims, id: string) {
    await this.detail(claims, id);
    return this.audit.forEntity(claims.orgId, 'Settlement', id);
  }

  // ── guards ────────────────────────────────────────────────────────────

  private async require(orgId: string, id: string) {
    const record = await this.prisma.settlement.findFirst({ where: { id, organizationId: orgId } });
    if (!record) throw new NotFoundException('Settlement not found');
    return record;
  }

  private async requireEditable(orgId: string, id: string) {
    const record = await this.require(orgId, id);
    if (!canEditLines(record.status)) {
      throw new BadRequestException(editError(record.status));
    }
    return record;
  }

  private async requireTransition(orgId: string, id: string, to: SettlementStatusCode) {
    const record = await this.require(orgId, id);
    if (!canTransition(record.status, to)) {
      throw new BadRequestException(transitionError(record.status, to));
    }
    return record;
  }

  private async requireLine(settlementId: string, lineId: string) {
    const line = await this.prisma.settlementLine.findFirst({
      where: { id: lineId, settlementId },
    });
    if (!line) throw new NotFoundException('Settlement line not found');
    return line;
  }
}
