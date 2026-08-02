import type { AccessTokenClaims } from '@hrms/types';
import type { ExecutionContext } from '@nestjs/common';
import { ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ALLOW_PASSWORD_CHANGE_KEY } from '../decorators/allow-password-change.decorator';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { PasswordChangeGuard } from './password-change.guard';

function contextFor(user?: Partial<AccessTokenClaims>): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
    getHandler: () => () => undefined,
    getClass: () => class {},
  } as unknown as ExecutionContext;
}

/** Reflector that reports only the given metadata key as set. */
function reflectorFor(setKey?: string): Reflector {
  const r = new Reflector();
  jest
    .spyOn(r, 'getAllAndOverride')
    .mockImplementation((key: unknown) => (key === setKey ? true : undefined) as never);
  return r;
}

describe('PasswordChangeGuard', () => {
  const stillOnDefault = { sub: 'u1', mustChangePassword: true };

  it('refuses an account still on the shared default password', () => {
    const guard = new PasswordChangeGuard(reflectorFor());
    expect(() => guard.canActivate(contextFor(stillOnDefault))).toThrow(ForbiddenException);
  });

  it('allows an account that has set its own password', () => {
    const guard = new PasswordChangeGuard(reflectorFor());
    expect(guard.canActivate(contextFor({ sub: 'u1', mustChangePassword: false }))).toBe(true);
  });

  it('treats a token minted before the claim existed as compliant', () => {
    // Absent claim must not lock out sessions issued by an older build.
    const guard = new PasswordChangeGuard(reflectorFor());
    expect(guard.canActivate(contextFor({ sub: 'u1' }))).toBe(true);
  });

  it('lets the escape-hatch routes through so the password can be changed', () => {
    const guard = new PasswordChangeGuard(reflectorFor(ALLOW_PASSWORD_CHANGE_KEY));
    expect(guard.canActivate(contextFor(stillOnDefault))).toBe(true);
  });

  it('ignores public routes, which have no authenticated user', () => {
    const guard = new PasswordChangeGuard(reflectorFor(IS_PUBLIC_KEY));
    expect(guard.canActivate(contextFor(undefined))).toBe(true);
  });
});
