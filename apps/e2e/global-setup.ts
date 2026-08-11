import { assertDisposable } from '../api/src/common/utils/database-target';

/**
 * Refuse before anything else happens.
 *
 * The specs below drive a real API against a real database, and the seed they
 * depend on is destructive. A developer's `apps/api/.env` legitimately points
 * at a hosted database — so the failure mode this guards against is not exotic,
 * it is "ran the E2E suite without thinking about which database was in scope".
 *
 * A positive assertion, not a denylist: the question is "is this the throwaway
 * I am allowed to destroy", which stays correct as environments are added.
 */
export default function globalSetup(): void {
  assertDisposable(process.env.DATABASE_URL);

  if (!process.env.MAIL_OUTBOX_DIR) {
    throw new Error(
      'MAIL_OUTBOX_DIR is not set. The invite flow reads the outbox to find its link, ' +
        'and without it the API would try to send real email from a test run.',
    );
  }
}
