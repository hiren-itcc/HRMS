import { createHash } from 'node:crypto';
import { BadRequestException } from '@nestjs/common';
import { InviteService } from './invite.service';

type Mock = jest.Mock;

const RAW = 'a'.repeat(64);
const HASH = createHash('sha256').update(RAW).digest('hex');

const live = () => ({
  tokenHash: HASH,
  usedAt: null,
  revokedAt: null,
  expiresAt: new Date(Date.now() + 60_000),
  employee: { firstName: 'Asha', deletedAt: null, userId: 'u9', user: { status: 'INVITED' } },
});

function makeService(invite: Record<string, unknown> | null = live()) {
  // Annotated because `$transaction` hands the double back to itself, and the
  // inferred type would be circular.
  // biome-ignore lint/suspicious/noExplicitAny: structural test double
  const prisma: any = {
    employeeInvite: {
      findUnique: jest.fn().mockResolvedValue(invite),
      findUniqueOrThrow: jest.fn().mockResolvedValue(invite),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      create: jest.fn(),
    },
    user: { update: jest.fn() },
    $transaction: jest.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(prisma)),
  };
  const mail = { sendOnboardingInvite: jest.fn() };
  const tokens = {};
  const config = { get: jest.fn().mockReturnValue('http://localhost:5173') };
  return {
    // biome-ignore lint/suspicious/noExplicitAny: structural test doubles
    service: new InviteService(prisma as any, mail as any, tokens as any, config as any),
    prisma,
    mail,
  };
}

describe('InviteService.check', () => {
  it('accepts a live token for an invited user', async () => {
    const { service } = makeService();
    await expect(service.check(RAW)).resolves.toEqual({ valid: true, name: 'Asha' });
  });

  it.each([
    ['used', { usedAt: new Date() }],
    ['revoked', { revokedAt: new Date() }],
    ['expired', { expiresAt: new Date(Date.now() - 1000) }],
  ])('refuses a %s token', async (reason, override) => {
    const { service } = makeService({ ...live(), ...override });
    await expect(service.check(RAW)).resolves.toEqual({ valid: false, reason });
  });

  it('refuses an unknown token', async () => {
    const { service } = makeService(null);
    await expect(service.check(RAW)).resolves.toEqual({ valid: false, reason: 'unknown' });
  });

  /*
   * A link forwarded to a colleague who already has an account must not become
   * a password reset for that colleague.
   */
  it('refuses a token whose user is already active', async () => {
    const invite = live();
    invite.employee.user.status = 'ACTIVE';
    const { service } = makeService(invite);
    await expect(service.check(RAW)).resolves.toEqual({ valid: false, reason: 'not-invited' });
  });

  it('refuses a token for a deleted employee', async () => {
    const invite = live();
    invite.employee.deletedAt = new Date() as never;
    const { service } = makeService(invite);
    await expect(service.check(RAW)).resolves.toEqual({ valid: false, reason: 'revoked' });
  });
});

describe('InviteService.accept', () => {
  it('sets the password and activates the account', async () => {
    const { service, prisma } = makeService();
    await expect(service.accept(RAW, 'Str0ngPassw0rd!')).resolves.toBe('u9');
    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'u9' },
        data: expect.objectContaining({ status: 'ACTIVE', mustChangePassword: false }),
      }),
    );
  });

  /*
   * The token is burned with a conditional update, so two tabs submitting at
   * once cannot both mint a session from one invitation.
   */
  it('refuses when the token was burned by a concurrent request', async () => {
    const { service, prisma } = makeService();
    (prisma.employeeInvite.updateMany as Mock).mockResolvedValue({ count: 0 });
    await expect(service.accept(RAW, 'Str0ngPassw0rd!')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('refuses an expired token before touching anything', async () => {
    const { service, prisma } = makeService({ ...live(), expiresAt: new Date(Date.now() - 1) });
    await expect(service.accept(RAW, 'Str0ngPassw0rd!')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(prisma.user.update).not.toHaveBeenCalled();
  });
});

describe('InviteService.mint', () => {
  it('revokes anything outstanding first — re-inviting kills the old link', async () => {
    const { service, prisma } = makeService();
    // biome-ignore lint/suspicious/noExplicitAny: structural test double
    await service.mint(prisma as any, {
      employeeId: 'e1',
      sentToEmail: 'a@b.com',
      createdById: 'u1',
    });
    expect(prisma.employeeInvite.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { employeeId: 'e1', usedAt: null, revokedAt: null },
        data: { revokedAt: expect.any(Date) },
      }),
    );
    expect(prisma.employeeInvite.create).toHaveBeenCalled();
  });
});

describe('unusablePasswordHash', () => {
  /*
   * Must be a real argon2 hash: login() verifies before it checks status, and
   * its uniform-timing design depends on that verify actually running. A
   * placeholder string would throw, be swallowed, and return measurably
   * faster — turning "is this account invited?" into something you can time.
   */
  it('produces an argon2id hash', async () => {
    await expect(InviteService.unusablePasswordHash()).resolves.toMatch(/^\$argon2id\$/);
  });

  it('never produces the same value twice', async () => {
    const [a, b] = await Promise.all([
      InviteService.unusablePasswordHash(),
      InviteService.unusablePasswordHash(),
    ]);
    expect(a).not.toBe(b);
  });
});
