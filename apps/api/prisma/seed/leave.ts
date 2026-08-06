import { addDays, toDate } from '../../src/common/utils/calendar';
import type { PrismaClient } from '../../src/generated/prisma/client';
import type { OrgFixtures } from './org';
import type { People } from './people';
import type { Random } from './random';

/**
 * Balances for everybody, and requests in every state a screen can render.
 *
 * Used days are moved on the balance only for approved requests, which mirrors
 * the booking transaction — a seed whose balances disagree with its requests
 * teaches the wrong thing about how leave works.
 */
export async function seedLeave(
  prisma: PrismaClient,
  org: OrgFixtures,
  people: People,
  random: Random,
  todayKey: string,
) {
  const year = Number(todayKey.slice(0, 4));

  await prisma.leaveBalance.createMany({
    data: people.all.flatMap((person) =>
      org.leaveTypes.map((type) => ({
        employeeId: person.employeeId,
        leaveTypeId: type.id,
        year,
        allocated: Number(type.daysPerYear),
        used: 0,
        // Earned leave is the one that carries; a few days of it makes the
        // encashment line on a settlement non-zero.
        carriedOver: type.code === 'EL' ? random.int(0, 6) : 0,
      })),
    ),
    skipDuplicates: true,
  });

  const book = async (input: {
    email: string;
    code: string;
    start: string;
    end: string;
    days: number;
    reason: string;
    status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';
    approver?: string;
    note?: string;
    halfDaySide?: 'FIRST_HALF' | 'SECOND_HALF';
  }) => {
    const employeeId = people.emp(input.email);
    await prisma.leaveRequest.create({
      data: {
        employeeId,
        leaveTypeId: org.leaveTypeId(input.code),
        startDate: toDate(input.start),
        endDate: toDate(input.end),
        leaveYear: year,
        days: input.days,
        reason: input.reason,
        status: input.status,
        halfDaySide: input.halfDaySide ?? null,
        ...(input.approver
          ? {
              approverId: people.emp(input.approver),
              actedAt: toDate(addDays(todayKey, -3)),
              approverNote: input.note,
            }
          : {}),
      },
    });
    if (input.status === 'APPROVED') {
      await prisma.leaveBalance.update({
        where: {
          employeeId_leaveTypeId_year: {
            employeeId,
            leaveTypeId: org.leaveTypeId(input.code),
            year,
          },
        },
        data: { used: { increment: input.days } },
      });
    }
  };

  await book({
    email: 'asha@hrms.local',
    code: 'CL',
    start: addDays(todayKey, 6),
    end: addDays(todayKey, 8),
    days: 3,
    reason: 'Family function out of town',
    status: 'PENDING',
  });
  await book({
    email: 'manager@hrms.local',
    code: 'CL',
    start: addDays(todayKey, 14),
    end: addDays(todayKey, 15),
    days: 2,
    reason: "Daughter's school event",
    status: 'PENDING',
  });
  await book({
    email: 'rohan@hrms.local',
    code: 'SL',
    start: addDays(todayKey, -12),
    end: addDays(todayKey, -11),
    days: 2,
    reason: 'Viral fever — doctor advised rest',
    status: 'APPROVED',
    approver: 'manager@hrms.local',
    note: 'Get well soon.',
  });
  await book({
    email: 'asha@hrms.local',
    code: 'EL',
    start: addDays(todayKey, -30),
    end: addDays(todayKey, -26),
    days: 5,
    reason: 'Annual holiday',
    status: 'APPROVED',
    approver: 'manager@hrms.local',
  });
  // Half a day, so the calendar has one of those to draw.
  await book({
    email: 'rohan@hrms.local',
    code: 'CL',
    start: addDays(todayKey, -4),
    end: addDays(todayKey, -4),
    days: 0.5,
    reason: 'Bank appointment',
    status: 'APPROVED',
    approver: 'manager@hrms.local',
    halfDaySide: 'FIRST_HALF',
  });
  await book({
    email: 'zara@hrms.local',
    code: 'CL',
    start: addDays(todayKey, -5),
    end: addDays(todayKey, -5),
    days: 1,
    reason: 'Personal errand',
    status: 'REJECTED',
    approver: 'hr@hrms.local',
    note: 'Quarter close — please pick another day.',
  });
  await book({
    email: 'zara@hrms.local',
    code: 'CL',
    start: addDays(todayKey, 20),
    end: addDays(todayKey, 20),
    days: 1,
    reason: 'Changed my plans',
    status: 'CANCELLED',
  });

  // A spread across the rest of the roster, so the leave report is not five
  // rows in a company of twenty-eight.
  const others = people.staff.filter(
    (p) => !['asha@hrms.local', 'rohan@hrms.local', 'zara@hrms.local'].includes(p.email),
  );
  for (const person of others) {
    if (!random.chance(0.7)) continue;
    const back = random.int(5, 50);
    const length = random.int(1, 3);
    await book({
      email: person.email,
      code: random.pick(['CL', 'SL', 'EL']),
      start: addDays(todayKey, -back),
      end: addDays(todayKey, -back + length - 1),
      days: length,
      reason: random.pick([
        'Family commitment',
        'Not well',
        'Travelling home',
        'Personal work',
        'Wedding in the family',
      ]),
      status: 'APPROVED',
      approver: person.managerEmail ?? 'hr@hrms.local',
    });
  }
}
