import type { PrismaService } from '../../database/prisma.service';

/**
 * What changed, for the rows that carry it.
 *
 * Payroll is the reason this exists: "salary revised" is useless without the
 * figure it moved from and to, and an approval trail that cannot show what was
 * approved is not a trail. Optional so the existing call sites, which have
 * nothing meaningful to record, stay as they are.
 */
export interface AuditMeta {
  before?: unknown;
  after?: unknown;
  /** Anything else worth keeping — a reopen note, a rejected reason. */
  [key: string]: unknown;
}

/** One audit row per mutation (docs/02-database.md — AuditLog). */
export function auditMutation(
  prisma: PrismaService,
  ctx: { orgId: string; userId: string },
  action: string,
  entity: string,
  entityId: string,
  meta?: AuditMeta,
): Promise<unknown> {
  return prisma.auditLog.create({
    data: {
      organizationId: ctx.orgId,
      actorId: ctx.userId,
      action,
      entity,
      entityId,
      ...(meta ? { meta: meta as object } : {}),
    },
  });
}
