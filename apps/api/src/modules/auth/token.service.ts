import { createHash, randomBytes } from 'node:crypto';
import type { AccessTokenClaims } from '@hrms/types';
import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
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

  private readonly logger = new Logger(TokenService.name);
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
    await this.pruneExpired(userId);
    return { token, session };
  }

  /**
   * Deletes this user's expired sessions.
   *
   * Nothing else ever removed a row, so the table grew for the life of the
   * deployment: every login and every 15-minute refresh adds one, and rotation
   * means an active user produces ~96 a day. `auth.session-prune` was specified
   * as a nightly job (docs/08) and never built.
   *
   * Doing it here rather than on a timer is deliberate — it keeps the "nothing
   * runs on a schedule" property the rest of the system has (docs/12). The work
   * is bounded to one user's rows on an indexed column, it happens exactly when
   * that user adds a row, and a dormant account costs nothing.
   *
   * **Only expired rows go.** Revoked-but-unexpired ones are what reuse
   * detection reads: presenting a rotated token has to find its session to know
   * it was a replay rather than a fake. Expiry is checked first in
   * `rotateRefreshSession`, before the revoked branch, so a session past
   * `expiresAt` is already refused with the same error whether the row is there
   * or not — deleting it changes nothing observable.
   *
   * Best-effort: a failure here must not fail the sign-in that triggered it.
   */
  async pruneExpired(userId: string): Promise<number> {
    try {
      const { count } = await this.prisma.refreshSession.deleteMany({
        where: { userId, expiresAt: { lt: new Date() } },
      });
      return count;
    } catch (error) {
      this.logger.warn(
        { err: error, userId },
        'Could not prune expired refresh sessions; sign-in unaffected',
      );
      return 0;
    }
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

  /**
   * The user's live sign-ins, newest first — one row per device still able to
   * refresh. Rotated sessions are excluded: a refresh every 15 minutes would
   * otherwise bury the list under a hundred entries a day, all of them the same
   * browser.
   *
   * `currentRawToken` is the caller's own refresh cookie, so the screen can
   * mark which row is the device being used and avoid offering "sign out" for
   * the session running the page.
   */
  async listSessions(userId: string, currentRawToken?: string) {
    const currentHash = currentRawToken ? this.hash(currentRawToken) : null;
    const sessions = await this.prisma.refreshSession.findMany({
      where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        tokenHash: true,
        userAgent: true,
        ip: true,
        createdAt: true,
        expiresAt: true,
      },
    });
    // tokenHash never leaves the server — it is the credential's only stored
    // form, and a list endpoint is no place to hand it out.
    return sessions.map(({ tokenHash, ...s }) => ({ ...s, isCurrent: tokenHash === currentHash }));
  }

  /**
   * Signs one device out.
   *
   * Scoped by `userId` in the same `where` rather than fetched and then
   * checked, so another user's session id matches nothing — there is no path
   * where the wrong row is found and afterwards rejected.
   *
   * Reports whether that was the caller's own session, because revoking the
   * one you are signed in with is allowed and the controller has to clear the
   * cookie when it happens. Answered from this row rather than a second query:
   * `updateMany` cannot return it, so the hash is compared here.
   */
  async revokeSession(
    userId: string,
    sessionId: string,
    currentRawToken?: string,
  ): Promise<{ revoked: boolean; wasCurrent: boolean }> {
    const session = await this.prisma.refreshSession.findFirst({
      where: { id: sessionId, userId, revokedAt: null },
      select: { id: true, tokenHash: true },
    });
    if (!session) return { revoked: false, wasCurrent: false };

    await this.prisma.refreshSession.update({
      where: { id: session.id },
      data: { revokedAt: new Date() },
    });
    return {
      revoked: true,
      wasCurrent:
        Boolean(currentRawToken) && session.tokenHash === this.hash(currentRawToken ?? ''),
    };
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
