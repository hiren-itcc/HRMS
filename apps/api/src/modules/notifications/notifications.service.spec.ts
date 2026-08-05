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
    user: { findMany: jest.fn().mockResolvedValue([{ id: 'u-hr' }, { id: 'u-admin' }]) },
    $transaction: jest.fn((ops: unknown[]) => Promise.all(ops as Promise<unknown>[])),
  };
  const logger = { setContext: jest.fn(), warn: jest.fn(), info: jest.fn() };
  // biome-ignore lint/suspicious/noExplicitAny: structural test double
  const service = new NotificationsService(prisma, logger as any);
  return { service, prisma, logger };
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
