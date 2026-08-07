import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { auditMutation } from '../../common/utils/audit';
import { dateKeyOf } from '../../common/utils/calendar';
import { PrismaService } from '../../database/prisma.service';

const nullableDateKey = (date: Date | null): string | null => (date ? dateKeyOf(date) : null);

export interface TransitionCtx {
  orgId: string;
  /** Null for the daily tick — a system action nobody pressed. */
  userId: string | null;
}

export interface TransitionInput {
  /** Where the employee lands. */
  status: 'ACTIVE' | 'ON_NOTICE' | 'EXITED';
  /** The planned or actual last working day. Null only when reinstating. */
  exitDate: string | null;
  /** Kept on the audit row; not shown to the employee. */
  reason?: string | null;
  /** Names the audit action, e.g. `employee.offboard` or `offboarding.complete`. */
  action: string;
}

/**
 * The one place employment state changes.
 *
 * Four callers reach it — HR's offboard dialog, approving a resignation,
 * completing an offboarding, and the daily tick — and all four have to do the
 * same four things or the fourth one is a bug: move the status and the date,
 * suspend the sign-in on the way out, revoke the sessions that suspension does
 * not, and leave an audit row. Written once so a caller cannot forget the
 * third.
 *
 * `exitDate` does the work, not `status`. Attendance asks
 * `isEmployedOn(date, { joinDate, exitDate })`, payroll includes anyone whose
 * exit falls inside the month so their final part-month is paid, and reports
 * span anyone employed for part of the range. The status is the label a human
 * reads; the date is what the rest of the system acts on.
 *
 * It lives in `lifecycle/` rather than in `employees/` on purpose. Everything
 * that needs it also needs `LifecyclePolicyService`, and putting it in
 * EmployeesModule would mean the tick had to import Employees while Employees
 * imported Lifecycle — a cycle, for no gain.
 */
@Injectable()
export class EmploymentTransitionService {
  constructor(private readonly prisma: PrismaService) {}

  async apply(ctx: TransitionCtx, employeeId: string, input: TransitionInput) {
    const employee = await this.prisma.employee.findFirst({
      where: { id: employeeId, organizationId: ctx.orgId, deletedAt: null },
      select: { id: true, userId: true, status: true, joinDate: true, exitDate: true },
    });
    if (!employee) throw new NotFoundException('Employee not found');

    const joinKey = dateKeyOf(employee.joinDate);
    if (input.exitDate && joinKey > input.exitDate) {
      throw new BadRequestException('The exit date cannot be before the join date');
    }

    const exiting = input.status === 'EXITED';
    const reinstating = input.status === 'ACTIVE';

    if (exiting) await this.assertNotLastAdmin(ctx.orgId, employee.userId);

    await this.prisma.$transaction([
      this.prisma.employee.update({
        where: { id: employeeId },
        data: {
          status: input.status,
          exitDate: input.exitDate ? new Date(input.exitDate) : null,
        },
      }),
      /*
       * Only EXITED touches the sign-in. Somebody on notice is still an
       * employee: they work the notice period, clock in, book leave and are
       * paid, and suspending them would be the surest way to make HR avoid
       * recording notice at all.
       */
      ...(employee.userId && exiting
        ? [
            this.prisma.user.update({
              where: { id: employee.userId },
              data: { status: 'SUSPENDED' as const },
            }),
            this.prisma.refreshSession.updateMany({
              where: { userId: employee.userId, revokedAt: null },
              data: { revokedAt: new Date() },
            }),
          ]
        : []),
      /*
       * Reinstating restores the login only from SUSPENDED. An INVITED account
       * has never been used and must stay that way — flipping it to ACTIVE
       * would hand out a working sign-in whose password nobody ever set.
       */
      ...(employee.userId && reinstating
        ? [
            this.prisma.user.updateMany({
              where: { id: employee.userId, status: 'SUSPENDED' as const },
              data: { status: 'ACTIVE' as const },
            }),
          ]
        : []),
    ]);

    await auditMutation(this.prisma, ctx, input.action, 'Employee', employeeId, {
      before: { status: employee.status, exitDate: nullableDateKey(employee.exitDate) },
      after: { status: input.status, exitDate: input.exitDate, reason: input.reason ?? null },
    });

    return { id: employeeId, status: input.status, exitDate: input.exitDate };
  }

  /**
   * Refuses to suspend the last sign-in that can administer the organization.
   *
   * Counted over ACTIVE users, for the same reason the role-change guard does:
   * a suspended admin cannot sign in, so counting them would let an already
   * offboarded one satisfy the floor and leave nobody able to get back in.
   *
   * It lives here rather than on the caller because it has to hold however the
   * exit was reached — HR pressing a button, a resignation being approved, or
   * a notice period simply running out overnight.
   */
  private async assertNotLastAdmin(orgId: string, userId: string | null) {
    if (!userId) return;
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { role: { select: { code: true } } },
    });
    if (user?.role.code !== 'ADMIN') return;

    const remaining = await this.prisma.user.count({
      where: {
        organizationId: orgId,
        status: 'ACTIVE',
        role: { code: 'ADMIN' },
        id: { not: userId },
      },
    });
    if (remaining === 0) {
      throw new BadRequestException(
        'This is the only active administrator — give somebody else the Admin role first',
      );
    }
  }
}
