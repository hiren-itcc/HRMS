import { createHash, createHmac } from 'node:crypto';
import { addDays, toDate } from '../../src/common/utils/calendar';
import type { PrismaClient } from '../../src/generated/prisma/client';
import type { People } from './people';

/**
 * The two hires who have not started yet.
 *
 * One is still filling things in, one has submitted and is waiting on HR — the
 * two halves of the review queue. Their invite tokens are derived from the
 * employee id rather than random, so a re-seed does not silently invalidate a
 * link somebody had open; they are unusable either way, because only the
 * sha256 is stored and nothing prints the raw value.
 */
export async function seedOnboarding(
  prisma: PrismaClient,
  people: People,
  todayKey: string,
): Promise<void> {
  const hires = people.all.filter((p) => p.status === 'ONBOARDING');
  const hr = people.usr('hr@hrms.local');

  for (const [i, hire] of hires.entries()) {
    const token = createHmac('sha256', 'seed').update(hire.employeeId).digest('hex');
    await prisma.employeeInvite.create({
      data: {
        employeeId: hire.employeeId,
        tokenHash: createHash('sha256').update(token).digest('hex'),
        sentToEmail: `${hire.firstName}.${hire.lastName}`.toLowerCase().concat('@example.com'),
        expiresAt: toDate(addDays(todayKey, 7)),
        usedAt: toDate(addDays(todayKey, -1)),
        createdById: hr,
      },
    });

    const submitted = i === 1;
    await prisma.onboarding.create({
      data: {
        employeeId: hire.employeeId,
        status: submitted ? 'SUBMITTED' : 'IN_PROGRESS',
        // Answered rather than left null: an empty documents folder and "I
        // declared this is my first job" are different states, and only the
        // second completes the step.
        hasPreviousEmployment: submitted ? true : null,
        submittedAt: submitted ? toDate(addDays(todayKey, -1)) : null,
      },
    });
  }
}
