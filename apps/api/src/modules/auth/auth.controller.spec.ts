import type { ConfigService } from '@nestjs/config';
import type { Response } from 'express';
import { AuthController, REFRESH_COOKIE } from './auth.controller';
import type { AuthService } from './auth.service';
import type { InviteService } from './invite.service';

/**
 * The refresh cookie's attributes are a deployment fact, and getting them
 * wrong fails in the worst possible way: login succeeds, so nothing looks
 * broken, and then every session dies at the access-token expiry because the
 * browser refused to send the cookie to /auth/refresh. Nothing else in the
 * suite would catch that, so it is pinned here.
 */

function buildController(nodeEnv: string) {
  const config = {
    get: (key: string) => (key === 'NODE_ENV' ? nodeEnv : 30),
  } as unknown as ConfigService<never, true>;

  const auth = {
    login: jest.fn().mockResolvedValue({ refreshToken: 'r1', accessToken: 'a1' }),
    logout: jest.fn().mockResolvedValue(undefined),
  } as unknown as AuthService;

  const controller = new AuthController(auth, {} as InviteService, config);
  const res = { cookie: jest.fn(), clearCookie: jest.fn() } as unknown as Response;
  return { controller, res, auth };
}

const req = { cookies: { [REFRESH_COOKIE]: 'r0' }, headers: {}, ip: '1.2.3.4' } as never;

describe('AuthController refresh cookie', () => {
  it('is cross-site capable in production, because web and API are on different hosts', async () => {
    const { controller, res } = buildController('production');
    await controller.login({ email: 'a@b.co', password: 'x' } as never, req, res);

    const [name, value, options] = (res.cookie as jest.Mock).mock.calls[0];
    expect(name).toBe(REFRESH_COOKIE);
    expect(value).toBe('r1');
    // `none` is what lets the cookie ride a cross-site XHR to /auth/refresh,
    // and browsers reject `none` unless `secure` is set — they move together.
    expect(options).toMatchObject({ sameSite: 'none', secure: true, httpOnly: true });
  });

  it('stays on the stricter `lax` in development, where both apps are on localhost', async () => {
    const { controller, res } = buildController('development');
    await controller.login({ email: 'a@b.co', password: 'x' } as never, req, res);

    const [, , options] = (res.cookie as jest.Mock).mock.calls[0];
    // `secure` here would mean the cookie never sets over plain-http localhost.
    expect(options).toMatchObject({ sameSite: 'lax', secure: false, httpOnly: true });
  });

  it('scopes the cookie to the auth routes that are the only ones that read it', async () => {
    const { controller, res } = buildController('production');
    await controller.login({ email: 'a@b.co', password: 'x' } as never, req, res);

    const [, , options] = (res.cookie as jest.Mock).mock.calls[0];
    expect(options.path).toBe('/api/v1/auth');
  });

  it('clears with the same attributes it set — a mismatch leaves the cookie in place', async () => {
    const { controller, res } = buildController('production');
    await controller.logout(req, res);

    const [name, options] = (res.clearCookie as jest.Mock).mock.calls[0];
    expect(name).toBe(REFRESH_COOKIE);
    expect(options).toMatchObject({
      sameSite: 'none',
      secure: true,
      httpOnly: true,
      path: '/api/v1/auth',
    });
  });
});
