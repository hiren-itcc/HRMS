import { hostOf, isLocal, looksManaged } from './database-target';

/**
 * Whether a destructive script may run against the database it is pointed at.
 *
 * Pure: no Prisma, no `process.env`, no clock. It takes facts somebody else
 * gathered and returns the sentence to refuse with, or null. That is the same
 * `GuardrailReason` shape `rbac.guardrails.ts` and `projects.rules.ts` use, and
 * it means every branch below is testable without a database.
 *
 * ## Why this is not `assertDisposable`
 *
 * `assertDisposable` answers "is this a throwaway host" and refuses anything
 * managed. That is right for the integration and E2E suites, which genuinely
 * only ever run against a container.
 *
 * It is the wrong question for the seeder, because this project's *development*
 * database is hosted. Refusing every managed host would make the seeder unusable
 * for the way the project actually works, and a guard people have to bypass is a
 * guard that gets bypassed. So this asks a different question: not "which host"
 * but **"which tenant, and does its data look like somebody's real payroll"**.
 *
 * ## The layers
 *
 * 1. **Target** — a local or CI host is a throwaway; nothing else is checked.
 * 2. **Acknowledgement** — anywhere else needs `SEED_ALLOW_RESET`, which is the
 *    operator saying "yes, a remote database, I know".
 * 3. **Identity** — is this the demo tenant? Runs *regardless* of layer 2.
 * 4. **Evidence** — does the data look like it is in real use? Also regardless.
 *
 * Layers 3 and 4 are the point. `SEED_ALLOW_RESET` used to be a master key: set
 * it and everything proceeded. Now it satisfies only layer 2, and the two
 * questions that actually matter — whose data is this, and is it real — are
 * asked every time.
 */

/** The sentence to refuse with, or null to proceed. */
export type SeedRefusal = string | null;

/**
 * Every tax configuration the seeder writes carries this marker in its
 * `source`. Anything CONFIRMED *without* it was entered by a human, which is
 * the strongest signal available that real payroll is being computed against
 * it.
 *
 * The question is deliberately "did the seeder write this", not "is it a
 * placeholder". The first version of this guard asked the second, and refused
 * its own output: the seeder writes genuine Finance Act 2025 rates for
 * FY 2025-26, correctly labelled as such, so one seed made every later seed
 * impossible.
 *
 * Exported so the seeder writes the same string the guard reads. Two copies
 * would be two chances to disagree, and the disagreement would surface once.
 */
export const SEEDED_TAX_SOURCE_MARKER = '[demo seed]';

export interface SeedFacts {
  /** The connection string the script would use. */
  databaseUrl: string | undefined;
  /** `SEED_ALLOW_RESET === 'true'` — the operator acknowledging a remote host. */
  allowReset: boolean;
  /** How many organizations the database holds. */
  organizationCount: number;
  /**
   * Whether the calling script assumes the database holds one tenant.
   *
   * The seeder does: it wipes "the" organization and would be meaningless in a
   * multi-tenant database. `drop-org.ts` does not — it exists to remove a
   * rehearsal tenant standing *beside* the real one, and refusing a second
   * organization would refuse its entire purpose. A declaration of what the
   * script assumes, not a way around the check.
   */
  singleTenant: boolean;
  /**
   * The organization this run would destroy, or null when it does not exist
   * yet — which is what an empty database being bootstrapped looks like.
   */
  organization: { name: string; slug: string } | null;
  /** Who the operator says they are wiping. */
  expected: { name: string; slug: string };
  /**
   * Tax configurations that are CONFIRMED and whose `source` does not carry
   * `SEEDED_TAX_SOURCE_MARKER` — i.e. a human entered them.
   */
  realTaxConfigurations: number;
  /** `SEED_ALLOW_REAL_TAX_RULES === 'true'`. */
  allowRealTaxRules: boolean;
  /** What the script calls itself, for the refusal sentence. */
  action: string;
}

export function refusalFor(facts: SeedFacts): SeedRefusal {
  if (!facts.databaseUrl) {
    return 'DATABASE_URL is not set. Point it at a database before running this.';
  }

  const host = hostOf(facts.databaseUrl);

  // ── 1. Target ───────────────────────────────────────────────────────
  // A container is a throwaway by definition. This is also what lets CI seed
  // without setting SEED_ALLOW_RESET, which it deliberately does not.
  if (isLocal(host)) return null;

  // ── 2. Acknowledgement ──────────────────────────────────────────────
  if (!facts.allowReset) {
    const managed = looksManaged(host)
      ? `${host} is a hosted database`
      : `${host} is not a local database`;
    return (
      `Refusing to ${facts.action} on ${host}: ${managed}, and this destroys data.\n` +
      '  Set SEED_ALLOW_RESET=true if that is genuinely what you want.'
    );
  }

  // ── 3. Identity ─────────────────────────────────────────────────────
  // Everything below runs even with SEED_ALLOW_RESET set. That is the whole
  // change: acknowledging a remote host is not the same as having checked
  // whose data is on it.

  if (facts.singleTenant && facts.organizationCount > 1) {
    return (
      `Refusing to ${facts.action} on ${host}: it holds ${facts.organizationCount} organizations.\n` +
      '  This script is a single-tenant demo seeder and has no business in a multi-tenant database.'
    );
  }

  // No organization yet: there is nothing to destroy, and this is what
  // bootstrapping a new environment looks like.
  if (facts.organization) {
    const { name, slug } = facts.organization;
    if (name !== facts.expected.name || slug !== facts.expected.slug) {
      return (
        `Refusing to ${facts.action} on ${host}: the organization there is ` +
        `"${name}" (${slug}), not "${facts.expected.name}" (${facts.expected.slug}).\n` +
        '  This is the check that stops a demo seeder reaching somebody’s real company.\n' +
        `  If you genuinely mean to wipe "${name}", say so: SEED_EXPECT_ORG_NAME="${name}" SEED_ORG_SLUG="${slug}".`
      );
    }
  }

  // ── 4. Evidence ─────────────────────────────────────────────────────
  if (facts.realTaxConfigurations > 0 && !facts.allowRealTaxRules) {
    const plural = facts.realTaxConfigurations === 1 ? 'configuration' : 'configurations';
    return (
      `Refusing to ${facts.action} on ${host}: ${facts.realTaxConfigurations} income-tax ${plural} ` +
      'there were confirmed from the Finance Act rather than seeded as placeholders.\n' +
      '  That means real TDS is being computed against them, which means this is somebody’s live payroll.\n' +
      '  Set SEED_ALLOW_REAL_TAX_RULES=true only if you are certain it is not.'
    );
  }

  return null;
}
