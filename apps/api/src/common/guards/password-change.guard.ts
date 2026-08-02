import type { AccessTokenClaims } from '@hrms/types';
import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ALLOW_PASSWORD_CHANGE_KEY } from '../decorators/allow-password-change.decorator';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

/**
 * Server-side enforcement of `mustChangePassword`.
 *
 * Accounts created for a new employee start on a shared, guessable password.
 * What made that acceptable was the promise that such an account "can sign in
 * and do nothing else until they set their own" — but that was only ever a
 * redirect in the web layout. The API happily served a full-permission token,
 * so anyone who knew the organization's default password and a work email had
 * that person's entire access over HTTP, web app untouched.
 *
 * The claim is read from the JWT rather than the database so this costs no
 * query per request. `POST /auth/change-password` therefore returns a freshly
 * signed token; without that the caller would keep a token asserting the old
 * value and stay locked out until it expired.
 */
@Injectable()
export class PasswordChangeGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const exempt = this.reflector.getAllAndOverride<boolean>(ALLOW_PASSWORD_CHANGE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (exempt) return true;

    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const user = context.switchToHttp().getRequest<{ user?: AccessTokenClaims }>().user;
    if (user?.mustChangePassword) {
      throw new ForbiddenException('You must set your own password before using the application');
    }
    return true;
  }
}
