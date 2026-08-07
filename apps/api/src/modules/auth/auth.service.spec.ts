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
  const logger = { setContext: jest.fn(), error: jest.fn(), warn: jest.fn() };

  const service = new AuthService(
    // biome-ignore lint/suspicious/noExplicitAny: structural test doubles
    prisma as any,
    tokens,
    // biome-ignore lint/suspicious/noExplicitAny: structural test doubles
    mail as any,
    // biome-ignore lint/suspicious/noExplicitAny: structural test doubles
    logger as any,
    // biome-ignore lint/suspicious/noExplicitAny: structural test doubles
    config as any,
  );
  return { service, prisma, tokens, mail, logger };
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

/**
 * The endpoint's whole job is to answer identically whether or not the address
 * belongs to an account. It did not: an unknown address returned, and a real
 * one threw once the mail transport refused — which surfaced as a 500 and made
 * the status code an answer to the question the endpoint exists to refuse.
 *
 * Found in production, not here, because nothing in this suite or in CI has
 * ever sent an email.
 */
describe('AuthService.forgotPassword', () => {
  it('does nothing at all for an address with no account', async () => {
    const { service, prisma, mail } = makeService();
    (prisma.user.findUnique as Mock).mockResolvedValue(null);

    await expect(service.forgotPassword('no@one.co', meta)).resolves.toBeUndefined();
    expect(prisma.passwordResetToken.create).not.toHaveBeenCalled();
    expect(mail.sendPasswordReset).not.toHaveBeenCalled();
  });

  it('writes a single-use token and mails the link for a real account', async () => {
    const { service, prisma, mail } = makeService();
    (prisma.user.findUnique as Mock).mockResolvedValue(await activeUser());

    await service.forgotPassword('a@b.co', meta);

    expect(prisma.passwordResetToken.create).toHaveBeenCalled();
    const [to, url] = (mail.sendPasswordReset as Mock).mock.calls[0];
    expect(to).toBe('a@b.co');
    expect(url).toContain('/reset-password?token=');
  });

  /*
   * The one that matters. A transport that throws must not reach the caller —
   * otherwise the response is 500 for an account that exists and 200 for one
   * that does not, which is the enumeration oracle this whole block exists to
   * close. It is invisible in a diff, so it is asserted rather than trusted.
   */
  it('does not let a failed send escape', async () => {
    const { service, prisma, mail, logger } = makeService();
    (prisma.user.findUnique as Mock).mockResolvedValue(await activeUser());
    (mail.sendPasswordReset as Mock).mockRejectedValue(
      new Error('Email could not be sent: domain not verified'),
    );

    await expect(service.forgotPassword('a@b.co', meta)).resolves.toBeUndefined();
    expect(logger.error).toHaveBeenCalled();
  });

  /* And the link still works, so the request can simply be made again. */
  it('keeps the token it already wrote when the send fails', async () => {
    const { service, prisma, mail } = makeService();
    (prisma.user.findUnique as Mock).mockResolvedValue(await activeUser());
    (mail.sendPasswordReset as Mock).mockRejectedValue(new Error('smtp down'));

    await service.forgotPassword('a@b.co', meta);

    expect(prisma.passwordResetToken.create).toHaveBeenCalled();
  });

  /*
   * Two callers, one with an account and one without, must be indistinguishable
   * from outside even when mail is broken for both.
   */
  it('is indistinguishable between a real and an unknown address', async () => {
    const { service, prisma, mail } = makeService();
    (mail.sendPasswordReset as Mock).mockRejectedValue(new Error('domain not verified'));

    (prisma.user.findUnique as Mock).mockResolvedValue(await activeUser());
    const real = await service.forgotPassword('a@b.co', meta).then(
      () => 'resolved',
      (e) => `threw:${e}`,
    );

    (prisma.user.findUnique as Mock).mockResolvedValue(null);
    const unknown = await service.forgotPassword('no@one.co', meta).then(
      () => 'resolved',
      (e) => `threw:${e}`,
    );

    expect(real).toBe(unknown);
  });

  /*
   * An invited account has no password to reset, and the link would go to a
   * work address that may not exist yet. Pinned here so the new try/catch
   * cannot quietly widen what gets mailed.
   */
  it.each(['SUSPENDED', 'INVITED'])('sends nothing to a %s account', async (status) => {
    const { service, prisma, mail } = makeService();
    (prisma.user.findUnique as Mock).mockResolvedValue(await activeUser({ status }));

    await service.forgotPassword('a@b.co', meta);

    expect(mail.sendPasswordReset).not.toHaveBeenCalled();
    expect(prisma.passwordResetToken.create).not.toHaveBeenCalled();
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
