import type { Permission } from '@hrms/shared';
import type { AccessTokenClaims } from '@hrms/types';
import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PERMISSIONS_KEY } from '../decorators/require-permissions.decorator';

/**
 * Global permission guard (docs/04-rbac.md). Routes without
 * @RequirePermissions metadata pass — identity alone is enough for
 * self-scoped ("/me") endpoints, which derive the subject from the JWT.
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Permission[] | undefined>(PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true;

    const user = context.switchToHttp().getRequest().user as AccessTokenClaims | undefined;
    if (!user) return false;

    const granted = new Set(user.perms);
    if (required.some((p) => granted.has(p))) return true;

    throw new ForbiddenException(`Missing permission: ${required.join(' | ')}`);
  }
}
