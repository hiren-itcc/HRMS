import { UnauthorizedException } from '@nestjs/common';
import { TokenService } from './token.service';

type Mock = jest.Mock;

const meta = { ip: '127.0.0.1', userAgent: 'jest' };

function makeService() {
  const prisma = {
    refreshSession: {
      create: jest.fn().mockResolvedValue({ id: 'new-session' }),
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      update: jest.fn(),
      updateMany: jest.fn(),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    auditLog: { create: jest.fn() },
    user: {
      findUniqueOrThrow: jest.fn().mockResolvedValue({ organizationId: 'org1' }),
    },
  };
  const jwt = { signAsync: jest.fn().mockResolvedValue('jwt') };
  const config = { get: jest.fn().mockReturnValue(30) };
  const service = new TokenService(
    // biome-ignore lint/suspicious/noExplicitAny: structural test doubles
    jwt as any,
    // biome-ignore lint/suspicious/noExplicitAny: structural test doubles
    prisma as any,
    // biome-ignore lint/suspicious/noExplicitAny: structural test doubles
    config as any,
  );
  return { service, prisma };
}

describe('TokenService.rotateRefreshSession', () => {
  it('rejects an unknown token', async () => {
    const { service, prisma } = makeService();
    (prisma.refreshSession.findUnique as Mock).mockResolvedValue(null);

    await expect(service.rotateRefreshSession('nope', meta)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('rejects an expired session', async () => {
    const { service, prisma } = makeService();
    (prisma.refreshSession.findUnique as Mock).mockResolvedValue({
      id: 's1',
      userId: 'u1',
      revokedAt: null,
      expiresAt: new Date(Date.now() - 1000),
    });

    await expect(service.rotateRefreshSession('tok', meta)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('REUSE outside the grace window revokes every session for the user', async () => {
    const { service, prisma } = makeService();
    (prisma.refreshSession.findUnique as Mock).mockResolvedValue({
      id: 's1',
      userId: 'u1',
      revokedAt: new Date(Date.now() - TokenService.REUSE_GRACE_MS - 1000),
      expiresAt: new Date(Date.now() + 60_000),
    });

    await expect(service.rotateRefreshSession('stolen', meta)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(prisma.refreshSession.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ userId: 'u1' }) }),
    );
    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: 'auth.refresh_reuse_detected' }),
      }),
    );
  });

  it('concurrent refresh inside the grace window branches instead of revoking', async () => {
    const { service, prisma } = makeService();
    (prisma.refreshSession.findUnique as Mock).mockResolvedValue({
      id: 's1',
      userId: 'u1',
      revokedAt: new Date(Date.now() - 1000),
      expiresAt: new Date(Date.now() + 60_000),
    });

    const { userId, issued } = await service.rotateRefreshSession('concurrent', meta);
    expect(userId).toBe('u1');
    expect(issued.token).toHaveLength(64);
    expect(prisma.refreshSession.updateMany).not.toHaveBeenCalled();
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
  });

  it('rotates a valid session: old revoked and chained to the new one', async () => {
    const { service, prisma } = makeService();
    (prisma.refreshSession.findUnique as Mock).mockResolvedValue({
      id: 'old-session',
      userId: 'u1',
      revokedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
    });

    const { userId, issued } = await service.rotateRefreshSession('valid', meta);
    expect(userId).toBe('u1');
    expect(issued.token).toHaveLength(64);
    expect(prisma.refreshSession.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'old-session' },
        data: expect.objectContaining({ replacedById: 'new-session' }),
      }),
    );
  });
});

describe('TokenService.pruneExpired', () => {
  it('deletes only rows past expiry, and only this user’s', async () => {
    const { service, prisma } = makeService();
    (prisma.refreshSession.deleteMany as Mock).mockResolvedValue({ count: 3 });

    await service.pruneExpired('u1');

    const { where } = (prisma.refreshSession.deleteMany as Mock).mock.calls[0][0];
    expect(where.userId).toBe('u1');
    expect(where.expiresAt.lt).toBeInstanceOf(Date);
    // Revoked-but-unexpired rows must survive: reuse detection has to find the
    // session to know a replay was a replay rather than a forgery.
    expect(where).not.toHaveProperty('revokedAt');
  });

  it('runs when a session is created, so the table cannot grow unbounded', async () => {
    const { service, prisma } = makeService();
    await service.createRefreshSession('u1', meta);
    expect(prisma.refreshSession.deleteMany).toHaveBeenCalled();
  });

  it('never fails the sign-in that triggered it', async () => {
    const { service, prisma } = makeService();
    (prisma.refreshSession.deleteMany as Mock).mockRejectedValue(new Error('db down'));

    await expect(service.createRefreshSession('u1', meta)).resolves.toMatchObject({
      session: { id: 'new-session' },
    });
  });
});

describe('TokenService.listSessions', () => {
  it('returns live sessions only and never leaks the token hash', async () => {
    const { service, prisma } = makeService();
    (prisma.refreshSession.findMany as Mock).mockResolvedValue([
      { id: 's1', tokenHash: 'aaa', userAgent: 'Firefox', ip: '1.1.1.1' },
    ]);

    const [session] = await service.listSessions('u1');

    const { where } = (prisma.refreshSession.findMany as Mock).mock.calls[0][0];
    expect(where).toMatchObject({ userId: 'u1', revokedAt: null });
    expect(where.expiresAt.gt).toBeInstanceOf(Date);
    expect(session).not.toHaveProperty('tokenHash');
  });

  it('marks the device the caller is reading the list on', async () => {
    const { service, prisma } = makeService();
    const raw = 'my-token';
    (prisma.refreshSession.findMany as Mock).mockResolvedValue([
      { id: 's1', tokenHash: service.hash(raw) },
      { id: 's2', tokenHash: 'other' },
    ]);

    const sessions = await service.listSessions('u1', raw);
    expect(sessions.map((s) => s.isCurrent)).toEqual([true, false]);
  });
});

describe('TokenService.revokeSession', () => {
  it('reports wasCurrent so the controller knows to clear the cookie', async () => {
    const { service, prisma } = makeService();
    const raw = 'my-token';
    (prisma.refreshSession.findFirst as Mock).mockResolvedValue({
      id: 's1',
      tokenHash: service.hash(raw),
    });

    await expect(service.revokeSession('u1', 's1', raw)).resolves.toEqual({
      revoked: true,
      wasCurrent: true,
    });
  });

  it('finds nothing for another user’s session id, and revokes nothing', async () => {
    const { service, prisma } = makeService();
    (prisma.refreshSession.findFirst as Mock).mockResolvedValue(null);

    await expect(service.revokeSession('u1', 'theirs')).resolves.toEqual({
      revoked: false,
      wasCurrent: false,
    });
    expect(prisma.refreshSession.update).not.toHaveBeenCalled();
  });
});
