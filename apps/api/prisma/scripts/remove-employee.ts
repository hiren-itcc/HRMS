import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { refusalFor, SEEDED_TAX_SOURCE_MARKER } from '../../src/common/utils/seed-guard';
import { PrismaClient } from '../../src/generated/prisma/client';
import { LocalDiskStorage } from '../../src/modules/storage/local-disk.storage';
import type { StorageAdapter } from '../../src/modules/storage/storage.adapter';
import { SupabaseStorage } from '../../src/modules/storage/supabase.storage';

/**
 * Permanently removes one employee and everything attached to them.
 *
 * This is NOT what the product does. `DELETE /employees/:id` soft-deletes —
 * it sets `deletedAt`, suspends the login and leaves every attendance record,
 * leave request and payslip in place, because for a real employee that history
 * is the point. Use the app for real people.
 *
 * This exists for test data: a hire created while trying the product out, who
 * should leave no trace. It is deliberately a script rather than an endpoint,
 * because nothing in a running HRMS should be able to erase somebody's
 * employment history over HTTP.
 *
 *   pnpm --filter @hrms/api exec tsx prisma/scripts/remove-employee.ts <work-email>
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

/**
 * The same choice the API's StorageModule makes, made again here because a
 * script has no Nest container. Duplicated deliberately and kept to two lines;
 * the alternative is booting the whole application to delete some rows.
 */
function buildStorage(): StorageAdapter {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (url && key) {
    return new SupabaseStorage(url, key, process.env.SUPABASE_STORAGE_BUCKET ?? 'documents');
  }
  return new LocalDiskStorage(process.env.UPLOAD_DIR ?? './uploads');
}

function storageLabel(): string {
  return process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY
    ? `Supabase bucket “${process.env.SUPABASE_STORAGE_BUCKET ?? 'documents'}”`
    : (process.env.UPLOAD_DIR ?? './uploads');
}

async function main() {
  const email = process.argv[2]?.trim().toLowerCase();
  if (!email) throw new Error('Pass the work email of the employee to remove.');

  const employee = await prisma.employee.findFirst({
    where: { workEmail: email },
    include: { documents: { select: { id: true, fileKey: true } } },
  });
  if (!employee) throw new Error(`No employee has the work email ${email}.`);

  const name = `${employee.firstName} ${employee.lastName}`;

  /*
   * The same guard the seeder uses, before anything is deleted.
   *
   * This script had none, and of everything in the repo it is the one that
   * reaches furthest: past the database and into the storage bucket, where the
   * deletes are not transactional and not recoverable.
   *
   * `singleTenant: false` and an identity check that passes trivially — the
   * operator named a person, not a tenant. What still bites is the
   * acknowledgement on a remote host, and the refusal when the database holds
   * tax rules confirmed from the Finance Act, which is the strongest available
   * signal that this is a real company's payroll rather than a demo.
   */
  const [organizationCount, org, realTaxConfigurations] = await Promise.all([
    prisma.organization.count(),
    prisma.organization.findUnique({
      where: { id: employee.organizationId },
      select: { name: true, slug: true },
    }),
    prisma.taxConfiguration.count({
      where: { status: 'CONFIRMED', NOT: { source: { contains: SEEDED_TAX_SOURCE_MARKER } } },
    }),
  ]);
  const refusal = refusalFor({
    databaseUrl: process.env.DATABASE_URL,
    allowReset: process.env.SEED_ALLOW_RESET === 'true',
    organizationCount,
    singleTenant: false,
    organization: org,
    expected: org ?? { name: '', slug: '' },
    realTaxConfigurations,
    allowRealTaxRules: process.env.SEED_ALLOW_REAL_TAX_RULES === 'true',
    action: `remove ${name} and their documents`,
  });
  if (refusal) throw new Error(refusal);

  console.log(`Removing ${name} (${employee.employeeCode}, ${email})`);

  // Read the storage keys before anything is deleted — once the rows are gone
  // there is nothing left pointing at the bytes.
  const fileKeys = employee.documents.map((d) => d.fileKey);

  /*
   * Order is the foreign-key contract, not a preference. Six of these tables
   * are Restrict: the employee delete fails outright while a single row
   * remains. The rest — bank details, emergency contacts, salary history,
   * invites, onboarding — are Cascade and go automatically.
   */
  const employeeId = employee.id;
  await prisma.$transaction(async (tx) => {
    await tx.payslip.deleteMany({ where: { employeeId } }); // cascades PayslipLine
    await tx.letter.deleteMany({ where: { employeeId } });
    await tx.leaveRequest.deleteMany({ where: { employeeId } });
    await tx.leaveBalance.deleteMany({ where: { employeeId } });
    await tx.attendanceRequest.deleteMany({ where: { employeeId } });
    await tx.attendanceRecord.deleteMany({ where: { employeeId } }); // cascades sessions
    /*
     * Documents are SetNull, not Restrict — skipping this would not fail, it
     * would quietly leave the files owned by nobody and still listed in the
     * org-wide document view.
     */
    await tx.document.deleteMany({ where: { employeeId } });

    await tx.employee.delete({ where: { id: employeeId } });

    // Cascades refresh sessions and reset tokens.
    if (employee.userId) await tx.user.delete({ where: { id: employee.userId } });
  });

  /*
   * Outside the transaction: files are not transactional, and a failed delete
   * must not roll back a correct database delete. Nothing else in this
   * codebase removes a document's bytes, so without this they are orphaned.
   *
   * Goes through the same adapter the API uses, so it deletes from wherever
   * the files actually are. Reading UPLOAD_DIR directly, as this used to, went
   * on "succeeding" against an empty local folder once storage moved to
   * Supabase — silently leaving every object behind.
   */
  const storage = buildStorage();
  let removed = 0;
  for (const key of fileKeys) {
    try {
      await storage.remove(key);
      removed += 1;
    } catch {
      // Already gone, or never written (a seeded row has no bytes behind it).
    }
  }

  console.log(
    `Removed ${name}: ${employee.documents.length} document rows, ` +
      `${removed} file(s) deleted from ${storageLabel()}` +
      `${employee.userId ? ', login deleted' : ', no login attached'}`,
  );
}

main()
  .catch((error) => {
    console.error(`\nRemoval failed: ${error instanceof Error ? error.message : error}`);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
