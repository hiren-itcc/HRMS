import type { AccessTokenClaims } from '@hrms/types';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { AllowPasswordChange } from '../../common/decorators/allow-password-change.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import type { Env } from '../../config/env';
import { LifecycleService } from '../lifecycle/lifecycle.service';
import { AuthService, type RequestMeta } from './auth.service';
import {
  AcceptInviteDto,
  ChangePasswordDto,
  ForgotPasswordDto,
  LoginDto,
  ResetPasswordDto,
} from './dto/auth.dto';
import { InviteService } from './invite.service';
import { TokenService } from './token.service';

export const REFRESH_COOKIE = 'refresh_token';

/**
 * Two buckets, because these routes do not share a threat model. Do not tidy
 * them back into one — that is the bug this comment exists to prevent, and
 * `auth.e2e-spec.ts` asserts they stay apart.
 *
 * Read from `process.env` rather than `ConfigService` because `@Throttle` is a
 * decorator, evaluated when the class is defined and long before DI exists.
 * The Zod schema in `config/env.ts` validates and bounds the same variable at
 * boot, so a bad value fails the process rather than silently disabling this.
 */
const AUTH_LIMIT = Number(process.env.AUTH_THROTTLE_LIMIT ?? 5);

/**
 * Credential guessing and account enumeration. Deliberately tight, and the
 * reason `forgot-password` answers identically for a real and an unknown
 * address is the same concern one layer up.
 */
const AUTH_THROTTLE = { default: { limit: AUTH_LIMIT, ttl: 60_000 } };

/**
 * Refresh is a different question, and sharing the bucket above was a real bug
 * rather than a conservative choice.
 *
 * The web client calls this on **every app bootstrap** (`session-provider.tsx`)
 * and again on any 401 (`api-client.ts`). At five a minute, a signed-in person
 * who reloads a few times, opens a few tabs, or shares an office IP with
 * colleagues gets a 429 — and `tryRefresh()` reads any non-ok response as
 * failure and hard-redirects them to sign-in. Being signed out for browsing too
 * fast is a worse outcome than anything this limit was protecting against.
 *
 * What actually guards this route is the token itself: httpOnly, Secure,
 * SameSite=Lax, scoped to `/auth`, and **rotated with reuse detection** in
 * `token.service.ts`. Replaying a stolen cookie revokes the entire session
 * chain, which a per-IP counter does not improve on.
 */
const REFRESH_THROTTLE = { default: { limit: 60, ttl: 60_000 } };

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  private readonly isProd: boolean;
  private readonly refreshTtlDays: number;

  constructor(
    private readonly auth: AuthService,
    private readonly invites: InviteService,
    private readonly tokens: TokenService,
    private readonly lifecycle: LifecycleService,
    config: ConfigService<Env, true>,
  ) {
    this.isProd = config.get('NODE_ENV', { infer: true }) === 'production';
    this.refreshTtlDays = config.get('REFRESH_TOKEN_TTL_DAYS', { infer: true });
  }

  @Public()
  @Throttle(AUTH_THROTTLE)
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Email + password → access token; sets refresh cookie' })
  async login(
    @Body() dto: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { refreshToken, ...result } = await this.auth.login(dto.email, dto.password, meta(req));
    this.setRefreshCookie(res, refreshToken);
    return result;
  }

  @Public()
  @Throttle(REFRESH_THROTTLE)
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Rotate refresh token → new access token (reuse detection revokes all)',
  })
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    try {
      const { refreshToken, ...result } = await this.auth.refresh(
        req.cookies?.[REFRESH_COOKIE],
        meta(req),
      );
      this.setRefreshCookie(res, refreshToken);
      return result;
    } catch (err) {
      this.clearRefreshCookie(res);
      throw err;
    }
  }

  @Public()
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Revoke current session and clear the refresh cookie' })
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    await this.auth.logout(req.cookies?.[REFRESH_COOKIE]);
    this.clearRefreshCookie(res);
  }

  @Public()
  @Throttle(AUTH_THROTTLE)
  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Request a reset link (response never reveals account existence)' })
  async forgotPassword(@Body() dto: ForgotPasswordDto, @Req() req: Request) {
    await this.auth.forgotPassword(dto.email, meta(req));
    return { message: 'If that email exists, a reset link has been sent.' };
  }

  @Public()
  @Throttle(AUTH_THROTTLE)
  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Set a new password with a reset token; revokes all sessions' })
  async resetPassword(@Body() dto: ResetPasswordDto, @Req() req: Request) {
    await this.auth.resetPassword(dto.token, dto.password, meta(req));
    return { message: 'Password updated. You can now sign in.' };
  }

  /**
   * Read-only check so the invite page can say *why* a link does not work.
   * Without it the page renders a password form that fails on submit, which
   * reads as "the product is broken" rather than "ask HR to resend".
   */
  @Public()
  @Throttle(AUTH_THROTTLE)
  @Get('invite/:token')
  @ApiOperation({ summary: 'Is this invitation still usable?' })
  checkInvite(@Param('token') token: string) {
    return this.invites.check(token);
  }

  @Public()
  @Throttle(AUTH_THROTTLE)
  @Post('accept-invite')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Set a password from an invitation and sign in' })
  async acceptInvite(
    @Body() dto: AcceptInviteDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const userId = await this.invites.accept(dto.token, dto.password);
    const { refreshToken, ...result } = await this.auth.sessionFor(userId, meta(req));
    this.setRefreshCookie(res, refreshToken);
    return result;
  }

  @Post('change-password')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @AllowPasswordChange()
  @ApiOperation({ summary: 'Change own password; revokes every other session' })
  async changePassword(
    @Body() dto: ChangePasswordDto,
    @CurrentUser() user: AccessTokenClaims,
    @Req() req: Request,
  ) {
    const { accessToken } = await this.auth.changePassword(
      user.sub,
      dto.currentPassword,
      dto.newPassword,
      req.cookies?.[REFRESH_COOKIE],
      meta(req),
    );
    // The new token no longer carries mustChangePassword — the client must
    // swap it in, or every subsequent call is refused by PasswordChangeGuard.
    return { message: 'Password changed.', accessToken };
  }

  @Get('me')
  @ApiBearerAuth()
  @AllowPasswordChange()
  @ApiOperation({ summary: 'Current user with role, permissions and employee summary' })
  me(@CurrentUser() user: AccessTokenClaims) {
    /*
     * The daily lifecycle tick, hung off the one request every session makes
     * on load. Not awaited, and it swallows its own errors: nothing on any
     * screen depends on it having run — probation state and notice elapse are
     * derived from the dates on read — so it must never be the reason `me`
     * is slow or fails.
     *
     * This is here rather than in an `@Cron` because the instance sleeps after
     * fifteen idle minutes, and a timer that silently does not fire is worse
     * than no timer at all.
     */
    void this.lifecycle.tickIfDue(user.orgId);
    return this.auth.getMe(user.sub);
  }

  /*
   * Sessions are the caller's own, so there is no permission on either route —
   * the subject comes from the JWT and is never read from a parameter. This is
   * the same rule /me/profile follows (docs/04 §Enforcement).
   *
   * They live under /auth rather than /me because the refresh cookie is scoped
   * to `Path=/api/v1/auth`. Anywhere else the browser would not send it, and
   * the list could not say which device is the one you are reading it on.
   */
  @Get('sessions')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Devices currently able to refresh this account' })
  sessions(@CurrentUser() user: AccessTokenClaims, @Req() req: Request) {
    return this.tokens.listSessions(user.sub, req.cookies?.[REFRESH_COOKIE]);
  }

  @Delete('sessions/:id')
  @ApiBearerAuth()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Sign one device out' })
  async revokeSession(
    @CurrentUser() user: AccessTokenClaims,
    @Param('id') id: string,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { revoked, wasCurrent } = await this.tokens.revokeSession(
      user.sub,
      id,
      req.cookies?.[REFRESH_COOKIE],
    );
    if (!revoked) throw new NotFoundException('Session not found');

    /*
     * Revoking the session you are signed in with is allowed — "sign out
     * everywhere, including here" is a reasonable thing to want and refusing it
     * would be surprising. But the cookie has to go with it, or the browser
     * keeps presenting a revoked token until the access token expires and then
     * fails a refresh it cannot explain.
     */
    if (wasCurrent) this.clearRefreshCookie(res);
  }

  // ── cookie helpers ───────────────────────────────────────────────────

  /*
   * `sameSite` is a deployment fact, not a preference.
   *
   * In development both apps are on localhost, so they are same-site and `lax`
   * is the stricter, better choice. In production the web app and the API sit
   * on different hosts — and `onrender.com`, like `vercel.app`, is on the
   * Public Suffix List, so two subdomains of it are cross-site to each other
   * exactly as if they were unrelated domains. A `lax` cookie is withheld from
   * cross-site XHR, which is precisely what `POST /auth/refresh` is: the login
   * would work, and then every session would end silently at the 15-minute
   * access-token expiry with no error the user could act on.
   *
   * `none` requires `secure`, which is why they move together. What keeps this
   * safe is not the cookie flag but CORS: another origin can cause a refresh to
   * fire, but `enableCors({ origin: WEB_ORIGIN, credentials: true })` stops it
   * reading the response, so the rotated access token never leaves this app.
   * The worst it can do is rotate a token early.
   */
  private setRefreshCookie(res: Response, token: string): void {
    res.cookie(REFRESH_COOKIE, token, {
      httpOnly: true,
      secure: this.isProd,
      sameSite: this.isProd ? 'none' : 'lax',
      path: '/api/v1/auth',
      maxAge: this.refreshTtlDays * 24 * 60 * 60 * 1000,
    });
  }

  /** Must mirror the attributes above — a cookie only clears on an exact match. */
  private clearRefreshCookie(res: Response): void {
    res.clearCookie(REFRESH_COOKIE, {
      httpOnly: true,
      secure: this.isProd,
      sameSite: this.isProd ? 'none' : 'lax',
      path: '/api/v1/auth',
    });
  }
}

function meta(req: Request): RequestMeta {
  return { userAgent: req.headers['user-agent'], ip: req.ip };
}
