import { SetMetadata } from '@nestjs/common';

export const ALLOW_DURING_ONBOARDING_KEY = 'allowDuringOnboarding';

/**
 * Marks a route an employee may still reach while they are onboarding.
 *
 * Deliberately its own decorator rather than reusing `@AllowPasswordChange()`:
 * that one means "needed to replace a password", and widening it to mean two
 * things is how these markers stop being readable.
 */
export const AllowDuringOnboarding = () => SetMetadata(ALLOW_DURING_ONBOARDING_KEY, true);
