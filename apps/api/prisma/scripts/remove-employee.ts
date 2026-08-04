import 'dotenv/config';
import { unlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../src/generated/prisma/client';

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

const UPLOAD_DIR = resolve(process.env.UPLOAD_DIR ?? './uploads');

async function main() {
  const email = process.argv[2]?.trim().toLowerCase();
  if (!email) throw new Error('Pass the work email of the employee to remove.');

  const employee = await prisma.employee.findFirst({
    where: { workEmail: email },
    include: { documents: { select: { id: true, fileKey: true } } },
  });
  if (!employee) throw new Error(`No employee has the work email ${email}.`);

  const name = `${employee.firstName} ${employee.lastName}`;
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
   * Outside the transaction: files are not transactional, and a failed unlink
   * must not roll back a correct database delete. Nothing else in this
   * codebase ever removes bytes — StorageService.remove exists but no document
   * path calls it — so without this the uploads are orphaned forever.
   */
  let removed = 0;
  for (const key of fileKeys) {
    try {
      await unlink(join(UPLOAD_DIR, key));
      removed += 1;
    } catch {
      // Already gone, or never written (a seeded row has no bytes behind it).
    }
  }

  console.log(
    `Removed ${name}: ${employee.documents.length} document rows, ` +
      `${removed} file(s) unlinked from ${UPLOAD_DIR}` +
      `${employee.userId ? ', login deleted' : ', no login attached'}`,
  );
}

main()
  .catch((error) => {
    console.error(`\nRemoval failed: ${error instanceof Error ? error.message : error}`);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
