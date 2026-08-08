import type {
  NotificationEntry,
  NotificationInput,
  NotificationPreferences,
  NotificationQuery,
  Permission,
} from '@hrms/shared';
import type { AccessTokenClaims } from '@hrms/types';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PinoLogger } from 'nestjs-pino';
import { toPaginated } from '../../common/utils/list-query';
import type { Env } from '../../config/env';
import { PrismaService } from '../../database/prisma.service';
import { MailService } from '../mail/mail.service';

/**
 * A row is kept for this long. Read at query time rather than deleted by a
 * job, because there is no scheduler — the same reason the lifecycle tick
 * hangs off a request.
 */
const VISIBLE_DAYS = 90;

@Injectable()
export class NotificationsService {
  private readonly webOrigin: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly logger: PinoLogger,
    private readonly mail: MailService,
    config: ConfigService<Env, true>,
  ) {
    this.logger.setContext(NotificationsService.name);
    this.webOrigin = config.get('WEB_ORIGIN', { infer: true });
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
  async notify(
    userIds: string[],
    input: NotificationInput,
    options: { email?: boolean } = {},
  ): Promise<void> {
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

    if (options.email !== false) await this.email(recipients, input);
  }

  /**
   * The same news, by email, for the people who are not looking at the app.
   *
   * **Its own try/catch, inside a method that already never throws.** The bell
   * and the mail are two deliveries of one message and neither is allowed to
   * take the other down — a bell row that was written must not be rolled back
   * because the mail host is unreachable, and neither may reach the
   * resignation that called this.
   *
   * Two switches, and either one being off is enough: the person's own
   * `emailNotifications`, and the organization's, which is
   * `EmailTemplate.isActive` on `notification_generic` and is enforced inside
   * `sendTemplate`. Suspended and invited accounts are skipped for the reason
   * `notifyPermission` skips them — mail to an account nobody can sign in to
   * is noise.
   */
  private async email(userIds: string[], input: NotificationInput): Promise<void> {
    try {
      const users = await this.prisma.user.findMany({
        where: { id: { in: userIds }, status: 'ACTIVE', emailNotifications: true },
        select: { email: true, organizationId: true },
      });
      if (users.length === 0) return;

      const vars = {
        title: input.title,
        body: input.body ?? '',
        // Absolute, because an email has no origin of its own to resolve
        // against. Falls back to the app root when a sender gave no path.
        linkUrl: `${this.webOrigin}${input.linkPath ?? '/dashboard'}`,
      };
      await Promise.all(
        users.map((user) =>
          this.mail.sendTemplate(user.organizationId, 'notification_generic', user.email, vars),
        ),
      );
    } catch (err) {
      this.logger.warn({ err, type: input.type, count: userIds.length }, 'notify email failed');
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

  /** Whether the bell is also an email, for this person. */
  async preferences(claims: AccessTokenClaims): Promise<NotificationPreferences> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: claims.sub },
      select: { emailNotifications: true },
    });
    return { emailNotifications: user.emailNotifications };
  }

  async updatePreferences(
    claims: AccessTokenClaims,
    input: NotificationPreferences,
  ): Promise<NotificationPreferences> {
    const user = await this.prisma.user.update({
      where: { id: claims.sub },
      data: { emailNotifications: input.emailNotifications },
      select: { emailNotifications: true },
    });
    return { emailNotifications: user.emailNotifications };
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
