import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { refusalFor, SEEDED_TAX_SOURCE_MARKER } from '../../src/common/utils/seed-guard';
import { PrismaClient } from '../../src/generated/prisma/client';
import { wipe } from '../seed/wipe';

/**
 * Removes an organization outright — its rows, its roles, and the tenant.
 *
 * Written for rehearsals: the demo seed is org-scoped, so it can be proved
 * against a throwaway slug in the same database before it is pointed at the
 * one people sign in to. This is what tidies up afterwards.
 *
 * It refuses the default slug. Dropping the tenant everybody uses should take
 * more deliberation than a mistyped environment variable.
 *
 *   DROP_ORG_SLUG=seed-rehearsal pnpm tsx prisma/scripts/drop-org.ts
 */

function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value) throw new Error(`${key} is not set`);
  return value;
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: requireEnv('DATABASE_URL') }),
});

async function main() {
  const slug = requireEnv('DROP_ORG_SLUG');
  if (slug === 'default') {
    throw new Error('Refusing to drop the “default” organization — that is the live tenant.');
  }

  const org = await prisma.organization.findUnique({ where: { slug } });
  if (!org) {
    console.log(`No organization with slug “${slug}” — nothing to do.`);
    return;
  }

  /*
   * The same guard the seeder uses, with one difference stated explicitly:
   * `singleTenant: false`. This script exists to remove a rehearsal tenant
   * standing *beside* the real one, so refusing a database with more than one
   * organization would refuse its whole purpose.
   *
   * The identity check passes trivially — `DROP_ORG_SLUG` is the operator
   * naming the target, which is what that layer asks for. What still bites is
   * the acknowledgement on a remote host, and the refusal when the database
   * holds tax rules somebody confirmed from the Finance Act.
   */
  const realTaxConfigurations = await prisma.taxConfiguration.count({
    where: { status: 'CONFIRMED', NOT: { source: { contains: SEEDED_TAX_SOURCE_MARKER } } },
  });
  const refusal = refusalFor({
    databaseUrl: process.env.DATABASE_URL,
    allowReset: process.env.SEED_ALLOW_RESET === 'true',
    organizationCount: await prisma.organization.count(),
    singleTenant: false,
    organization: { name: org.name, slug: org.slug },
    expected: { name: org.name, slug: org.slug },
    realTaxConfigurations,
    allowRealTaxRules: process.env.SEED_ALLOW_REAL_TAX_RULES === 'true',
    action: `drop the organization “${org.name}”`,
  });
  if (refusal) throw new Error(refusal);

  await wipe(prisma, org.id);
  await prisma.rolePermission.deleteMany({ where: { role: { organizationId: org.id } } });
  await prisma.role.deleteMany({ where: { organizationId: org.id } });
  await prisma.organization.delete({ where: { id: org.id } });

  console.log(`Dropped “${org.name}” (${slug}).`);
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
