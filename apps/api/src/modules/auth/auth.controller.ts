import type { AccessTokenClaims } from '@hrms/types';
import { Body, Controller, Get, HttpCode, HttpStatus, Post, Req, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import type { Env } from '../../config/env';
import { AuthService, type RequestMeta } from './auth.service';
import { ChangePasswordDto, ForgotPasswordDto, LoginDto, ResetPasswordDto } from './dto/auth.dto';

export const REFRESH_COOKIE = 'refresh_token';
const AUTH_THROTTLE = { default: { limit: 5, ttl: 60_000 } };

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  private readonly isProd: boolean;
  private readonly refreshTtlDays: number;

  constructor(
    private readonly auth: AuthService,
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

  @Post('change-password')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Change own password; revokes every other session' })
  async changePassword(
    @Body() dto: ChangePasswordDto,
    @CurrentUser() user: AccessTokenClaims,
    @Req() req: Request,
  ) {
    await this.auth.changePassword(
      user.sub,
      dto.currentPassword,
      dto.newPassword,
      req.cookies?.[REFRESH_COOKIE],
      meta(req),
    );
    return { message: 'Password changed.' };
  }

  @Get('me')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Current user with role, permissions and employee summary' })
  me(@CurrentUser() user: AccessTokenClaims) {
    return this.auth.getMe(user.sub);
  }

  // ── cookie helpers ───────────────────────────────────────────────────

  private setRefreshCookie(res: Response, token: string): void {
    res.cookie(REFRESH_COOKIE, token, {
      httpOnly: true,
      secure: this.isProd,
      sameSite: 'lax',
      path: '/api/v1/auth',
      maxAge: this.refreshTtlDays * 24 * 60 * 60 * 1000,
    });
  }

  private clearRefreshCookie(res: Response): void {
    res.clearCookie(REFRESH_COOKIE, { path: '/api/v1/auth' });
  }
}

function meta(req: Request): RequestMeta {
  return { userAgent: req.headers['user-agent'], ip: req.ip };
}
