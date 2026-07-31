import { createHash, randomBytes } from 'node:crypto';
import type { AccessTokenClaims } from '@hrms/types';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { Env } from '../../config/env';
import { PrismaService } from '../../database/prisma.service';
import type { RefreshSession } from '../../generated/prisma/client';

const DAY_MS = 24 * 60 * 60 * 1000;

export interface IssuedRefreshToken {
  /** Raw opaque token — sent to the client once, only its hash is stored. */
  token: string;
  session: RefreshSession;
}

/**
 * Token machinery (docs/07-auth-architecture.md):
 * access JWT (15 min, claims incl. permissions) + opaque rotating refresh
 * sessions with reuse detection.
 */
@Injectable()
export class TokenService {
  static readonly REUSE_GRACE_MS = 30_000;

  private readonly refreshTtlDays: number;

  constructor(
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
    config: ConfigService<Env, true>,
  ) {
    this.refreshTtlDays = config.get('REFRESH_TOKEN_TTL_DAYS', { infer: true });
  }

  signAccessToken(claims: AccessTokenClaims): Promise<string> {
    const { sub, ...rest } = claims;
    return this.jwt.signAsync(rest, { subject: sub });
  }

  hash(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  async createRefreshSession(
    userId: string,
    meta: { userAgent?: string; ip?: string },
  ): Promise<IssuedRefreshToken> {
    const token = randomBytes(32).toString('hex');
    const session = await this.prisma.refreshSession.create({
      data: {
        userId,
        tokenHash: this.hash(token),
        userAgent: meta.userAgent,
        ip: meta.ip,
        expiresAt: new Date(Date.now() + this.refreshTtlDays * DAY_MS),
      },
    });
    return { token, session };
  }

  /**
   * Rotation with reuse detection: presenting an already-rotated token
   * revokes every session for that user (stolen-token containment).
   */
  async rotateRefreshSession(
    rawToken: string,
    meta: { userAgent?: string; ip?: string },
  ): Promise<{ userId: string; issued: IssuedRefreshToken }> {
    const session = await this.prisma.refreshSession.findUnique({
      where: { tokenHash: this.hash(rawToken) },
    });

    if (!session || session.expiresAt < new Date()) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    if (session.revokedAt) {
      // Concurrent refreshes (second browser tab, React StrictMode double
      // effect) legitimately present a just-rotated token — inside a short
      // grace window that branches the chain instead of nuking it. A replay
      // outside the window is treated as theft: every session dies.
      const withinGrace = Date.now() - session.revokedAt.getTime() < TokenService.REUSE_GRACE_MS;
      if (!withinGrace) {
        await this.revokeAllForUser(session.userId);
        await this.prisma.auditLog.create({
          data: {
            organizationId: await this.orgIdOf(session.userId),
            actorId: session.userId,
            action: 'auth.refresh_reuse_detected',
            entity: 'RefreshSession',
            entityId: session.id,
            ip: meta.ip,
          },
        });
        throw new UnauthorizedException('Session revoked');
      }
      const issued = await this.createRefreshSession(session.userId, meta);
      return { userId: session.userId, issued };
    }

    const issued = await this.createRefreshSession(session.userId, meta);
    await this.prisma.refreshSession.update({
      where: { id: session.id },
      data: { revokedAt: new Date(), replacedById: issued.session.id },
    });
    return { userId: session.userId, issued };
  }

  async revokeByRawToken(rawToken: string): Promise<void> {
    await this.prisma.refreshSession.updateMany({
      where: { tokenHash: this.hash(rawToken), revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async revokeAllForUser(userId: string, exceptSessionId?: string): Promise<void> {
    await this.prisma.refreshSession.updateMany({
      where: {
        userId,
        revokedAt: null,
        ...(exceptSessionId ? { id: { not: exceptSessionId } } : {}),
      },
      data: { revokedAt: new Date() },
    });
  }

  private async orgIdOf(userId: string): Promise<string> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { organizationId: true },
    });
    return user.organizationId;
  }
}
