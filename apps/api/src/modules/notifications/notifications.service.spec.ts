import type { AccessTokenClaims } from '@hrms/types';
import { NotificationsService } from './notifications.service';

type Mock = jest.Mock;

function makeService() {
  // biome-ignore lint/suspicious/noExplicitAny: structural test double
  const prisma: any = {
    notification: {
      createMany: jest.fn().mockResolvedValue({ count: 1 }),
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    user: {
      findMany: jest.fn().mockResolvedValue([
        { id: 'u-hr', email: 'hr@acme.test', organizationId: 'org1' },
        { id: 'u-admin', email: 'admin@acme.test', organizationId: 'org1' },
      ]),
    },
    $transaction: jest.fn((ops: unknown[]) => Promise.all(ops as Promise<unknown>[])),
  };
  const logger = { setContext: jest.fn(), warn: jest.fn(), info: jest.fn() };
  const mail = { sendTemplate: jest.fn().mockResolvedValue(true) };
  const config = { get: jest.fn().mockReturnValue('https://app.acme.test') };
  const service = new NotificationsService(
    prisma,
    // biome-ignore lint/suspicious/noExplicitAny: structural test double
    logger as any,
    // biome-ignore lint/suspicious/noExplicitAny: structural test double
    mail as any,
    // biome-ignore lint/suspicious/noExplicitAny: structural test double
    config as any,
  );
  return { service, prisma, logger, mail };
}

const claims: AccessTokenClaims = {
  sub: 'u1',
  orgId: 'org1',
  roleCode: 'EMPLOYEE',
  perms: [],
  employeeId: 'e1',
};

const payload = { type: 'resignation.submitted', title: 'Ada resigned', linkPath: '/r/1' };

describe('notify', () => {
  it('writes one row per recipient', async () => {
    const { service, prisma } = makeService();
    await service.notify(['u1', 'u2'], payload);
    expect(prisma.notification.createMany).toHaveBeenCalledWith({
      data: [
        {
          userId: 'u1',
          type: 'resignation.submitted',
          title: 'Ada resigned',
          body: null,
          linkPath: '/r/1',
        },
        {
          userId: 'u2',
          type: 'resignation.submitted',
          title: 'Ada resigned',
          body: null,
          linkPath: '/r/1',
        },
      ],
    });
  });

  /* Somebody who is both the routed manager and an HR holder must not get two. */
  it('deduplicates recipients', async () => {
    const { service, prisma } = makeService();
    await service.notify(['u1', 'u1', 'u2'], payload);
    expect((prisma.notification.createMany as Mock).mock.calls[0][0].data).toHaveLength(2);
  });

  it('does nothing at all when there is nobody to tell', async () => {
    const { service, prisma } = makeService();
    await service.notify([], payload);
    await service.notify([''], payload);
    expect(prisma.notification.createMany).not.toHaveBeenCalled();
  });

  /*
   * The one that matters. This is called inside the success path of a
   * resignation, an approval, an exit. A dropped notification is a missed
   * bell; a resignation that fails to submit because of one is a broken
   * product.
   */
  it('never throws, whatever the database does', async () => {
    const { service, prisma, logger } = makeService();
    (prisma.notification.createMany as Mock).mockRejectedValue(new Error('db down'));
    await expect(service.notify(['u1'], payload)).resolves.toBeUndefined();
    expect(logger.warn).toHaveBeenCalled();
  });
});

/**
 * The bell and the mail are two deliveries of one message. Until this shipped
 * there was only the bell, so approving somebody's leave or accepting their
 * resignation reached nobody who was not looking at the app.
 */
describe('notify by email', () => {
  it('emails every recipient, with an absolute link', async () => {
    const { service, mail } = makeService();
    await service.notify(['u-hr', 'u-admin'], payload);

    expect(mail.sendTemplate).toHaveBeenCalledTimes(2);
    expect(mail.sendTemplate).toHaveBeenCalledWith(
      'org1',
      'notification_generic',
      'hr@acme.test',
      // An email has no origin of its own to resolve a path against.
      expect.objectContaining({ linkUrl: 'https://app.acme.test/r/1' }),
    );
  });

  /* A sender that gave no path still has to land somewhere openable. */
  it('falls back to the dashboard when a sender gave no link', async () => {
    const { service, mail } = makeService();
    await service.notify(['u-hr'], { type: 'x', title: 'Something happened' });
    expect(mail.sendTemplate).toHaveBeenCalledWith(
      'org1',
      'notification_generic',
      expect.any(String),
      expect.objectContaining({ linkUrl: 'https://app.acme.test/dashboard' }),
    );
  });

  /*
   * Two switches, and the query is where both are enforced: the person's own
   * `emailNotifications`, and — inside `sendTemplate` — the organization's
   * `EmailTemplate.isActive`.
   */
  it('asks only for active accounts that have not opted out', async () => {
    const { service, prisma } = makeService();
    await service.notify(['u-hr'], payload);
    const where = (prisma.user.findMany as Mock).mock.calls[0][0].where;
    expect(where.status).toBe('ACTIVE');
    expect(where.emailNotifications).toBe(true);
  });

  /* For a caller that sends its own, richer template. Leave is the first. */
  it('sends nothing when the caller says it will do it itself', async () => {
    const { service, mail, prisma } = makeService();
    await service.notify(['u-hr'], payload, { email: false });
    expect(mail.sendTemplate).not.toHaveBeenCalled();
    // The bell still rang.
    expect(prisma.notification.createMany).toHaveBeenCalled();
  });

  /*
   * The whole bargain, extended to the second delivery. A dead mail host must
   * not reach the resignation that called this — nor undo the bell row that
   * was already written.
   */
  it('still resolves when the mail transport rejects', async () => {
    const { service, mail, logger, prisma } = makeService();
    (mail.sendTemplate as Mock).mockRejectedValue(new Error('smtp down'));
    await expect(service.notify(['u-hr'], payload)).resolves.toBeUndefined();
    expect(prisma.notification.createMany).toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalled();
  });
});

describe('notifyPermission', () => {
  /*
   * Resolved through the role graph, not by role code, so an organization that
   * composes a custom role in Settings → Roles is notified without anybody
   * editing the sender.
   */
  it('finds recipients by the permission their role grants', async () => {
    const { service, prisma } = makeService();
    await service.notifyPermission('org1', 'resignation.approve', payload);
    expect(prisma.user.findMany).toHaveBeenCalledWith({
      where: {
        organizationId: 'org1',
        status: 'ACTIVE',
        role: { permissions: { some: { permission: { code: 'resignation.approve' } } } },
      },
      select: { id: true },
    });
    expect((prisma.notification.createMany as Mock).mock.calls[0][0].data).toHaveLength(2);
  });

  /* Nobody needs telling about the thing they just did. */
  it('can exclude the actor', async () => {
    const { service, prisma } = makeService();
    await service.notifyPermission('org1', 'resignation.approve', payload, { except: 'u-hr' });
    expect(prisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: { not: 'u-hr' } }),
      }),
    );
  });

  /* A notification nobody can sign in to read is noise in a table. */
  it('skips suspended and invited accounts', async () => {
    const { service, prisma } = makeService();
    await service.notifyPermission('org1', 'resignation.approve', payload);
    expect((prisma.user.findMany as Mock).mock.calls[0][0].where.status).toBe('ACTIVE');
  });

  it('never throws either', async () => {
    const { service, prisma, logger } = makeService();
    (prisma.user.findMany as Mock).mockRejectedValue(new Error('db down'));
    await expect(
      service.notifyPermission('org1', 'resignation.approve', payload),
    ).resolves.toBeUndefined();
    expect(logger.warn).toHaveBeenCalled();
  });
});

describe('reads are scoped to the token subject', () => {
  it('lists only the caller’s own', async () => {
    const { service, prisma } = makeService();
    await service.list(claims, { page: 1, limit: 20, order: 'asc' });
    expect((prisma.notification.findMany as Mock).mock.calls[0][0].where.userId).toBe('u1');
  });

  it('filters to unread when asked', async () => {
    const { service, prisma } = makeService();
    await service.list(claims, { page: 1, limit: 20, order: 'asc', unreadOnly: true });
    expect((prisma.notification.findMany as Mock).mock.calls[0][0].where.readAt).toBeNull();
  });

  /*
   * `updateMany` with the subject in the `where`, not findUnique-then-update:
   * somebody else's id matches nothing and reports nothing, rather than 404ing
   * in a way that confirms the row exists.
   */
  it('cannot mark somebody else’s notification read', async () => {
    const { service, prisma } = makeService();
    (prisma.notification.updateMany as Mock).mockResolvedValue({ count: 0 });
    const result = await service.markRead(claims, 'someone-elses');
    expect(prisma.notification.updateMany).toHaveBeenCalledWith({
      where: { id: 'someone-elses', userId: 'u1', readAt: null },
      data: { readAt: expect.any(Date) },
    });
    expect(result).toEqual({ updated: 0 });
  });

  it('marks everything read for the caller only', async () => {
    const { service, prisma } = makeService();
    await service.markAllRead(claims);
    expect(prisma.notification.updateMany).toHaveBeenCalledWith({
      where: { userId: 'u1', readAt: null },
      data: { readAt: expect.any(Date) },
    });
  });

  /* Retention is a query bound, because there is no scheduler to prune with. */
  it('hides rows older than the retention window', async () => {
    const { service, prisma } = makeService();
    await service.unreadCount(claims);
    const horizon = (prisma.notification.count as Mock).mock.calls[0][0].where.createdAt.gte;
    const days = (Date.now() - horizon.getTime()) / 86_400_000;
    expect(Math.round(days)).toBe(90);
  });
});
