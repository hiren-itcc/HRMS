import { createHash, randomBytes } from 'node:crypto';
import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as argon2 from 'argon2';
import type { Env } from '../../config/env';
import { PrismaService } from '../../database/prisma.service';
import type { Prisma } from '../../generated/prisma/client';
import { MailService } from '../mail/mail.service';
import { TokenService } from './token.service';

/** A week. Long enough to survive a weekend and a forwarded email. */
export const INVITE_TTL_DAYS = 7;
const INVITE_TTL_MS = INVITE_TTL_DAYS * 24 * 60 * 60 * 1000;

export type InviteRejection = 'unknown' | 'expired' | 'used' | 'revoked' | 'not-invited';

const hash = (raw: string) => createHash('sha256').update(raw).digest('hex');

/**
 * Invitation tokens — minting, checking and consuming.
 *
 * Deliberately NOT PasswordResetToken. That token lives an hour and only sets
 * a password; this one lives a week and also flips a User from INVITED to
 * ACTIVE. Sharing a table would mean a plain password-reset token, presented
 * here, could activate an invited account — and `resetPassword` has no type
 * filter, so it would equally happily consume an invite and leave a user with
 * a password they cannot use.
 */
@Injectable()
export class InviteService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    private readonly tokens: TokenService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  /**
   * A password hash nobody holds the input to.
   *
   * A real argon2 hash rather than a placeholder string: `login()` verifies
   * before it checks status, and its uniform-timing design depends on the
   * verify actually running. A non-argon2 value throws, gets swallowed, and
   * returns measurably faster — which turns "is this account invited?" into
   * something you can time.
   */
  static async unusablePasswordHash(): Promise<string> {
    return argon2.hash(randomBytes(32).toString('hex'), { type: argon2.argon2id });
  }

  /**
   * Mints a token inside the caller's transaction and returns the raw value
   * for the email. Anything already outstanding for that employee is revoked:
   * re-inviting must kill the old link, or two live links exist and only one
   * of them is the one HR just read out over the phone.
   */
  async mint(
    tx: Prisma.TransactionClient,
    input: { employeeId: string; sentToEmail: string; createdById: string },
  ): Promise<string> {
    await tx.employeeInvite.updateMany({
      where: { employeeId: input.employeeId, usedAt: null, revokedAt: null },
      data: { revokedAt: new Date() },
    });

    const raw = randomBytes(32).toString('hex');
    await tx.employeeInvite.create({
      data: {
        employeeId: input.employeeId,
        tokenHash: hash(raw),
        sentToEmail: input.sentToEmail,
        expiresAt: new Date(Date.now() + INVITE_TTL_MS),
        createdById: input.createdById,
      },
    });
    return raw;
  }

  /** Revokes every live invite for an employee — used when they are deleted. */
  async revokeAll(tx: Prisma.TransactionClient, employeeId: string): Promise<void> {
    await tx.employeeInvite.updateMany({
      where: { employeeId, usedAt: null, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  /**
   * Read-only check behind the public `GET /auth/invite/:token`, so the page
   * can say "this link has expired, ask HR to resend" instead of rendering a
   * form that fails on submit.
   */
  async check(raw: string): Promise<{ valid: boolean; reason?: InviteRejection; name?: string }> {
    const invite = await this.prisma.employeeInvite.findUnique({
      where: { tokenHash: hash(raw) },
      include: { employee: { select: { firstName: true, deletedAt: true, user: true } } },
    });
    if (!invite) return { valid: false, reason: 'unknown' };
    if (invite.usedAt) return { valid: false, reason: 'used' };
    if (invite.revokedAt) return { valid: false, reason: 'revoked' };
    if (invite.expiresAt < new Date()) return { valid: false, reason: 'expired' };
    if (invite.employee.deletedAt) return { valid: false, reason: 'revoked' };
    // A link forwarded to somebody who already has an account must not become
    // a password reset for them.
    if (invite.employee.user?.status !== 'INVITED') return { valid: false, reason: 'not-invited' };
    return { valid: true, name: invite.employee.firstName };
  }

  /**
   * Sets the password, activates the account, burns the token — atomically.
   *
   * The token is burned with a conditional update rather than a plain one, so
   * two tabs submitting at once cannot both succeed and mint two sessions off
   * one invite.
   */
  async accept(raw: string, password: string): Promise<string> {
    const state = await this.check(raw);
    if (!state.valid) throw new BadRequestException(this.rejectionMessage(state.reason));

    const tokenHash = hash(raw);
    const passwordHash = await argon2.hash(password, { type: argon2.argon2id });

    const userId = await this.prisma.$transaction(async (tx) => {
      const burned = await tx.employeeInvite.updateMany({
        where: { tokenHash, usedAt: null, revokedAt: null },
        data: { usedAt: new Date() },
      });
      if (burned.count !== 1) throw new BadRequestException('This link has already been used');

      const invite = await tx.employeeInvite.findUniqueOrThrow({
        where: { tokenHash },
        include: { employee: { select: { userId: true } } },
      });
      const id = invite.employee.userId;
      if (!id) throw new BadRequestException('This invitation has no sign-in attached');

      await tx.user.update({
        where: { id },
        data: {
          passwordHash,
          status: 'ACTIVE',
          // They just chose it themselves — there is nothing to force.
          mustChangePassword: false,
        },
      });
      return id;
    });

    return userId;
  }

  /** Sends (or resends) the invitation email. Never inside a transaction. */
  async send(input: {
    to: string;
    rawToken: string;
    firstName: string;
    workEmail: string;
    inviterName: string;
    orgId: string;
  }): Promise<void> {
    const webOrigin = this.config.get('WEB_ORIGIN', { infer: true });
    await this.mail.sendOnboardingInvite(
      input.to,
      {
        firstName: input.firstName,
        workEmail: input.workEmail,
        inviteUrl: `${webOrigin}/invite?token=${input.rawToken}`,
        inviterName: input.inviterName,
        expiryDays: INVITE_TTL_DAYS,
      },
      { orgId: input.orgId },
    );
  }

  /** Sessions are the caller's to create — this keeps token crypto in one place. */
  get tokenService(): TokenService {
    return this.tokens;
  }

  private rejectionMessage(reason: InviteRejection | undefined): string {
    switch (reason) {
      case 'expired':
        return 'This invitation has expired — ask your HR team to send a new one';
      case 'used':
        return 'This invitation has already been used. Try signing in instead';
      case 'not-invited':
        return 'This account is already set up. Sign in, or use “forgot password”';
      default:
        return 'This invitation is no longer valid — ask your HR team to send a new one';
    }
  }
}
