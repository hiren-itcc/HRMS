import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { PrismaService } from '../../database/prisma.service';

/**
 * Does this person actually work the desk?
 *
 * Asked in two places for the same reason, which is why it lives in one: a
 * category's default assignee and a ticket's assignee are both references that
 * route work to somebody, and routing work to somebody who cannot act on it is
 * worse than not routing it at all. Tickets land on them, nothing appears in
 * anybody else's queue, and the failure stays invisible for as long as nobody
 * asks why the desk has gone quiet.
 *
 * Resolved through the role graph rather than by role code, so an organization
 * that composed its own agent role in Settings passes without anybody editing
 * this file — the same seam `notifyPermission` uses.
 */
export async function assertWorksTheDesk(
  prisma: PrismaService,
  orgId: string,
  employeeId: string,
  refusal: string,
): Promise<void> {
  const employee = await prisma.employee.findFirst({
    where: { id: employeeId, organizationId: orgId, deletedAt: null },
    select: {
      user: {
        select: {
          status: true,
          role: { select: { permissions: { select: { permission: { select: { code: true } } } } } },
        },
      },
    },
  });
  if (!employee) throw new NotFoundException('Employee not found');

  const user = employee.user;
  const codes = new Set(user?.role.permissions.map((p) => p.permission.code) ?? []);
  /* An inactive account is not a desk either — a leaver whose role still
     carries the code would silently swallow a queue. */
  if (user?.status !== 'ACTIVE' || !codes.has('helpdesk.respond')) {
    throw new BadRequestException(refusal);
  }
}
