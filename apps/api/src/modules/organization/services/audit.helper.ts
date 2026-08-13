import { auditMutation } from '../../../common/utils/audit';
import type { PrismaService } from '../../../database/prisma.service';
import type { OrgCtx } from '../org-context';

/**
 * One audit row per org mutation (docs/02-database.md — AuditLog).
 *
 * Delegates rather than writing its own row. It used to build the `create`
 * itself, which meant it silently missed anything added to the shared writer —
 * and it did: when `auditMutation` started recording the client IP, every
 * organization mutation would have kept writing NULL. Two writers for one table
 * is a defect that reappears, not a duplication that sits still.
 */
export function auditOrgMutation(
  prisma: PrismaService,
  ctx: OrgCtx,
  action: string,
  entity: string,
  entityId: string,
): Promise<unknown> {
  return auditMutation(prisma, ctx, action, entity, entityId);
}
