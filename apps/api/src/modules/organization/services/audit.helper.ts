import type { PrismaService } from '../../../database/prisma.service';
import type { OrgCtx } from '../org-context';

/** One audit row per org mutation (docs/02-database.md — AuditLog). */
export function auditOrgMutation(
  prisma: PrismaService,
  ctx: OrgCtx,
  action: string,
  entity: string,
  entityId: string,
): Promise<unknown> {
  return prisma.auditLog.create({
    data: { organizationId: ctx.orgId, actorId: ctx.userId, action, entity, entityId },
  });
}
