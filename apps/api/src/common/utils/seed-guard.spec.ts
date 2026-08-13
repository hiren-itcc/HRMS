import { readFileSync } from 'node:fs';
import { refusalFor, SEEDED_TAX_SOURCE_MARKER, type SeedFacts } from './seed-guard';

/**
 * The guard on every destructive script.
 *
 * Worth testing exhaustively for a reason the other specs do not have: nothing
 * else here is exercised only at the moment somebody is about to destroy
 * production, when a wrong answer is discovered by its consequences.
 *
 * The seeder's old guard had no spec at all, which is how it kept a bug nobody
 * noticed: it wrote to the database *before* asking whether it was allowed to.
 */

const LOCAL = 'postgresql://hrms:hrms@localhost:5432/hrms';
const HOSTED = 'postgresql://u:p@aws-1-ap-northeast-2.pooler.supabase.com:5432/postgres';

/** The demo workspace, acknowledged, with nothing suspicious about it. */
function facts(overrides: Partial<SeedFacts> = {}): SeedFacts {
  return {
    databaseUrl: HOSTED,
    allowReset: true,
    organizationCount: 1,
    singleTenant: true,
    organization: { name: 'Acme Industries', slug: 'default' },
    expected: { name: 'Acme Industries', slug: 'default' },
    realTaxConfigurations: 0,
    allowRealTaxRules: false,
    action: 'wipe',
    ...overrides,
  };
}

describe('layer 1 — the target', () => {
  /*
   * CI depends on this branch. `ci.yml` points at localhost and deliberately
   * does not set SEED_ALLOW_RESET; if this stopped short-circuiting, the
   * integration and e2e jobs would both fail on the seed step.
   */
  it.each([
    ['postgresql://hrms:hrms@localhost:5432/hrms'],
    ['postgresql://hrms:hrms@127.0.0.1:5432/hrms'],
    ['postgresql://hrms:hrms@postgres:5432/hrms'],
    ['postgresql://hrms:hrms@db.local:5432/hrms'],
  ])('allows %s with nothing acknowledged', (url) => {
    expect(refusalFor(facts({ databaseUrl: url, allowReset: false }))).toBeNull();
  });

  /* A throwaway stays a throwaway even when the data on it looks alarming. */
  it('does not ask the later questions of a local database', () => {
    expect(
      refusalFor(
        facts({
          databaseUrl: LOCAL,
          allowReset: false,
          organizationCount: 9,
          organization: { name: 'Somebody Real Ltd', slug: 'real' },
          realTaxConfigurations: 4,
        }),
      ),
    ).toBeNull();
  });

  it('refuses when there is no connection string at all', () => {
    expect(refusalFor(facts({ databaseUrl: undefined }))).toMatch(/DATABASE_URL is not set/);
  });

  /* `hostOf` yields 'unknown host' for rubbish, which is not local — so a
   * malformed URL must fall through to the refusals, never past them. */
  it('treats an unparsable URL as remote rather than local', () => {
    expect(refusalFor(facts({ databaseUrl: 'not-a-url', allowReset: false }))).toMatch(/Refusing/);
  });
});

describe('layer 2 — acknowledgement', () => {
  it('refuses a hosted database without SEED_ALLOW_RESET', () => {
    const refusal = refusalFor(facts({ allowReset: false }));
    expect(refusal).toMatch(/hosted database/);
    expect(refusal).toMatch(/SEED_ALLOW_RESET=true/);
  });

  it('names the host, so the message says which database was nearly destroyed', () => {
    expect(refusalFor(facts({ allowReset: false }))).toMatch(/supabase\.com/);
  });

  it('distinguishes a hosted database from a merely unfamiliar one', () => {
    const other = refusalFor(
      facts({ databaseUrl: 'postgresql://u:p@db.example.com:5432/x', allowReset: false }),
    );
    expect(other).toMatch(/is not a local database/);
    expect(other).not.toMatch(/hosted database/);
  });
});

describe('layer 3 — identity', () => {
  /*
   * The change this whole module exists for. SEED_ALLOW_RESET used to be a
   * master key; every assertion in this block and the next passes it as true.
   */
  it('refuses another company even with SEED_ALLOW_RESET set', () => {
    const refusal = refusalFor(
      facts({ organization: { name: 'Northwind Trading', slug: 'northwind' } }),
    );
    expect(refusal).toMatch(/Northwind Trading/);
    expect(refusal).toMatch(/not "Acme Industries"/);
  });

  it('tells the operator exactly how to say they meant it', () => {
    expect(
      refusalFor(facts({ organization: { name: 'Northwind Trading', slug: 'northwind' } })),
    ).toMatch(/SEED_EXPECT_ORG_NAME="Northwind Trading"/);
  });

  it('allows a different company once it is named explicitly', () => {
    expect(
      refusalFor(
        facts({
          organization: { name: 'Northwind Trading', slug: 'northwind' },
          expected: { name: 'Northwind Trading', slug: 'northwind' },
        }),
      ),
    ).toBeNull();
  });

  /* Same name, different tenant — the slug is what the seeder actually wipes. */
  it('refuses a matching name under a different slug', () => {
    expect(
      refusalFor(facts({ organization: { name: 'Acme Industries', slug: 'acme-uk' } })),
    ).toMatch(/not "Acme Industries" \(default\)/);
  });

  it('refuses a multi-tenant database when the script assumes one tenant', () => {
    const refusal = refusalFor(facts({ organizationCount: 4 }));
    expect(refusal).toMatch(/4 organizations/);
    expect(refusal).toMatch(/single-tenant demo seeder/);
  });

  /*
   * drop-org.ts exists to remove a rehearsal tenant standing beside the real
   * one. Refusing a second organization would refuse its entire purpose, so it
   * declares that it does not assume single tenancy.
   */
  it('allows a second organization when the script does not assume one tenant', () => {
    expect(
      refusalFor(
        facts({
          organizationCount: 4,
          singleTenant: false,
          organization: { name: 'Seed Rehearsal', slug: 'seed-rehearsal' },
          expected: { name: 'Seed Rehearsal', slug: 'seed-rehearsal' },
        }),
      ),
    ).toBeNull();
  });

  /*
   * Nothing to destroy. This is a new environment being bootstrapped, and
   * refusing it would mean the seeder could never be used to create one.
   */
  it('allows an empty database', () => {
    expect(refusalFor(facts({ organizationCount: 0, organization: null }))).toBeNull();
  });
});

describe('layer 4 — evidence', () => {
  it('refuses when tax rules were entered by hand', () => {
    const refusal = refusalFor(facts({ realTaxConfigurations: 2 }));
    expect(refusal).toMatch(/2 income-tax configurations/);
    expect(refusal).toMatch(/live payroll/);
  });

  it('gets the singular right, because "1 configurations" reads as a bug', () => {
    expect(refusalFor(facts({ realTaxConfigurations: 1 }))).toMatch(/1 income-tax configuration /);
  });

  it('allows it once explicitly acknowledged', () => {
    expect(refusalFor(facts({ realTaxConfigurations: 2, allowRealTaxRules: true }))).toBeNull();
  });

  /*
   * The regression this counts as. The first version asked "is it a
   * placeholder", which refused the seeder's own FY 2025-26 rows — genuine
   * Finance Act rates, correctly labelled, written by the seeder. One seed made
   * every later seed impossible. The question is who wrote it, not what it says.
   */
  it('ignores everything the seeder itself wrote, however real the rates are', () => {
    expect(refusalFor(facts({ realTaxConfigurations: 0 }))).toBeNull();
    expect(SEEDED_TAX_SOURCE_MARKER).toBe('[demo seed]');
  });
});

describe('ordering', () => {
  /*
   * Identity before evidence: told both that this is another company and that
   * its tax rules are real, the useful sentence is the one naming the company.
   */
  it('reports the identity problem first when both apply', () => {
    expect(
      refusalFor(
        facts({
          organization: { name: 'Northwind Trading', slug: 'northwind' },
          realTaxConfigurations: 3,
        }),
      ),
    ).toMatch(/Northwind Trading/);
  });

  it('reports the acknowledgement problem before either', () => {
    expect(
      refusalFor(
        facts({
          allowReset: false,
          organization: { name: 'Northwind Trading', slug: 'northwind' },
          realTaxConfigurations: 3,
        }),
      ),
    ).toMatch(/SEED_ALLOW_RESET/);
  });
});

describe('the sentence', () => {
  it('names the action, so the same guard serves the seeder and the scripts', () => {
    expect(refusalFor(facts({ allowReset: false, action: 'drop the organization' }))).toMatch(
      /Refusing to drop the organization/,
    );
    expect(refusalFor(facts({ allowReset: false, action: 'remove an employee' }))).toMatch(
      /Refusing to remove an employee/,
    );
  });
});

describe('purity', () => {
  it('has no clock, no database and no environment', () => {
    // Comments stripped first: this module's own doc block says the words
    // "process.env" while explaining that it does not read it, and a purity
    // test that fails on its own documentation teaches people to weaken it.
    const source = readFileSync(`${__dirname}/seed-guard.ts`, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');
    expect(source).not.toMatch(/new Date\(|Date\.now|PrismaClient|process\.env/);
  });

  it('returns the same answer twice', () => {
    const input = facts({ organization: { name: 'Northwind Trading', slug: 'northwind' } });
    expect(refusalFor(input)).toBe(refusalFor(input));
  });
});
