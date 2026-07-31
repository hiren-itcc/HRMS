import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import * as argon2 from 'argon2';
import { AuthService } from './auth.service';
import type { TokenService } from './token.service';

type Mock = jest.Mock;

const meta = { ip: '127.0.0.1', userAgent: 'jest' };

function makeService() {
  const prisma = {
    user: { findUnique: jest.fn(), findUniqueOrThrow: jest.fn(), update: jest.fn() },
    passwordResetToken: { create: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
    refreshSession: { findUnique: jest.fn() },
    auditLog: { create: jest.fn() },
    $transaction: jest.fn(),
  };
  const tokens = {
    createRefreshSession: jest.fn().mockResolvedValue({ token: 'raw', session: { id: 's1' } }),
    signAccessToken: jest.fn().mockResolvedValue('jwt'),
    revokeAllForUser: jest.fn(),
    hash: jest.fn().mockReturnValue('hashed'),
  } as unknown as TokenService;
  const mail = { sendPasswordReset: jest.fn() };
  const config = { get: jest.fn().mockReturnValue('http://localhost:3000') };

  const service = new AuthService(
    // biome-ignore lint/suspicious/noExplicitAny: structural test doubles
    prisma as any,
    tokens,
    // biome-ignore lint/suspicious/noExplicitAny: structural test doubles
    mail as any,
    // biome-ignore lint/suspicious/noExplicitAny: structural test doubles
    config as any,
  );
  return { service, prisma, tokens, mail };
}

const activeUser = async (over: Record<string, unknown> = {}) => ({
  id: 'u1',
  organizationId: 'org1',
  email: 'a@b.co',
  status: 'ACTIVE',
  passwordHash: await argon2.hash('Correct-Pass1'),
  role: { code: 'EMPLOYEE', permissions: [{ permission: { code: 'leave.read.own' } }] },
  employee: null,
  ...over,
});

describe('AuthService.login', () => {
  it('rejects unknown email without leaking existence', async () => {
    const { service, prisma, tokens } = makeService();
    (prisma.user.findUnique as Mock).mockResolvedValue(null);

    await expect(service.login('no@one.co', 'x', meta)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect((tokens.createRefreshSession as Mock).mock.calls).toHaveLength(0);
  });

  it('rejects a wrong password and audits the failure', async () => {
    const { service, prisma } = makeService();
    (prisma.user.findUnique as Mock).mockResolvedValue(await activeUser());

    await expect(service.login('a@b.co', 'Wrong-Pass1', meta)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: 'auth.login_failed' }) }),
    );
  });

  it('rejects non-ACTIVE accounts even with the right password', async () => {
    const { service, prisma } = makeService();
    (prisma.user.findUnique as Mock).mockResolvedValue(await activeUser({ status: 'SUSPENDED' }));

    await expect(service.login('a@b.co', 'Correct-Pass1', meta)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('returns tokens + session user with permission claims on success', async () => {
    const { service, prisma } = makeService();
    (prisma.user.findUnique as Mock).mockResolvedValue(await activeUser());

    const result = await service.login('a@b.co', 'Correct-Pass1', meta);
    expect(result.accessToken).toBe('jwt');
    expect(result.refreshToken).toBe('raw');
    expect(result.user.permissions).toEqual(['leave.read.own']);
  });
});

describe('AuthService.resetPassword', () => {
  it('rejects an expired token', async () => {
    const { service, prisma } = makeService();
    (prisma.passwordResetToken.findUnique as Mock).mockResolvedValue({
      id: 'r1',
      userId: 'u1',
      usedAt: null,
      expiresAt: new Date(Date.now() - 1000),
      user: { organizationId: 'org1' },
    });

    await expect(service.resetPassword('tok', 'New-Password1', meta)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('rejects an already-used token', async () => {
    const { service, prisma } = makeService();
    (prisma.passwordResetToken.findUnique as Mock).mockResolvedValue({
      id: 'r1',
      userId: 'u1',
      usedAt: new Date(),
      expiresAt: new Date(Date.now() + 1000),
      user: { organizationId: 'org1' },
    });

    await expect(service.resetPassword('tok', 'New-Password1', meta)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('revokes all sessions after a successful reset', async () => {
    const { service, prisma, tokens } = makeService();
    (prisma.passwordResetToken.findUnique as Mock).mockResolvedValue({
      id: 'r1',
      userId: 'u1',
      usedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
      user: { organizationId: 'org1' },
    });
    (prisma.$transaction as Mock).mockResolvedValue([]);

    await service.resetPassword('tok', 'New-Password1', meta);
    expect(tokens.revokeAllForUser).toHaveBeenCalledWith('u1');
  });
});

describe('AuthService.changePassword', () => {
  it('rejects when the current password is wrong', async () => {
    const { service, prisma } = makeService();
    (prisma.user.findUniqueOrThrow as Mock).mockResolvedValue(await activeUser());

    await expect(
      service.changePassword('u1', 'Wrong-Pass1', 'New-Password1', undefined, meta),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('revokes other sessions but keeps the current one', async () => {
    const { service, prisma, tokens } = makeService();
    (prisma.user.findUniqueOrThrow as Mock).mockResolvedValue(await activeUser());
    (prisma.refreshSession.findUnique as Mock).mockResolvedValue({ id: 'current-session' });

    await service.changePassword('u1', 'Correct-Pass1', 'New-Password1', 'raw-refresh', meta);
    expect(tokens.revokeAllForUser).toHaveBeenCalledWith('u1', 'current-session');
  });
});
