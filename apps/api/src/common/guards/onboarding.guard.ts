import type { AccessTokenClaims } from '@hrms/types';
import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ALLOW_DURING_ONBOARDING_KEY } from '../decorators/allow-during-onboarding.decorator';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

/**
 * Confines an employee who is still onboarding to the wizard.
 *
 * Their role is EMPLOYEE, which is not nearly narrow enough on its own. With
 * only those permissions, somebody who has been invited but has signed nothing
 * could:
 *
 * - clock in — and an attendance record beats every derived state, so it
 *   pollutes their summary and the org's reports permanently;
 * - request leave — which *provisions a full year's balance* as a side effect,
 *   so a candidate who never joins keeps an allocation;
 * - read the entire company directory, with every colleague's work email.
 *
 * The last one is the reason this is a guard and not a redirect in the web
 * app: the API is the boundary (docs/04 §enforcement).
 *
 * The claim is read from the JWT, like `mustChangePassword`, so this costs no
 * query. Approval revokes the employee's refresh sessions, so a stale token is
 * replaced within one refresh — and until then it errs *restrictive*, which is
 * the safe direction to be wrong in.
 */
@Injectable()
export class OnboardingGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const allowed = this.reflector.getAllAndOverride<boolean>(ALLOW_DURING_ONBOARDING_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (allowed) return true;

    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const user = context.switchToHttp().getRequest<{ user?: AccessTokenClaims }>().user;
    if (user?.onboarding) {
      throw new ForbiddenException('Finish your onboarding before using the rest of the app');
    }
    return true;
  }
}
