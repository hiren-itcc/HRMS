import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
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
