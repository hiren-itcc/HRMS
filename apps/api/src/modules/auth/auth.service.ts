import { createHash, randomBytes } from 'node:crypto';
import type { AuthResponse, RoleCode, SessionUser, UserStatus } from '@hrms/types';
import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as argon2 from 'argon2';
import type { Env } from '../../config/env';
import { PrismaService } from '../../database/prisma.service';
import type { Prisma } from '../../generated/prisma/client';
import { MailService } from '../mail/mail.service';
import { TokenService } from './token.service';

const RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour, single use

export interface RequestMeta {
  userAgent?: string;
  ip?: string;
}

interface AuthResult extends AuthResponse {
  refreshToken: string;
}

const userWithAccess = {
  role: { include: { permissions: { include: { permission: true } } } },
  employee: { include: { designation: true } },
} as const;

@Injectable()
export class AuthService {
  private readonly webOrigin: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: TokenService,
    private readonly mail: MailService,
    config: ConfigService<Env, true>,
  ) {
    this.webOrigin = config.get('WEB_ORIGIN', { infer: true });
  }

  async login(email: string, password: string, meta: RequestMeta): Promise<AuthResult> {
    const user = await this.prisma.user.findUnique({
      where: { email },
      include: userWithAccess,
    });

    // Burn a comparable hash on unknown email — keeps timing uniform.
    let valid = false;
    if (user) {
      valid = await argon2.verify(user.passwordHash, password).catch(() => false);
    } else {
      await argon2.hash(password);
    }

    if (!user || !valid || user.status !== 'ACTIVE') {
      await this.audit(user?.organizationId, user?.id, 'auth.login_failed', meta, { email });
      throw new UnauthorizedException('Invalid email or password');
    }

    const issued = await this.tokens.createRefreshSession(user.id, meta);
    await this.prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    await this.audit(user.organizationId, user.id, 'auth.login', meta);

    return this.buildAuthResult(user, issued.token);
  }

  async refresh(rawToken: string | undefined, meta: RequestMeta): Promise<AuthResult> {
    if (!rawToken) throw new UnauthorizedException('No refresh token');
    const { userId, issued } = await this.tokens.rotateRefreshSession(rawToken, meta);
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      include: userWithAccess,
    });
    if (user.status !== 'ACTIVE') throw new UnauthorizedException('Account is not active');
    return this.buildAuthResult(user, issued.token);
  }

  async logout(rawToken: string | undefined): Promise<void> {
    if (rawToken) await this.tokens.revokeByRawToken(rawToken);
  }

  /** Always resolves — response never reveals whether the account exists. */
  async forgotPassword(email: string, meta: RequestMeta): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user || user.status === 'SUSPENDED') return;

    const raw = randomBytes(32).toString('hex');
    await this.prisma.passwordResetToken.create({
      data: {
        userId: user.id,
        tokenHash: createHash('sha256').update(raw).digest('hex'),
        expiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MS),
      },
    });
    await this.audit(user.organizationId, user.id, 'auth.password_reset_requested', meta);
    await this.mail.sendPasswordReset(user.email, `${this.webOrigin}/reset-password?token=${raw}`, {
      orgId: user.organizationId,
    });
  }

  async resetPassword(rawToken: string, newPassword: string, meta: RequestMeta): Promise<void> {
    const tokenHash = createHash('sha256').update(rawToken).digest('hex');
    const reset = await this.prisma.passwordResetToken.findUnique({
      where: { tokenHash },
      include: { user: true },
    });
    if (!reset || reset.usedAt || reset.expiresAt < new Date()) {
      throw new BadRequestException('Reset link is invalid or has expired');
    }

    await this.prisma.$transaction([
      this.prisma.passwordResetToken.update({
        where: { id: reset.id },
        data: { usedAt: new Date() },
      }),
      this.prisma.user.update({
        where: { id: reset.userId },
        data: { passwordHash: await argon2.hash(newPassword, { type: argon2.argon2id }) },
      }),
    ]);
    // New password ⇒ every existing session is stale
    await this.tokens.revokeAllForUser(reset.userId);
    await this.audit(reset.user.organizationId, reset.userId, 'auth.password_reset', meta);
  }

  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
    currentRefreshToken: string | undefined,
    meta: RequestMeta,
  ): Promise<void> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const valid = await argon2.verify(user.passwordHash, currentPassword).catch(() => false);
    if (!valid) throw new BadRequestException('Current password is incorrect');

    await this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash: await argon2.hash(newPassword, { type: argon2.argon2id }) },
    });

    // Revoke every other session; the caller's session stays valid.
    const current = currentRefreshToken
      ? await this.prisma.refreshSession.findUnique({
          where: { tokenHash: this.tokens.hash(currentRefreshToken) },
          select: { id: true },
        })
      : null;
    await this.tokens.revokeAllForUser(userId, current?.id);
    await this.audit(user.organizationId, userId, 'auth.password_changed', meta);
  }

  async getMe(userId: string): Promise<SessionUser> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      include: userWithAccess,
    });
    return this.toSessionUser(user);
  }

  // ── helpers ──────────────────────────────────────────────────────────

  private async buildAuthResult(user: UserWithAccess, refreshToken: string): Promise<AuthResult> {
    const sessionUser = this.toSessionUser(user);
    const accessToken = await this.tokens.signAccessToken({
      sub: user.id,
      orgId: user.organizationId,
      employeeId: user.employee?.id,
      roleCode: sessionUser.roleCode,
      perms: sessionUser.permissions,
    });
    return { accessToken, user: sessionUser, refreshToken };
  }

  private toSessionUser(user: UserWithAccess): SessionUser {
    return {
      id: user.id,
      email: user.email,
      status: user.status as UserStatus,
      roleCode: user.role.code as RoleCode,
      permissions: user.role.permissions.map((rp) => rp.permission.code),
      employee: user.employee
        ? {
            id: user.employee.id,
            firstName: user.employee.firstName,
            lastName: user.employee.lastName,
            avatarUrl: user.employee.avatarUrl,
            designation: user.employee.designation?.title ?? null,
          }
        : null,
    };
  }

  private async audit(
    organizationId: string | undefined,
    actorId: string | undefined,
    action: string,
    meta: RequestMeta,
    extra?: Record<string, string>,
  ): Promise<void> {
    if (!organizationId) return; // unknown-account events have no tenant to attach to
    await this.prisma.auditLog.create({
      data: {
        organizationId,
        actorId,
        action,
        entity: 'User',
        entityId: actorId,
        ip: meta.ip,
        meta: extra,
      },
    });
  }
}

type UserWithAccess = Prisma.UserGetPayload<{ include: typeof userWithAccess }>;
