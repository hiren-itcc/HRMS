import type { PrismaService } from '../../database/prisma.service';

/** One audit row per mutation (docs/02-database.md — AuditLog). */
export function auditMutation(
  prisma: PrismaService,
  ctx: { orgId: string; userId: string },
  action: string,
  entity: string,
  entityId: string,
): Promise<unknown> {
  return prisma.auditLog.create({
    data: { organizationId: ctx.orgId, actorId: ctx.userId, action, entity, entityId },
  });
}
