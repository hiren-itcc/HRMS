import type { AccessTokenClaims } from '@hrms/types';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { ReviewsService } from './reviews.service';

type Mock = jest.Mock;

const claimsFor = (over: Partial<AccessTokenClaims> = {}): AccessTokenClaims =>
  ({
    sub: 'u1',
    orgId: 'org1',
    employeeId: 'e1',
    roleCode: 'EMPLOYEE',
    perms: ['performance.read.own'],
    mustChangePassword: false,
    ...over,
  }) as AccessTokenClaims;

const cycle = {
  id: 'c1',
  name: 'H1',
  periodStart: new Date('2026-01-01'),
  periodEnd: new Date('2026-06-30'),
  dueOn: null,
  minServiceDays: 90,
  status: 'OPEN',
  openedAt: null,
  closedAt: null,
  createdAt: new Date('2026-01-01'),
};

const review = (over: Record<string, unknown> = {}) => ({
  id: 'r1',
  cycleId: 'c1',
  employeeId: 'e1',
  reviewerId: 'm1',
  status: 'PENDING_SELF',
  selfRating: null,
  selfComment: null,
  selfSubmittedAt: null,
  managerRating: null,
  managerComment: null,
  managerActions: null,
  managerSubmittedAt: null,
  sharedAt: null,
  acknowledgedAt: null,
  acknowledgeNote: null,
  createdAt: new Date('2026-01-01'),
  employee: { id: 'e1', firstName: 'Asha', lastName: 'Verma', employeeCode: 'A1' },
  reviewer: { id: 'm1', firstName: 'Meera', lastName: 'Iyer' },
  cycle,
  ...over,
});

function makeService() {
  const prisma = {
    performanceReview: {
      findFirst: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
      update: jest.fn(),
    },
    performanceGoal: { findMany: jest.fn().mockResolvedValue([]) },
    employee: { findUnique: jest.fn().mockResolvedValue({ userId: 'u2' }), findFirst: jest.fn() },
    auditLog: { create: jest.fn() },
    $transaction: jest.fn().mockResolvedValue([[], 0]),
  };
  const notifications = { notify: jest.fn(), notifyPermission: jest.fn() };
  const service = new ReviewsService(
    // biome-ignore lint/suspicious/noExplicitAny: structural test doubles
    prisma as any,
    // biome-ignore lint/suspicious/noExplicitAny: structural test doubles
    notifications as any,
  );
  return { service, prisma, notifications };
}

describe('ReviewsService scoping', () => {
  /*
   * The difference that matters, and the one somebody will try to "fix":
   * a manager's team is resolved from the reviewer *snapshot*, not from the
   * live reporting line. Goals do the opposite, deliberately.
   */
  it('resolves a manager team from reviewerId, not from the reporting line', async () => {
    const { service, prisma } = makeService();
    await service.list(
      claimsFor({ employeeId: 'm1', perms: ['performance.read.own', 'performance.read.team'] }),
      // biome-ignore lint/suspicious/noExplicitAny: query DTO shape
      { page: 1, limit: 20, order: 'desc', scope: 'team' } as any,
    );
    const where = (prisma.performanceReview.findMany as Mock).mock.calls[0][0].where;
    expect(where.reviewerId).toBe('m1');
    expect(where.employee).toBeUndefined();
  });

  /* A caller with no employee record must match nothing. `undefined` here
     would have silently matched everything, which is why the sentinel exists. */
  it('matches nothing for a token with no employee record', async () => {
    const { service, prisma } = makeService();
    await service.list(
      claimsFor({ employeeId: undefined }),
      // biome-ignore lint/suspicious/noExplicitAny: query DTO shape
      { page: 1, limit: 20, order: 'desc', scope: 'own' } as any,
    );
    const where = (prisma.performanceReview.findMany as Mock).mock.calls[0][0].where;
    expect(where.employeeId).toBe('__none__');
  });

  it('opens the whole org only to a holder of performance.read', async () => {
    const { service, prisma } = makeService();
    await service.list(
      claimsFor({ perms: ['performance.read.own', 'performance.read'] }),
      // biome-ignore lint/suspicious/noExplicitAny: query DTO shape
      { page: 1, limit: 20, order: 'desc', scope: 'all' } as any,
    );
    const where = (prisma.performanceReview.findMany as Mock).mock.calls[0][0].where;
    expect(where.employeeId).toBeUndefined();
    expect(where.reviewerId).toBeUndefined();
  });

  /* Whether a review exists is itself information about somebody's standing,
     so an unreadable one is absent rather than forbidden. */
  it('404s rather than 403s on a review the caller may not see', async () => {
    const { service, prisma } = makeService();
    (prisma.performanceReview.findFirst as Mock).mockResolvedValue(null);
    await expect(service.get(claimsFor(), 'r9')).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('the self half', () => {
  it('refuses somebody writing a self-assessment that is not theirs', async () => {
    const { service, prisma } = makeService();
    (prisma.performanceReview.findFirst as Mock).mockResolvedValue(review({ employeeId: 'e2' }));
    await expect(
      service.saveSelf(claimsFor(), 'r1', { selfRating: 4, selfComment: 'x' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('refuses submitting a self-assessment with no words', async () => {
    const { service, prisma } = makeService();
    (prisma.performanceReview.findFirst as Mock).mockResolvedValue(review());
    await expect(
      service.submitSelf(claimsFor(), 'r1', { selfRating: 4, selfComment: '' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('moves it to the manager and tells them', async () => {
    const { service, prisma, notifications } = makeService();
    (prisma.performanceReview.findFirst as Mock).mockResolvedValue(review());
    (prisma.performanceReview.update as Mock).mockResolvedValue(
      review({ status: 'PENDING_MANAGER' }),
    );

    await service.submitSelf(claimsFor(), 'r1', { selfRating: 4, selfComment: 'A fair half.' });

    expect((prisma.performanceReview.update as Mock).mock.calls[0][0].data.status).toBe(
      'PENDING_MANAGER',
    );
    expect(notifications.notify).toHaveBeenCalled();
  });

  /*
   * The orphan path. A review with no reviewer — whoever is at the top of the
   * chart — must not submit into silence; it goes to whoever can assign one.
   */
  it('tells the people who can assign a reviewer when there is none', async () => {
    const { service, prisma, notifications } = makeService();
    (prisma.performanceReview.findFirst as Mock).mockResolvedValue(review({ reviewerId: null }));
    (prisma.performanceReview.update as Mock).mockResolvedValue(
      review({ reviewerId: null, status: 'PENDING_MANAGER' }),
    );

    await service.submitSelf(claimsFor(), 'r1', { selfRating: 4, selfComment: 'Fine.' });

    expect(notifications.notifyPermission).toHaveBeenCalledWith(
      'org1',
      'performance.manage',
      expect.objectContaining({ type: 'performance.self.submitted' }),
    );
    expect(notifications.notify).not.toHaveBeenCalled();
  });
});

describe('the manager half', () => {
  const managerClaims = claimsFor({
    employeeId: 'm1',
    perms: ['performance.read.own', 'performance.read.team', 'performance.review.team'],
  });

  it('refuses somebody who is not the named reviewer', async () => {
    const { service, prisma } = makeService();
    (prisma.performanceReview.findFirst as Mock).mockResolvedValue(
      review({ status: 'PENDING_MANAGER' }),
    );
    await expect(
      service.saveManager(claimsFor({ employeeId: 'x9' }), 'r1', {
        managerRating: 4,
        managerComment: 'x',
        managerActions: null,
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('refuses sharing a rating with no words', async () => {
    const { service, prisma } = makeService();
    (prisma.performanceReview.findFirst as Mock).mockResolvedValue(
      review({ status: 'PENDING_MANAGER' }),
    );
    await expect(
      service.share(managerClaims, 'r1', {
        managerRating: 4,
        managerComment: '',
        managerActions: null,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('refuses writing your own review', async () => {
    const { service, prisma } = makeService();
    (prisma.performanceReview.findFirst as Mock).mockResolvedValue(
      review({ status: 'PENDING_MANAGER', employeeId: 'm1', reviewerId: 'm1' }),
    );
    await expect(
      service.share(managerClaims, 'r1', {
        managerRating: 5,
        managerComment: 'Excellent, obviously.',
        managerActions: null,
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('shares it and tells the employee', async () => {
    const { service, prisma, notifications } = makeService();
    (prisma.performanceReview.findFirst as Mock).mockResolvedValue(
      review({ status: 'PENDING_MANAGER' }),
    );
    (prisma.performanceReview.update as Mock).mockResolvedValue(review({ status: 'SHARED' }));

    await service.share(managerClaims, 'r1', {
      managerRating: 4,
      managerComment: 'Good half.',
      managerActions: null,
    });

    expect((prisma.performanceReview.update as Mock).mock.calls[0][0].data.status).toBe('SHARED');
    expect(notifications.notify).toHaveBeenCalledWith(
      ['u2'],
      expect.objectContaining({ type: 'performance.review.shared' }),
    );
  });

  /*
   * The leak test, and the most valuable one here. A manager's rating exists
   * from the moment they start typing; until it is shared the employee must
   * not receive it — not nulled, not hidden, absent from the payload.
   */
  it('does not put an unshared manager rating in the employee’s payload', async () => {
    const { service, prisma } = makeService();
    (prisma.performanceReview.findFirst as Mock).mockResolvedValue(
      review({
        status: 'PENDING_MANAGER',
        managerRating: 2,
        managerComment: 'Concerns about delivery.',
      }),
    );
    const result = await service.get(claimsFor(), 'r1');

    expect(result).not.toHaveProperty('managerRating');
    expect(result).not.toHaveProperty('managerComment');
    expect(JSON.stringify(result)).not.toContain('Concerns about delivery');
    expect(result.managerVisibleToEmployee).toBe(false);
  });

  it('does give it to them once it is shared', async () => {
    const { service, prisma } = makeService();
    (prisma.performanceReview.findFirst as Mock).mockResolvedValue(
      review({ status: 'SHARED', managerRating: 4, managerComment: 'Good half.' }),
    );
    const result = await service.get(claimsFor(), 'r1');
    expect(result.managerRating).toBe(4);
    expect(result.managerVisibleToEmployee).toBe(true);
  });

  /* HR reads everything, including a half-written manager assessment — that is
     what makes a dispute answerable. */
  it('gives an unshared rating to a holder of performance.read', async () => {
    const { service, prisma } = makeService();
    (prisma.performanceReview.findFirst as Mock).mockResolvedValue(
      review({ status: 'PENDING_MANAGER', managerRating: 2 }),
    );
    const result = await service.get(
      claimsFor({ employeeId: 'hr1', perms: ['performance.read.own', 'performance.read'] }),
      'r1',
    );
    expect(result.managerRating).toBe(2);
  });
});

describe('acknowledge, reopen and reassign', () => {
  it('lets only the subject sign it off', async () => {
    const { service, prisma } = makeService();
    (prisma.performanceReview.findFirst as Mock).mockResolvedValue(review({ status: 'SHARED' }));
    await expect(
      service.acknowledge(claimsFor({ employeeId: 'm1' }), 'r1', {}),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('refuses signing off something that was never shared', async () => {
    const { service, prisma } = makeService();
    (prisma.performanceReview.findFirst as Mock).mockResolvedValue(
      review({ status: 'PENDING_MANAGER' }),
    );
    await expect(service.acknowledge(claimsFor(), 'r1', {})).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  /* Reopening clears the finished-ness but the audit row remembers it. */
  it('clears sharedAt and acknowledgedAt when reopening', async () => {
    const { service, prisma } = makeService();
    (prisma.performanceReview.findFirst as Mock).mockResolvedValue(
      review({ status: 'ACKNOWLEDGED', sharedAt: new Date(), acknowledgedAt: new Date() }),
    );
    (prisma.performanceReview.update as Mock).mockResolvedValue(
      review({ status: 'PENDING_MANAGER' }),
    );
    await service.reopen(
      claimsFor({ perms: ['performance.read.own', 'performance.manage'] }),
      'r1',
      { note: 'Rating was entered against the wrong person.' },
    );
    const data = (prisma.performanceReview.update as Mock).mock.calls[0][0].data;
    expect(data.sharedAt).toBeNull();
    expect(data.acknowledgedAt).toBeNull();
    expect(prisma.auditLog.create).toHaveBeenCalled();
  });

  it('refuses making somebody their own reviewer', async () => {
    const { service, prisma } = makeService();
    (prisma.performanceReview.findFirst as Mock).mockResolvedValue(review({ reviewerId: null }));
    await expect(
      service.reassign(claimsFor({ perms: ['performance.read.own', 'performance.manage'] }), 'r1', {
        reviewerId: 'e1',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('reassigns an orphaned review and tells the new reviewer', async () => {
    const { service, prisma, notifications } = makeService();
    (prisma.performanceReview.findFirst as Mock).mockResolvedValue(
      review({ reviewerId: null, status: 'PENDING_MANAGER' }),
    );
    (prisma.employee.findFirst as Mock).mockResolvedValue({ id: 'm2', userId: 'u9' });
    (prisma.performanceReview.update as Mock).mockResolvedValue(
      review({ reviewerId: 'm2', status: 'PENDING_MANAGER' }),
    );

    await service.reassign(
      claimsFor({ perms: ['performance.read.own', 'performance.manage'] }),
      'r1',
      { reviewerId: 'm2' },
    );

    expect(notifications.notify).toHaveBeenCalledWith(
      ['u9'],
      expect.objectContaining({ type: 'performance.review.reassigned' }),
    );
  });
});
