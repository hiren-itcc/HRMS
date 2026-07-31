import { UnauthorizedException } from '@nestjs/common';
import { TokenService } from './token.service';

type Mock = jest.Mock;

const meta = { ip: '127.0.0.1', userAgent: 'jest' };

function makeService() {
  const prisma = {
    refreshSession: {
      create: jest.fn().mockResolvedValue({ id: 'new-session' }),
      findUnique: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
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
