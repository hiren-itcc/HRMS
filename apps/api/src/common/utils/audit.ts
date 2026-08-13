import type { PrismaService } from '../../database/prisma.service';
import { currentRequestContext } from '../request-context';

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

/**
 * One audit row per mutation (docs/02-database.md — AuditLog).
 *
 * `userId` is nullable because some rows genuinely have no actor: the daily
 * lifecycle tick confirms probations and closes notice periods that nobody
 * pressed a button for. `AuditLog.actorId` has always been nullable; before
 * this the only way to write one was to lie about the type.
 *
 * `ip` comes from the ambient request store rather than the signature. The
 * column has existed since the first migration and `audit.service.ts` has
 * always returned it, but every row written through here was NULL — reaching
 * it meant threading a `Request` through 164 call sites that have no interest
 * in one. `ctx.ip` is still honoured when a caller supplies it, so this is a
 * default and not a hijack.
 *
 * The auth module keeps its own insert (`auth.service.ts:289`,
 * `token.service.ts:126`) and always did record an address, because a sign-in
 * event has the request in hand and its `entityId` is nullable in a way this
 * signature is not. That is the one remaining writer of this table that does
 * not come through here.
 */
export function auditMutation(
  prisma: PrismaService,
  ctx: { orgId: string; userId: string | null; ip?: string | null },
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
      ip: ctx.ip ?? currentRequestContext()?.ip ?? null,
      ...(meta ? { meta: meta as object } : {}),
    },
  });
}
