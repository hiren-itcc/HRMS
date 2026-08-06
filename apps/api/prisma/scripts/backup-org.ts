import 'dotenv/config';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../src/generated/prisma/client';

/**
 * Everything one organization owns, as JSON, before something destructive.
 *
 * This exists because `pg_dump` is not always to hand — it is a Postgres
 * client install, and the machine that runs the seed may not have one. The
 * scope is deliberately the same as `wipe()`: an organization's rows, which is
 * exactly what the demo seed deletes.
 *
 * It is a **safety net, not a backup product**. Restoring means reading the
 * file and reinserting in dependency order, which is a hand job — but having
 * the rows beats not having them, and this takes a second to run.
 *
 *   SEED_ORG_SLUG=default BACKUP_OUT=./backup.json pnpm tsx prisma/scripts/backup-org.ts
 */

function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value) throw new Error(`${key} is not set`);
  return value;
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: requireEnv('DATABASE_URL') }),
});

const ORG_SLUG = process.env.SEED_ORG_SLUG ?? 'default';
const OUT = process.env.BACKUP_OUT ?? './org-backup.json';

async function main() {
  const org = await prisma.organization.findUnique({ where: { slug: ORG_SLUG } });
  if (!org) throw new Error(`No organization with slug “${ORG_SLUG}”`);

  const orgId = org.id;
  const ofOrg = { where: { organizationId: orgId } };
  const ofEmployee = { where: { employee: { organizationId: orgId } } };
  const userIds = (await prisma.user.findMany({ ...ofOrg, select: { id: true } })).map((u) => u.id);

  const data = {
    exportedAt: new Date().toISOString(),
    organization: org,
    users: await prisma.user.findMany(ofOrg),
    roles: await prisma.role.findMany(ofOrg),
    rolePermissions: await prisma.rolePermission.findMany({
      where: { role: { organizationId: orgId } },
    }),
    locations: await prisma.location.findMany(ofOrg),
    departments: await prisma.department.findMany(ofOrg),
    designations: await prisma.designation.findMany(ofOrg),
    employmentTypes: await prisma.employmentType.findMany(ofOrg),
    shifts: await prisma.shift.findMany(ofOrg),
    holidays: await prisma.holiday.findMany(ofOrg),
    employees: await prisma.employee.findMany(ofOrg),
    bankDetails: await prisma.bankDetail.findMany(ofEmployee),
    emergencyContacts: await prisma.emergencyContact.findMany(ofEmployee),
    attendanceRecords: await prisma.attendanceRecord.findMany(ofOrg),
    attendanceSessions: await prisma.attendanceSession.findMany({
      where: { record: { organizationId: orgId } },
    }),
    attendanceRequests: await prisma.attendanceRequest.findMany(ofEmployee),
    remoteWorkRequests: await prisma.remoteWorkRequest.findMany(ofOrg),
    leaveTypes: await prisma.leaveType.findMany(ofOrg),
    leaveBalances: await prisma.leaveBalance.findMany(ofEmployee),
    leaveRequests: await prisma.leaveRequest.findMany(ofEmployee),
    documentCategories: await prisma.documentCategory.findMany(ofOrg),
    documents: await prisma.document.findMany(ofOrg),
    announcements: await prisma.announcement.findMany(ofOrg),
    payComponents: await prisma.payComponent.findMany(ofOrg),
    salaryStructures: await prisma.salaryStructure.findMany(ofOrg),
    structureLines: await prisma.structureLine.findMany({
      where: { structure: { organizationId: orgId } },
    }),
    employeeSalaries: await prisma.employeeSalary.findMany(ofEmployee),
    payrollAdjustments: await prisma.payrollAdjustment.findMany(ofOrg),
    payrollRuns: await prisma.payrollRun.findMany(ofOrg),
    payslips: await prisma.payslip.findMany(ofOrg),
    payslipLines: await prisma.payslipLine.findMany({
      where: { payslip: { organizationId: orgId } },
    }),
    letters: await prisma.letter.findMany(ofOrg),
    letterTemplates: await prisma.letterTemplate.findMany(ofOrg),
    onboardings: await prisma.onboarding.findMany(ofEmployee),
    resignations: await prisma.resignation.findMany(ofOrg),
    offboardings: await prisma.offboarding.findMany(ofOrg),
    offboardingTasks: await prisma.offboardingTask.findMany({
      where: { offboarding: { organizationId: orgId } },
    }),
    exitInterviews: await prisma.exitInterview.findMany({
      where: { offboarding: { organizationId: orgId } },
    }),
    settlements: await prisma.settlement.findMany(ofOrg),
    settlementLines: await prisma.settlementLine.findMany({
      where: { settlement: { organizationId: orgId } },
    }),
    assetCategories: await prisma.assetCategory.findMany(ofOrg),
    assets: await prisma.asset.findMany(ofOrg),
    assetAssignments: await prisma.assetAssignment.findMany({
      where: { asset: { organizationId: orgId } },
    }),
    notifications: await prisma.notification.findMany({ where: { userId: { in: userIds } } }),
    settings: await prisma.setting.findMany(ofOrg),
    emailTemplates: await prisma.emailTemplate.findMany(ofOrg),
    auditLogs: await prisma.auditLog.findMany(ofOrg),
  };

  mkdirSync(dirname(OUT), { recursive: true });
  // Decimal and Date both stringify usefully; BigInt would not, and there are
  // none in this schema.
  writeFileSync(OUT, JSON.stringify(data, null, 2), 'utf8');

  const rows = Object.entries(data)
    .filter(([, v]) => Array.isArray(v))
    .reduce((sum, [, v]) => sum + (v as unknown[]).length, 0);
  console.log(`Wrote ${rows} rows for “${org.name}” to ${OUT}`);
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
