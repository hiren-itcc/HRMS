/**
 * Which database a destructive script is pointed at.
 *
 * Extracted from `seed/index.ts` so the seed guard and the E2E guard share one
 * definition of "local". Two copies of this would be two chances to disagree
 * about what is safe to wipe, and the disagreement would only surface the once.
 */

/** The host in a connection string, for a guard and for a banner. */
export function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return 'unknown host';
  }
}

export function isLocal(host: string): boolean {
  return (
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host === '::1' ||
    // The service alias inside a CI or compose network — it is not "localhost"
    // from the container's point of view, and it is just as much a throwaway.
    host === 'postgres' ||
    host.endsWith('.local')
  );
}

/**
 * A hosted database that is obviously not a throwaway. Redundant with
 * `isLocal` — anything not local is already refused — and worth keeping,
 * because the error then names the actual mistake instead of saying "host not
 * allowed" about a URL somebody pasted on purpose.
 */
export function looksManaged(host: string): boolean {
  return /supabase\.(co|com)$|\.neon\.tech$|\.render\.com$|\.rds\.amazonaws\.com$/.test(host);
}

/**
 * The gate for anything that destroys data — an E2E run, an integration suite.
 *
 * Deliberately a **positive** assertion rather than a denylist: not "is this
 * one of the databases I know to avoid" but "is this the one database I am
 * allowed to destroy". A denylist rots the moment a second environment appears;
 * this does not.
 *
 * Throws rather than returning false, because every caller's correct response
 * is to stop, and a boolean invites somebody to log it and carry on.
 */
export function assertDisposable(url: string | undefined, requiredDatabase?: string): void {
  if (!url) {
    throw new Error(
      'DATABASE_URL is not set. Point it at a throwaway database before running this.',
    );
  }
  const host = hostOf(url);

  if (looksManaged(host)) {
    throw new Error(
      `Refusing to run against ${host}: that is a hosted database, and this script destroys data. ` +
        'Point DATABASE_URL at a local or CI database.',
    );
  }
  if (!isLocal(host)) {
    throw new Error(
      `Refusing to run against ${host}: only a local or CI database may be destroyed this way.`,
    );
  }
  if (requiredDatabase) {
    const name = new URL(url).pathname.replace(/^\//, '');
    if (name !== requiredDatabase) {
      throw new Error(
        `Refusing to run against the database "${name}": this script only destroys "${requiredDatabase}".`,
      );
    }
  }
}
