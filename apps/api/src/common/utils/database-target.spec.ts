import { assertDisposable, hostOf, isLocal, looksManaged } from './database-target';

/**
 * The guard that stands between a destructive script and somebody's real data.
 *
 * Worth testing carefully for a reason specific to this repo: the checked-in
 * `.env` says `NODE_ENV=development` while `DATABASE_URL` points at a hosted
 * database, so the one configuration most in need of stopping is the one an
 * environment check sails straight through. The seed already learned that — its
 * guard was `NODE_ENV === 'production'` and protected nothing.
 */

const local = 'postgresql://hrms:hrms@localhost:5432/hrms?schema=public';

describe('hostOf', () => {
  it('reads the host out, and does not throw on rubbish', () => {
    expect(hostOf(local)).toBe('localhost');
    expect(hostOf('not a url at all')).toBe('unknown host');
  });
});

describe('isLocal', () => {
  it('accepts the loopback names and a compose service alias', () => {
    for (const host of ['localhost', '127.0.0.1', '::1', 'postgres', 'db.local']) {
      expect([host, isLocal(host)]).toEqual([host, true]);
    }
  });

  it('rejects anything else', () => {
    for (const host of ['aws-1-ap-northeast-2.pooler.supabase.com', 'example.com', '10.0.0.5']) {
      expect([host, isLocal(host)]).toEqual([host, false]);
    }
  });
});

describe('looksManaged', () => {
  /* Redundant with isLocal — anything non-local is already refused — and kept
     so the error names the real mistake rather than "host not allowed". */
  it('recognises the hosted providers by name', () => {
    expect(looksManaged('aws-1-ap-northeast-2.pooler.supabase.com')).toBe(true);
    expect(looksManaged('db.abcdef.supabase.co')).toBe(true);
    expect(looksManaged('ep-cool-thing.eu-central-1.aws.neon.tech')).toBe(true);
    expect(looksManaged('localhost')).toBe(false);
  });
});

describe('assertDisposable', () => {
  it('allows a local database', () => {
    expect(() => assertDisposable(local)).not.toThrow();
  });

  /*
   * The case this exists for. A developer's own .env legitimately points here,
   * dotenv will load it into a test run without being asked, and the error has
   * to say *which* mistake was made — not "host not allowed" about a URL
   * somebody pasted on purpose.
   */
  it('refuses the production-shaped host by name', () => {
    expect(() =>
      assertDisposable('postgresql://u:p@aws-1-ap-northeast-2.pooler.supabase.com:5432/postgres'),
    ).toThrow(/hosted database/);
  });

  it('refuses an unset URL rather than reading it as empty', () => {
    expect(() => assertDisposable(undefined)).toThrow(/not set/);
  });

  it('refuses a remote host that is not a known provider either', () => {
    expect(() => assertDisposable('postgresql://u:p@db.internal.example.com:5432/hrms')).toThrow(
      /only a local or CI database/,
    );
  });

  /* Belt and braces for a harness that must only ever touch one database. */
  it('can insist on a specific database name', () => {
    expect(() => assertDisposable(local, 'hrms')).not.toThrow();
    expect(() => assertDisposable(local, 'hrms_e2e')).toThrow(/only destroys "hrms_e2e"/);
  });
});
