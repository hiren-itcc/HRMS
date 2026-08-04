import type { AccessTokenClaims } from '@hrms/types';
import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Req, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { AllowPasswordChange } from '../../common/decorators/allow-password-change.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import type { Env } from '../../config/env';
import { AuthService, type RequestMeta } from './auth.service';
import {
  AcceptInviteDto,
  ChangePasswordDto,
  ForgotPasswordDto,
  LoginDto,
  ResetPasswordDto,
} from './dto/auth.dto';
import { InviteService } from './invite.service';

export const REFRESH_COOKIE = 'refresh_token';
const AUTH_THROTTLE = { default: { limit: 5, ttl: 60_000 } };

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  private readonly isProd: boolean;
  private readonly refreshTtlDays: number;

  constructor(
    private readonly auth: AuthService,
    private readonly invites: InviteService,
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
  @Throttle(AUTH_THROTTLE)
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
    return this.auth.getMe(user.sub);
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
