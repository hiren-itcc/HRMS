import type { AccessTokenClaims } from '@hrms/types';
import { createParamDecorator, type ExecutionContext } from '@nestjs/common';

/** Injects the validated JWT claims for the current request. */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AccessTokenClaims => {
    const request = ctx.switchToHttp().getRequest();
    return request.user as AccessTokenClaims;
  },
);
