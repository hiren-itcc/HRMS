import 'dotenv/config';
import { ROLE_PERMISSIONS, SYSTEM_ROLES } from '@hrms/shared';
import { PrismaPg } from '@prisma/adapter-pg';
import * as argon2 from 'argon2';
import { dateKeyOf } from '../../src/common/utils/calendar';
import { hostOf, isLocal } from '../../src/common/utils/database-target';
import { refusalFor, SEEDED_TAX_SOURCE_MARKER } from '../../src/common/utils/seed-guard';
import { PrismaClient } from '../../src/generated/prisma/client';
import { seedAssets } from './assets';
import { seedAttendance } from './attendance';
import { seedComms } from './comms';
import { seedExit } from './exit';
import { seedExpenses } from './expenses';
import { seedHelpdesk } from './helpdesk';
import { seedLeave } from './leave';
import { seedOnboarding } from './onboarding';
import { seedOrg } from './org';
import { seedPayroll } from './payroll';
import { seedImportHistory, seedPeople } from './people';
import { seedPerformance } from './performance';
import { seedProjects } from './projects';
import { makeRandom } from './random';
import { seedRecruitment } from './recruitment';
import { seedTaxConfiguration } from './tax';
import { seedTds } from './tds';
import { seedWfh } from './wfh';
import { census, wipe } from './wipe';

/**
 * Demo seed — a workspace you can sign into and actually exercise.
 *
 * Every module gets enough data to verify it end to end: twenty-eight people
 * across four employment statuses, eight weeks of attendance, remote work
 * requests, leave, five payroll runs, an asset register, the full exit chain
 * from resignation to a paid settlement, letters, onboarding in flight, and a
 * bell with unread items in it.
 *
 * **It is destructive.** It empties the seeded organization first, so repeated
 * runs produce an identical workspace rather than accumulating duplicates.
 * See the guard below for what stops that happening somewhere it should not.
 */

const ORG_SLUG = process.env.SEED_ORG_SLUG ?? 'default';
const PASSWORD = process.env.SEED_PASSWORD ?? 'Passw0rd!2026';

function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value) throw new Error(`${key} is not set`);
  return value;
}

const DATABASE_URL = requireEnv('DATABASE_URL');

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: DATABASE_URL }),
});

const ORG_NAME = process.env.SEED_EXPECT_ORG_NAME ?? 'Acme Industries';

/**
 * Whether this run may destroy what is on the other end of DATABASE_URL.
 *
 * The decision itself is `src/common/utils/seed-guard.ts` — pure, and tested
 * there against every branch. What is here is the gathering: read the tenant,
 * count the tax rules that were confirmed rather than seeded, print what would
 * be lost, and refuse with whatever sentence the guard returns.
 *
 * **This runs before anything is written.** It used to run *after* the
 * organization upsert, which meant a refused run had already renamed that
 * company's organization row to "Acme Industries" and set its timezone — the
 * rename surviving the refusal. A guard that has already done damage by the
 * time it fires is not a guard.
 */
async function confirmTarget(): Promise<void> {
  const [organizationCount, organization, realTaxConfigurations] = await Promise.all([
    prisma.organization.count(),
    prisma.organization.findUnique({
      where: { slug: ORG_SLUG },
      select: { id: true, name: true, slug: true },
    }),
    // CONFIRMED without the seeder's own marker: a human entered these, so
    // real TDS is being computed against them.
    prisma.taxConfiguration.count({
      where: { status: 'CONFIRMED', NOT: { source: { contains: SEEDED_TAX_SOURCE_MARKER } } },
    }),
  ]);

  const host = hostOf(DATABASE_URL);
  if (!isLocal(host) && organization) {
    const counts = await census(prisma, organization.id);
    const summary = [
      `${counts.employees} employees`,
      `${counts.users} user accounts`,
      `${counts.attendance} attendance records`,
      `${counts.leave} leave requests`,
      `${counts.payslips} payslips`,
      `${counts.assets} assets`,
      `${counts.candidates} candidates`,
    ].join(', ');

    console.log(`\n  Target:  ${host}`);
    console.log(`  Company: ${organization.name} (${organization.slug})`);
    console.log(`  Deletes: ${summary}\n`);
  }

  const refusal = refusalFor({
    databaseUrl: DATABASE_URL,
    allowReset: process.env.SEED_ALLOW_RESET === 'true',
    organizationCount,
    singleTenant: true,
    organization: organization && { name: organization.name, slug: organization.slug },
    expected: { name: ORG_NAME, slug: ORG_SLUG },
    realTaxConfigurations,
    allowRealTaxRules: process.env.SEED_ALLOW_REAL_TAX_RULES === 'true',
    action: 'wipe the demo workspace',
  });
  if (refusal) throw new Error(refusal);

  if (!isLocal(host)) console.log('  Guard cleared — proceeding.\n');
}

async function main() {
  // Guard first, and only then write. Nothing above this line touches the
  // database in a way that survives a refusal.
  await confirmTarget();

  const org = await prisma.organization.upsert({
    where: { slug: ORG_SLUG },
    update: { name: ORG_NAME, timezone: 'Asia/Kolkata' },
    create: { name: ORG_NAME, slug: ORG_SLUG, timezone: 'Asia/Kolkata' },
  });

  console.log('Resetting the demo workspace…');
  await wipe(prisma, org.id);

  const random = makeRandom();
  const todayKey = dateKeyOf(new Date());
  const year = Number(todayKey.slice(0, 4));

  // ── RBAC ───────────────────────────────────────────────────────────────
  // Additive: a grant revoked from Settings must not reappear on re-seed.
  const roles: Record<string, string> = {};
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
    }
  }

  const fixtures = await seedOrg(prisma, org.id, year);
  const passwordHash = await argon2.hash(PASSWORD, { type: argon2.argon2id });

  console.log('People…');
  const people = await seedPeople(prisma, org.id, fixtures, roles, passwordHash, random, todayKey);

  console.log('Attendance and remote work…');
  const { remoteByEmail } = await seedAttendance(
    prisma,
    org.id,
    fixtures,
    people,
    random,
    todayKey,
  );
  await seedWfh(prisma, org.id, people, remoteByEmail, random, todayKey);

  console.log('Leave…');
  await seedLeave(prisma, fixtures, people, random, todayKey);

  console.log('Payroll…');
  await seedPayroll(prisma, org.id, fixtures, people, random, todayKey);

  console.log('Bulk import history…');
  await seedImportHistory(prisma, org.id, people);

  console.log('Income tax configuration…');
  await seedTaxConfiguration(prisma, org.id, people);

  console.log('TDS challans…');
  await seedTds(prisma, org.id);

  console.log('Assets…');
  await seedAssets(prisma, org.id, fixtures, people, random, todayKey);

  console.log('Expense claims…');
  await seedExpenses(prisma, org.id, people, random, todayKey);

  console.log('Projects and timesheets…');
  await seedProjects(prisma, org.id, people, random, todayKey);

  console.log('Exits and settlements…');
  await seedExit(prisma, org.id, people, random, todayKey);

  console.log('Onboarding…');
  await seedOnboarding(prisma, people, todayKey);

  console.log('Recruitment…');
  await seedRecruitment(prisma, org.id, fixtures, people, random, todayKey);

  console.log('Performance cycles, goals and reviews…');
  await seedPerformance(prisma, org.id, people, random, todayKey);

  console.log('Helpdesk tickets…');
  await seedHelpdesk(prisma, org.id, people);

  console.log('Announcements, letters and settings…');
  await seedComms(prisma, org.id, org.name, fixtures, people, random, todayKey);

  const counts = {
    employees: await prisma.employee.count({ where: { organizationId: org.id } }),
    attendance: await prisma.attendanceRecord.count({ where: { organizationId: org.id } }),
    leave: await prisma.leaveRequest.count({ where: { employee: { organizationId: org.id } } }),
    remote: await prisma.remoteWorkRequest.count({ where: { organizationId: org.id } }),
    assets: await prisma.asset.count({ where: { organizationId: org.id } }),
    payslips: await prisma.payslip.count({ where: { organizationId: org.id } }),
    settlements: await prisma.settlement.count({ where: { organizationId: org.id } }),
    letters: await prisma.letter.count({ where: { organizationId: org.id } }),
    openings: await prisma.jobOpening.count({ where: { organizationId: org.id } }),
    candidates: await prisma.candidate.count({ where: { organizationId: org.id } }),
    cycles: await prisma.reviewCycle.count({ where: { organizationId: org.id } }),
    reviews: await prisma.performanceReview.count({ where: { organizationId: org.id } }),
    tickets: await prisma.ticket.count({ where: { organizationId: org.id } }),
    tdsChallans: await prisma.tdsChallan.count({ where: { organizationId: org.id } }),
  };

  console.log(`
Seed complete — ${org.name}

  ${counts.employees} employees · ${counts.attendance} attendance records · ${counts.leave} leave requests
  ${counts.remote} remote requests · ${counts.assets} assets · ${counts.payslips} payslips
  ${counts.settlements} settlements · ${counts.letters} letters
  ${counts.openings} job openings · ${counts.candidates} candidates
  ${counts.cycles} review cycles · ${counts.reviews} reviews
  ${counts.tickets} helpdesk tickets · ${counts.tdsChallans} TDS challans

  Password for every account: ${PASSWORD}

    admin@hrms.local     Admin     Aarav Shah     CEO — sees everything
    hr@hrms.local        HR        Priya Nair     People ops, org-wide
    finance@hrms.local   Finance   Vikram Rao     Approves and pays payroll
    manager@hrms.local   Manager   Meera Iyer     Direct reports, approvals
    asha@hrms.local      Employee  Asha Verma     Self service — unmarked today, clock in yourself
    rohan@hrms.local     Employee  Rohan Desai    Self service, Pune / early shift
    zara@hrms.local      Employee  Zara Khan      Self service, contract, on probation

  The other twenty-one sign in the same way — see the employee list for emails.
`);
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
