import { SetMetadata } from '@nestjs/common';

export const ALLOW_PASSWORD_CHANGE_KEY = 'allowPasswordChange';

/**
 * Marks a route as reachable while the caller still holds the shared default
 * password — the handful they need to get out of that state (read who they
 * are, set a password, sign out) and nothing else.
 *
 * Everything without this is refused by `PasswordChangeGuard`.
 */
export const AllowPasswordChange = () => SetMetadata(ALLOW_PASSWORD_CHANGE_KEY, true);
