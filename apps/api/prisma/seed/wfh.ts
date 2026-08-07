import { addDays, isWeekend, toDate } from '../../src/common/utils/calendar';
import type { PrismaClient } from '../../src/generated/prisma/client';
import type { People } from './people';
import type { Random } from './random';

const REASONS = [
  'Plumber coming, cannot leave the flat',
  'Deep work on the migration — quieter at home',
  'Recovering from a cold, well enough to work',
  'School holidays, childcare at home',
  'Building lift out of service all week',
];

const workingDaysBetween = (startKey: string, endKey: string) => {
  let days = 0;
  for (let key = startKey; key <= endKey; key = addDays(key, 1)) {
    if (!isWeekend(key)) days++;
  }
  return days;
};

/**
 * Remote work requests in every state the inbox can show.
 *
 * The approved past ones are deliberately built over days attendance already
 * recorded as REMOTE, and deliberately *not* over all of them. That gap is the
 * point: the manager's "N unplanned" figure counts remote days nobody agreed
 * in advance, and with a request behind every one of them it would always
 * read zero.
 */
export async function seedWfh(
  prisma: PrismaClient,
  orgId: string,
  people: People,
  remoteByEmail: Map<string, string[]>,
  random: Random,
  todayKey: string,
) {
  const create = (input: {
    employeeId: string;
    startDate: string;
    endDate: string;
    reason: string;
    status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';
    approver?: string;
    note?: string;
  }) =>
    prisma.remoteWorkRequest.create({
      data: {
        organizationId: orgId,
        employeeId: input.employeeId,
        startDate: toDate(input.startDate),
        endDate: toDate(input.endDate),
        days: workingDaysBetween(input.startDate, input.endDate),
        reason: input.reason,
        status: input.status,
        ...(input.approver
          ? {
              approverId: input.approver,
              actedAt: toDate(addDays(todayKey, -2)),
              approverNote: input.note,
            }
          : {}),
      },
    });

  const manager = people.emp('manager@hrms.local');
  const reports = people.staff.filter((p) => p.managerEmail === 'manager@hrms.local');

  // Roughly half of each person's past remote days get a request behind them.
  for (const person of reports.slice(0, 4)) {
    const remote = remoteByEmail.get(person.email) ?? [];
    for (const day of remote.filter((_, i) => i % 2 === 0).slice(0, 3)) {
      await create({
        employeeId: person.employeeId,
        startDate: day,
        endDate: day,
        reason: random.pick(REASONS),
        status: 'APPROVED',
        approver: manager,
        note: 'Fine — keep standups in the diary.',
      });
    }
  }

  // Two waiting on a decision, one of them a whole week ahead.
  await create({
    employeeId: people.emp('asha@hrms.local'),
    startDate: addDays(todayKey, 3),
    endDate: addDays(todayKey, 3),
    reason: REASONS[0] as string,
    status: 'PENDING',
  });
  await create({
    employeeId: people.emp('rohan@hrms.local'),
    startDate: addDays(todayKey, 7),
    endDate: addDays(todayKey, 11),
    reason: 'Working from my parents’ place for a week',
    status: 'PENDING',
  });

  // Approved and still to come, so the calendar shows a planned remote day.
  await create({
    employeeId: people.emp('asha@hrms.local'),
    startDate: addDays(todayKey, 14),
    endDate: addDays(todayKey, 15),
    reason: REASONS[1] as string,
    status: 'APPROVED',
    approver: manager,
  });

  await create({
    employeeId: people.emp('zara@hrms.local'),
    startDate: addDays(todayKey, 5),
    endDate: addDays(todayKey, 5),
    reason: 'Prefer to take the client call from home',
    status: 'REJECTED',
    approver: people.emp('hr@hrms.local'),
    note: 'Client is on site that day — please come in.',
  });

  await create({
    employeeId: (reports[0] ?? people.byEmail('asha@hrms.local')).employeeId,
    startDate: addDays(todayKey, -9),
    endDate: addDays(todayKey, -9),
    reason: 'Changed my mind, came in after all',
    status: 'CANCELLED',
  });
}
