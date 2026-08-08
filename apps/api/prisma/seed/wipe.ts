import type { PrismaClient } from '../../src/generated/prisma/client';

/**
 * Two minutes, not the default five seconds.
 *
 * Thirty-odd `deleteMany` statements against a pooled database on the other
 * side of the world is not a five-second job — the first rehearsal died at
 * 5,415ms with the transaction already expired, and that failure mode only
 * gets worse the more data there is to delete. `maxWait` is the queue for a
 * connection; `timeout` is the work itself.
 */
const TRANSACTION_OPTIONS = { timeout: 120_000, maxWait: 30_000 };

/**
 * Empties the demo organization, children before parents.
 *
 * The list has to be exhaustive, not merely long. Nearly every table below
 * carries a foreign key to `Employee`, so a single row anybody left behind —
 * one asset, one resignation — makes `employee.deleteMany` throw. That happens
 * *after* the rest of the wipe has already run, which leaves a half-emptied
 * database and a stack trace. The previous version of this function missed
 * nine modules' worth of tables for exactly that reason: it was written before
 * they existed and nothing failed until the tables had rows in them.
 *
 * Rows with `onDelete: Cascade` are still listed where the parent is not
 * deleted here, and left out where it is.
 */
export async function wipe(prisma: PrismaClient, orgId: string): Promise<void> {
  const employeeOfOrg = { employee: { organizationId: orgId } };

  // Notification has no relation to User — only a bare userId — so its rows
  // have to be found by id before the users disappear.
  const userIds = (
    await prisma.user.findMany({ where: { organizationId: orgId }, select: { id: true } })
  ).map((u) => u.id);

  await prisma.$transaction(
    [
      // Exit, deepest first: lines hang off settlements, settlements and tasks
      // off offboardings, offboardings off resignations.
      prisma.settlementLine.deleteMany({ where: { settlement: { organizationId: orgId } } }),
      prisma.settlement.deleteMany({ where: { organizationId: orgId } }),
      prisma.offboardingTask.deleteMany({ where: { offboarding: { organizationId: orgId } } }),
      prisma.exitInterview.deleteMany({ where: { offboarding: { organizationId: orgId } } }),
      prisma.offboarding.deleteMany({ where: { organizationId: orgId } }),
      prisma.resignation.deleteMany({ where: { organizationId: orgId } }),

      // Expenses: an item points at a claim and a category, and a category
      // points at a PayComponent — so all three go before payroll's tables.
      prisma.expenseItem.deleteMany({ where: { claim: { organizationId: orgId } } }),
      prisma.expenseClaim.deleteMany({ where: { organizationId: orgId } }),
      prisma.expenseCategory.deleteMany({ where: { organizationId: orgId } }),

      // Assets: an assignment points at both an asset and an employee.
      prisma.assetAssignment.deleteMany({ where: { asset: { organizationId: orgId } } }),
      prisma.asset.deleteMany({ where: { organizationId: orgId } }),
      prisma.assetCategory.deleteMany({ where: { organizationId: orgId } }),

      // Payroll: lines off payslips, payslips off runs, salaries off structures.
      prisma.payslipLine.deleteMany({ where: { payslip: { organizationId: orgId } } }),
      prisma.payslip.deleteMany({ where: { organizationId: orgId } }),
      prisma.payrollRun.deleteMany({ where: { organizationId: orgId } }),
      // Before payComponent, which it references.
      prisma.payrollAdjustment.deleteMany({ where: { organizationId: orgId } }),
      prisma.employeeSalary.deleteMany({ where: employeeOfOrg }),
      prisma.structureLine.deleteMany({ where: { structure: { organizationId: orgId } } }),
      prisma.salaryStructure.deleteMany({ where: { organizationId: orgId } }),
      prisma.payComponent.deleteMany({ where: { organizationId: orgId } }),

      // Recruitment, deepest first: an offer and its interviews hang off an
      // application, and every one of them points at an employee somewhere —
      // the hiring manager, the interviewer, the referrer, the person a hire
      // became. Candidates go last because an application needs one.
      prisma.offer.deleteMany({ where: { organizationId: orgId } }),
      prisma.interview.deleteMany({ where: { application: { organizationId: orgId } } }),
      prisma.application.deleteMany({ where: { organizationId: orgId } }),
      prisma.jobOpening.deleteMany({ where: { organizationId: orgId } }),
      prisma.candidate.deleteMany({ where: { organizationId: orgId } }),

      // Letters and onboarding.
      prisma.letter.deleteMany({ where: { organizationId: orgId } }),
      prisma.letterTemplate.deleteMany({ where: { organizationId: orgId } }),
      prisma.onboarding.deleteMany({ where: employeeOfOrg }),
      prisma.employeeInvite.deleteMany({ where: employeeOfOrg }),

      prisma.announcementRead.deleteMany({ where: { announcement: { organizationId: orgId } } }),
      prisma.announcementAttachment.deleteMany({
        where: { announcement: { organizationId: orgId } },
      }),
      prisma.announcement.deleteMany({ where: { organizationId: orgId } }),
      prisma.document.deleteMany({ where: { organizationId: orgId } }),
      prisma.documentCategory.deleteMany({ where: { organizationId: orgId } }),

      // Attendance: sessions cascade from records, so only the records are named.
      prisma.attendanceRequest.deleteMany({ where: employeeOfOrg }),
      prisma.attendanceRecord.deleteMany({ where: { organizationId: orgId } }),
      prisma.remoteWorkRequest.deleteMany({ where: { organizationId: orgId } }),

      prisma.leaveRequest.deleteMany({ where: employeeOfOrg }),
      prisma.leaveBalance.deleteMany({ where: employeeOfOrg }),
      prisma.leaveType.deleteMany({ where: { organizationId: orgId } }),

      prisma.bankDetail.deleteMany({ where: employeeOfOrg }),
      prisma.emergencyContact.deleteMany({ where: employeeOfOrg }),
      prisma.notification.deleteMany({ where: { userId: { in: userIds } } }),
      prisma.auditLog.deleteMany({ where: { organizationId: orgId } }),
      prisma.setting.deleteMany({ where: { organizationId: orgId } }),
      prisma.emailTemplate.deleteMany({ where: { organizationId: orgId } }),
    ],
    TRANSACTION_OPTIONS,
  );

  // Two self-referencing cycles to break: a department points at its head, an
  // employee points at their manager.
  await prisma.department.updateMany({ where: { organizationId: orgId }, data: { headId: null } });
  await prisma.employee.updateMany({ where: { organizationId: orgId }, data: { managerId: null } });

  await prisma.$transaction(
    [
      prisma.employee.deleteMany({ where: { organizationId: orgId } }),
      prisma.refreshSession.deleteMany({ where: { user: { organizationId: orgId } } }),
      prisma.passwordResetToken.deleteMany({ where: { user: { organizationId: orgId } } }),
      prisma.user.deleteMany({ where: { organizationId: orgId } }),
      prisma.holiday.deleteMany({ where: { organizationId: orgId } }),
      prisma.shift.deleteMany({ where: { organizationId: orgId } }),
      prisma.employmentType.deleteMany({ where: { organizationId: orgId } }),
      prisma.designation.deleteMany({ where: { organizationId: orgId } }),
      prisma.department.deleteMany({ where: { organizationId: orgId } }),
      prisma.location.deleteMany({ where: { organizationId: orgId } }),
    ],
    TRANSACTION_OPTIONS,
  );
}

/** What the wipe is about to destroy, for the confirmation the guard prints. */
export async function census(prisma: PrismaClient, orgId: string) {
  const [employees, users, attendance, payslips, assets, leave, candidates] = await Promise.all([
    prisma.employee.count({ where: { organizationId: orgId } }),
    prisma.user.count({ where: { organizationId: orgId } }),
    prisma.attendanceRecord.count({ where: { organizationId: orgId } }),
    prisma.payslip.count({ where: { organizationId: orgId } }),
    prisma.asset.count({ where: { organizationId: orgId } }),
    prisma.leaveRequest.count({ where: { employee: { organizationId: orgId } } }),
    prisma.candidate.count({ where: { organizationId: orgId } }),
  ]);
  return { employees, users, attendance, payslips, assets, leave, candidates };
}
