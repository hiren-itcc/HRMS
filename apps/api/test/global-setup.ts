import 'dotenv/config';
import { assertDisposable } from '../src/common/utils/database-target';

/**
 * Runs once, before any integration spec.
 *
 * Its only job is to refuse. These specs run against a **real** Postgres and
 * the seed they rely on is destructive, so the first thing that happens is a
 * positive assertion that the database is one we are allowed to destroy — not
 * "is this production" but "is this the throwaway".
 *
 * That matters here more than most repos: a developer's `apps/api/.env`
 * legitimately points at a hosted database, and `dotenv` will happily load it
 * into a test run. The seed has its own guard; this is the one that stops the
 * suite before it opens a connection at all.
 */
export default async function globalSetup(): Promise<void> {
  assertDisposable(process.env.DATABASE_URL);
  // Never send. Set before the app is constructed anywhere, so the mail
  // transport switch cannot pick Resend even if a key is present in the env.
  process.env.MAIL_OUTBOX_DIR ??= `${process.cwd()}/.tmp/outbox`;
}
