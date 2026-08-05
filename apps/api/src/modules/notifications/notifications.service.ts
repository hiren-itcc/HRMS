import type {
  NotificationEntry,
  NotificationInput,
  NotificationQuery,
  Permission,
} from '@hrms/shared';
import type { AccessTokenClaims } from '@hrms/types';
import { Injectable } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { toPaginated } from '../../common/utils/list-query';
import { PrismaService } from '../../database/prisma.service';

/**
 * A row is kept for this long. Read at query time rather than deleted by a
 * job, because there is no scheduler — the same reason the lifecycle tick
 * hangs off a request.
 */
const VISIBLE_DAYS = 90;

@Injectable()
export class NotificationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(NotificationsService.name);
  }

  /**
   * Tell some people something happened.
   *
   * **This never throws.** It is called from inside the success path of a
   * resignation, an approval, an exit — actions that must not fail because a
   * notification row could not be written. A dropped notification is a missed
   * bell; a rejected resignation because of one is a broken product. Same
   * bargain `LifecycleService.tickIfDue` makes.
   *
   * Not awaited by most callers either, so the failure has nowhere to surface
   * except this log line.
   */
  async notify(userIds: string[], input: NotificationInput): Promise<void> {
    const recipients = [...new Set(userIds.filter(Boolean))];
    if (recipients.length === 0) return;
    try {
      await this.prisma.notification.createMany({
        data: recipients.map((userId) => ({
          userId,
          type: input.type,
          title: input.title,
          body: input.body ?? null,
          linkPath: input.linkPath ?? null,
        })),
      });
    } catch (err) {
      this.logger.warn({ err, type: input.type, count: recipients.length }, 'notify failed');
    }
  }

  /**
   * Tell whoever holds a permission — "tell HR" without naming HR.
   *
   * Resolved through the role graph rather than by role code, so an
   * organization that composes a custom role in Settings → Roles gets its
   * notifications without anybody editing this file. Suspended and invited
   * accounts are skipped: a notification nobody can sign in to read is noise
   * in a table.
   */
  async notifyPermission(
    orgId: string,
    permission: Permission,
    input: NotificationInput,
    options: { except?: string | null } = {},
  ): Promise<void> {
    try {
      const users = await this.prisma.user.findMany({
        where: {
          organizationId: orgId,
          status: 'ACTIVE',
          role: { permissions: { some: { permission: { code: permission } } } },
          ...(options.except ? { id: { not: options.except } } : {}),
        },
        select: { id: true },
      });
      await this.notify(
        users.map((u) => u.id),
        input,
      );
    } catch (err) {
      this.logger.warn({ err, permission, type: input.type }, 'notifyPermission failed');
    }
  }

  // ── reads, all scoped to the JWT subject ──────────────────────────────

  async list(claims: AccessTokenClaims, query: NotificationQuery) {
    const where = {
      userId: claims.sub,
      createdAt: { gte: this.horizon() },
      ...(query.unreadOnly ? { readAt: null } : {}),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      this.prisma.notification.count({ where }),
    ]);
    return toPaginated(rows.map(toEntry), total, query);
  }

  async unreadCount(claims: AccessTokenClaims) {
    const unread = await this.prisma.notification.count({
      where: { userId: claims.sub, readAt: null, createdAt: { gte: this.horizon() } },
    });
    return { unread };
  }

  /**
   * `updateMany` with the subject in the `where`, not `findUnique` then
   * `update`: an id belonging to somebody else matches nothing and reports
   * nothing, rather than 404-ing in a way that confirms the row exists.
   */
  async markRead(claims: AccessTokenClaims, id: string) {
    const { count } = await this.prisma.notification.updateMany({
      where: { id, userId: claims.sub, readAt: null },
      data: { readAt: new Date() },
    });
    return { updated: count };
  }

  async markAllRead(claims: AccessTokenClaims) {
    const { count } = await this.prisma.notification.updateMany({
      where: { userId: claims.sub, readAt: null },
      data: { readAt: new Date() },
    });
    return { updated: count };
  }

  private horizon(): Date {
    return new Date(Date.now() - VISIBLE_DAYS * 86_400_000);
  }
}

function toEntry(row: {
  id: string;
  type: string;
  title: string;
  body: string | null;
  linkPath: string | null;
  readAt: Date | null;
  createdAt: Date;
}): NotificationEntry {
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    body: row.body,
    linkPath: row.linkPath,
    readAt: row.readAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}
