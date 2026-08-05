import 'dotenv/config';
import {
  DEFAULT_ASSET_CATEGORIES,
  DEFAULT_DEPARTMENTS,
  DEFAULT_DESIGNATIONS,
  DEFAULT_DOCUMENT_CATEGORIES,
  DEFAULT_EMPLOYMENT_TYPES,
  DEFAULT_FIXED_HOLIDAYS,
  DEFAULT_LOCATIONS,
  DEFAULT_PAY_COMPONENTS,
  DEFAULT_SALARY_STRUCTURES,
  DEFAULT_SHIFTS,
  MOVABLE_HOLIDAY_EXAMPLES,
  ROLE_PERMISSIONS,
  SYSTEM_ROLES,
} from '@hrms/shared';
import { PrismaPg } from '@prisma/adapter-pg';
import * as argon2 from 'argon2';
import { PrismaClient } from '../src/generated/prisma/client';

/**
 * Production bootstrap — the smallest amount of data that makes a freshly
 * migrated database usable.
 *
 * This is the deliberate opposite of `seed.ts`. The demo seed wipes the
 * organization and fills it with six invented employees, four weeks of
 * attendance and three payroll runs; none of that belongs in production, and
 * the wipe makes it dangerous there. But migrations insert no roles or
 * permissions either, so a migrated-but-unseeded database has nobody who can
 * do anything — the demo seed was the only shipped way out of that.
 *
 * So this creates exactly three things: the organization, the system roles
 * with their permission grants, and one administrator. It is additive —
 * upserts only, no deletes — so re-running it is safe, and safe against a
 * database that already has real people in it.
 *
 * The admin password is required rather than defaulted. A bootstrap that ships
 * a known password is a bootstrap that leaves one in production.
 *
 *   BOOTSTRAP_ADMIN_EMAIL=admin@yourcompany.com \
 *   BOOTSTRAP_ADMIN_PASSWORD='…' \
 *   pnpm db:bootstrap
 */

function requireEnv(key: string, hint: string): string {
  const value = process.env[key];
  if (!value) throw new Error(`${key} is not set — ${hint}`);
  return value;
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({
    connectionString: requireEnv('DATABASE_URL', 'the Postgres connection string'),
  }),
});

const ORG_NAME = process.env.BOOTSTRAP_ORG_NAME ?? 'My Company';
const ORG_SLUG = process.env.BOOTSTRAP_ORG_SLUG ?? 'default';
const ORG_TIMEZONE = process.env.BOOTSTRAP_ORG_TIMEZONE ?? 'Asia/Kolkata';

/** Minimum that argon2 protects meaningfully once an attacker has the hash. */
const MIN_PASSWORD_LENGTH = 12;

async function main() {
  const adminEmail = requireEnv(
    'BOOTSTRAP_ADMIN_EMAIL',
    'the email address of the first administrator',
  ).toLowerCase();
  const adminPassword = requireEnv(
    'BOOTSTRAP_ADMIN_PASSWORD',
    'the first administrator’s password (there is deliberately no default)',
  );

  if (adminPassword.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`BOOTSTRAP_ADMIN_PASSWORD must be at least ${MIN_PASSWORD_LENGTH} characters.`);
  }

  // ── Organization ─────────────────────────────────────────────────────────
  // Upsert on slug: re-running must not create a second tenant, and must not
  // rename an organization someone has since set properly in Settings.
  const existingOrg = await prisma.organization.findUnique({ where: { slug: ORG_SLUG } });
  const org = await prisma.organization.upsert({
    where: { slug: ORG_SLUG },
    update: {},
    create: { name: ORG_NAME, slug: ORG_SLUG, timezone: ORG_TIMEZONE },
  });
  console.log(
    existingOrg
      ? `Organization: reusing “${org.name}” (${ORG_SLUG})`
      : `Organization: created “${org.name}” (${ORG_SLUG})`,
  );

  // ── Roles and permissions ────────────────────────────────────────────────
  // Same catalogue the demo seed uses, from @hrms/shared, so the two can never
  // disagree about what a role means. Additive by design: a grant an admin has
  // deliberately revoked in Settings must not silently reappear on re-run.
  const roles: Record<string, string> = {};
  let grantCount = 0;

  for (const [roleCode, perms] of Object.entries(ROLE_PERMISSIONS)) {
    const meta = SYSTEM_ROLES.find((r) => r.code === roleCode);
    if (!meta) continue;

    const role = await prisma.role.upsert({
      where: { organizationId_code: { organizationId: org.id, code: roleCode } },
      update: { name: meta.name, description: meta.description },
      create: {
        organizationId: org.id,
        code: roleCode,
        name: meta.name,
        description: meta.description,
        isSystem: true,
      },
    });
    roles[roleCode] = role.id;

    for (const code of perms) {
      const [resource = code, ...rest] = code.split('.');
      const permission = await prisma.permission.upsert({
        where: { code },
        update: {},
        create: { code, resource, action: rest.join('.') },
      });
      await prisma.rolePermission.upsert({
        where: { roleId_permissionId: { roleId: role.id, permissionId: permission.id } },
        update: {},
        create: { roleId: role.id, permissionId: permission.id },
      });
      grantCount += 1;
    }
  }

  const permissionCount = await prisma.permission.count();
  console.log(
    `Roles: ${Object.keys(roles).length} system roles, ` +
      `${permissionCount} permissions, ${grantCount} grants`,
  );

  // ── Organization reference data ──────────────────────────────────────────
  // Onboarding refuses to approve a hire without a department, designation,
  // location, shift and employment type — so on a fresh install the very first
  // action hits a wall the product itself put there. Every upsert below uses
  // `update: {}`, so anything renamed or deleted since stays that way.
  for (const dept of DEFAULT_DEPARTMENTS) {
    await prisma.department.upsert({
      where: { organizationId_name: { organizationId: org.id, name: dept.name } },
      update: {},
      create: { organizationId: org.id, ...dept },
    });
  }
  for (const designation of DEFAULT_DESIGNATIONS) {
    await prisma.designation.upsert({
      where: { organizationId_title: { organizationId: org.id, title: designation.title } },
      update: {},
      create: { organizationId: org.id, ...designation },
    });
  }
  for (const type of DEFAULT_EMPLOYMENT_TYPES) {
    await prisma.employmentType.upsert({
      where: { organizationId_name: { organizationId: org.id, name: type.name } },
      update: {},
      create: { organizationId: org.id, ...type },
    });
  }
  for (const shift of DEFAULT_SHIFTS) {
    await prisma.shift.upsert({
      where: { organizationId_name: { organizationId: org.id, name: shift.name } },
      update: {},
      create: { organizationId: org.id, ...shift },
    });
  }
  for (const location of DEFAULT_LOCATIONS) {
    await prisma.location.upsert({
      where: { organizationId_name: { organizationId: org.id, name: location.name } },
      update: {},
      create: { organizationId: org.id, ...location },
    });
  }
  /*
   * Counted one after another, not with Promise.all. A pooled connection —
   * Supabase's is the case in hand — hands out far fewer sockets than a direct
   * one, and five simultaneous counts is enough to be refused mid-bootstrap.
   * This is a setup script; sequential costs nothing.
   */
  const where = { organizationId: org.id };
  const deptCount = await prisma.department.count({ where });
  const desigCount = await prisma.designation.count({ where });
  const typeCount = await prisma.employmentType.count({ where });
  const shiftCount = await prisma.shift.count({ where });
  const locCount = await prisma.location.count({ where });
  console.log(
    `Structure: ${deptCount} departments, ${desigCount} designations, ` +
      `${typeCount} employment types, ${shiftCount} shifts, ${locCount} locations`,
  );

  // ── Holidays ─────────────────────────────────────────────────────────────
  // This year and next, so a company set up in December does not begin with an
  // empty calendar. Fixed-date only — see DEFAULT_FIXED_HOLIDAYS for why the
  // lunar festivals are deliberately absent.
  const thisYear = new Date().getUTCFullYear();
  for (const year of [thisYear, thisYear + 1]) {
    for (const holiday of DEFAULT_FIXED_HOLIDAYS) {
      const date = new Date(Date.UTC(year, holiday.month - 1, holiday.day));
      /*
       * Find-then-create rather than upsert. These are org-wide, so
       * `locationId` is null, and Prisma refuses a null inside the compound
       * unique `where` — the index allows it, the generated client does not.
       */
      const exists = await prisma.holiday.findFirst({
        where: { organizationId: org.id, locationId: null, date, name: holiday.name },
        select: { id: true },
      });
      if (!exists) {
        await prisma.holiday.create({
          data: { organizationId: org.id, name: holiday.name, date },
        });
      }
    }
  }
  const holidayCount = await prisma.holiday.count({ where: { organizationId: org.id } });
  console.log(`Holidays: ${holidayCount} fixed-date, ${thisYear}–${thisYear + 1}`);

  // ── Pay component catalogue ──────────────────────────────────────────────
  // Without these, payroll is unreachable: a salary structure is built out of
  // components, so no components means no structure, no salary and nothing for
  // a run to calculate. The demo seed created them and this did not, which left
  // every real deployment with a payroll module it could not start using.
  //
  // isSystem, because the calculation engine looks BASIC/PF/ESI/PT up by code
  // (COMPONENT_CODES) — they must exist and must not be deletable. Upserted
  // rather than created so re-running stays additive, and `update: {}` so a
  // component somebody has since renamed is left alone.
  for (const [index, component] of DEFAULT_PAY_COMPONENTS.entries()) {
    await prisma.payComponent.upsert({
      where: { organizationId_code: { organizationId: org.id, code: component.code } },
      update: {},
      create: { organizationId: org.id, ...component, isSystem: true, order: index },
    });
  }
  const componentCount = await prisma.payComponent.count({ where: { organizationId: org.id } });
  console.log(`Pay components: ${componentCount} in the catalogue`);

  // ── Document folders ─────────────────────────────────────────────────────
  // Same omission as pay components had: only the demo seed created these, so
  // a real deployment had nowhere to file anything. Onboarding is the first
  // feature that depends on them existing — a new hire is asked for an ID
  // proof and a bank proof on their first day.
  for (const name of DEFAULT_DOCUMENT_CATEGORIES) {
    await prisma.documentCategory.upsert({
      where: { organizationId_name: { organizationId: org.id, name } },
      update: {},
      create: { organizationId: org.id, name },
    });
  }
  const folderCount = await prisma.documentCategory.count({ where: { organizationId: org.id } });
  console.log(`Document folders: ${folderCount}`);

  // ── Asset categories ─────────────────────────────────────────────────────
  // Same upsert-with-empty-update shape: re-running stays additive, and a
  // category somebody has since renamed is left alone. An asset cannot be
  // created without one, so a register with no categories is a dead screen.
  for (const name of DEFAULT_ASSET_CATEGORIES) {
    await prisma.assetCategory.upsert({
      where: { organizationId_name: { organizationId: org.id, name } },
      update: {},
      create: { organizationId: org.id, name },
    });
  }
  const assetCategoryCount = await prisma.assetCategory.count({
    where: { organizationId: org.id },
  });
  console.log(`Asset categories: ${assetCategoryCount}`);

  // ── Default salary structure ─────────────────────────────────────────────
  // Must run after the pay components: the lines point at them by id.
  //
  // Only created when absent. Re-running must never rewrite the lines of a
  // structure somebody is already paying people on — that would silently
  // change next month's payslips.
  const components = await prisma.payComponent.findMany({
    where: { organizationId: org.id },
    select: { id: true, code: true },
  });
  const componentId = (code: string) => components.find((c) => c.code === code)?.id;

  for (const seed of DEFAULT_SALARY_STRUCTURES) {
    const existing = await prisma.salaryStructure.findUnique({
      where: { organizationId_code: { organizationId: org.id, code: seed.code } },
    });
    if (existing) continue;

    const lines = seed.lines
      .map((line) => ({ ...line, componentId: componentId(line.componentCode) }))
      .filter((line): line is typeof line & { componentId: string } => Boolean(line.componentId));

    await prisma.salaryStructure.create({
      data: {
        organizationId: org.id,
        code: seed.code,
        name: seed.name,
        description: seed.description,
        lines: {
          create: lines.map((line) => ({
            componentId: line.componentId,
            calcType: line.calcType,
            value: line.value,
            order: line.order,
          })),
        },
      },
    });
  }
  const structureCount = await prisma.salaryStructure.count({ where: { organizationId: org.id } });
  console.log(`Salary structures: ${structureCount}`);

  const adminRoleId = roles.ADMIN;
  if (!adminRoleId) throw new Error('ADMIN role missing from ROLE_PERMISSIONS.');

  // ── First administrator ──────────────────────────────────────────────────
  // mustChangePassword is the point of the whole exercise: whatever password
  // reached this process — a CI variable, a shell history, a chat message —
  // stops being valid the moment someone signs in with it.
  const existingUser = await prisma.user.findUnique({ where: { email: adminEmail } });

  if (existingUser) {
    // Never silently reset a live administrator's password on re-run.
    console.log(`Administrator: ${adminEmail} already exists — left untouched`);
  } else {
    const passwordHash = await argon2.hash(adminPassword, { type: argon2.argon2id });
    await prisma.user.create({
      data: {
        organizationId: org.id,
        email: adminEmail,
        passwordHash,
        status: 'ACTIVE',
        mustChangePassword: true,
        roleId: adminRoleId,
      },
    });
    console.log(`Administrator: created ${adminEmail} (must change password at first sign-in)`);
  }

  // This account has no Employee record on purpose. It exists to sign in and
  // set the company up; the real people get created through the app, where
  // employee codes, reporting lines and org placement are validated.
  console.log('\nBootstrap complete. Sign in and change the password immediately.');

  /*
   * Said out loud rather than left to be discovered. Every festival below
   * moves with a lunar calendar, so seeding a guess would put a holiday on the
   * wrong day — which decides who is marked absent and whose pay is docked.
   */
  console.log(
    `\nStill to add under Organization → Holidays: ${MOVABLE_HOLIDAY_EXAMPLES.join(', ')}.` +
      '\nThese follow lunar calendars, so their dates change every year and cannot be seeded.',
  );
}

main()
  .catch((error) => {
    console.error(`\nBootstrap failed: ${error instanceof Error ? error.message : error}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
