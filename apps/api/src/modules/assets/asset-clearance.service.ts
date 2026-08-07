import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';

/**
 * Keeps an exit's `ASSET_RETURN` clearance item honest.
 *
 * This is the whole point of the module's coupling to Offboarding, and it is
 * deliberately one small class rather than logic spread across the two
 * services — the same reasoning that put every `Employee.status` write behind
 * `EmploymentTransitionService`. There is exactly one place an `ASSET_RETURN`
 * task's status changes, and it is here.
 *
 * The direction is `Offboarding → Assets`, never back. This reads the
 * `Offboarding` and `OffboardingTask` tables through Prisma directly, the way
 * `SettlementsService` already reads `Offboarding`, so no module imports this
 * one in the other direction and there is no `forwardRef` anywhere.
 *
 * `assertCleared` in the offboarding service is untouched. It already refuses
 * completion while any required task is `PENDING` and names them; making one
 * of those tasks compute itself is all this needed to be.
 */
@Injectable()
export class AssetClearanceService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Recompute the asset clearance item for whatever exit this person has open.
   *
   * A no-op for somebody who is not leaving, which is the common case — issuing
   * a laptop to a new joiner should not pay for a write.
   *
   * Called on issue, on return, on write-off, and once when an exit starts. The
   * last is what stops a leaver who was never issued anything from being
   * blocked forever by an item that would otherwise sit `PENDING`.
   */
  async sync(orgId: string, employeeId: string): Promise<void> {
    const task = await this.prisma.offboardingTask.findFirst({
      where: {
        kind: 'ASSET_RETURN',
        offboarding: { employeeId, organizationId: orgId, status: 'IN_PROGRESS' },
      },
      select: { id: true, status: true },
    });
    if (!task) return;

    // Waived by hand, with a reason. "They posted it back, write it off" is a
    // real answer and this must not undo it — the register disagreeing with a
    // decision somebody already made is worse than the register being behind.
    if (task.status === 'NOT_APPLICABLE') return;

    const outstanding = await this.outstandingCount(orgId, employeeId);
    const next = outstanding === 0 ? 'DONE' : 'PENDING';
    if (task.status === next) return;

    await this.prisma.offboardingTask.update({
      where: { id: task.id },
      data: {
        status: next,
        // Cleared by nobody at no time is what PENDING means, and the exit page
        // reads these stamps — leaving them behind would make a re-opened item
        // look signed off by whoever last returned something.
        doneAt: next === 'DONE' ? new Date() : null,
        doneById: null,
        note: next === 'DONE' ? 'Everything issued has been returned' : null,
      },
    });
  }

  /** What this person still holds. The number the clearance item is about. */
  outstandingCount(orgId: string, employeeId: string): Promise<number> {
    return this.prisma.assetAssignment.count({
      where: { employeeId, returnedOn: null, asset: { organizationId: orgId } },
    });
  }
}
