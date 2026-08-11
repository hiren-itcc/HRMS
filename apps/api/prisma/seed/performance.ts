import { addDays, toDate } from '../../src/common/utils/calendar';
import type { PrismaClient } from '../../src/generated/prisma/client';
import type { People, SeededPerson } from './people';
import type { Random } from './random';

/**
 * Review cycles, goals and reviews — one of every state on screen.
 *
 * The pieces worth checking by eye rather than only in a test:
 *
 * - A **closed** cycle behind the current one, so "earlier cycles" is not an
 *   empty panel and a rating exists to read back.
 * - The open cycle carries every review state at once: waiting on the employee,
 *   waiting on the manager, shared but unsigned (so the acknowledge button is
 *   pressable), signed off, and one dropped for a leaver.
 * - One review with **no reviewer at all** — the CEO, who has no manager. That
 *   is the path where HR has to reassign before it can move, and it is
 *   invisible unless somebody is actually in it.
 * - One employee with a weighted goal set totalling exactly 100 and another
 *   with an unweighted set, so both branches of `weightProblems` and both
 *   branches of `weightedProgress` (a number, and `null`) are on screen.
 * - One goal past its `dueOn` and still short of 100%, so the derived overdue
 *   badge has something to render.
 * - A **draft** cycle for next period, so the Open button has something to press.
 */

/** `YYYY-MM-DD` for the first of the month, `back` months before today. */
function monthStart(todayKey: string, back: number): string {
  const [y = '1970', m = '01'] = todayKey.split('-');
  const date = new Date(Date.UTC(Number(y), Number(m) - 1 - back, 1));
  return date.toISOString().slice(0, 10);
}

export async function seedPerformance(
  prisma: PrismaClient,
  orgId: string,
  people: People,
  random: Random,
  todayKey: string,
) {
  /*
   * Anybody a review makes sense for. `staff` already excludes people who are
   * gone or not yet started, which is the same cut `isEligible` makes — so the
   * seed and the rule cannot disagree about who should be here.
   */
  const enrolled = people.staff.slice(0, 14);
  const byId = new Map(enrolled.map((person) => [person.employeeId, person]));
  const managerOf = (person: SeededPerson): string | null =>
    person.managerEmail ? (people.emp(person.managerEmail) ?? null) : null;

  // ── The closed cycle behind us ────────────────────────────────────────
  const previous = await prisma.reviewCycle.create({
    data: {
      organizationId: orgId,
      name: `H2 ${Number(todayKey.slice(0, 4)) - 1}`,
      periodStart: toDate(monthStart(todayKey, 12)),
      periodEnd: toDate(addDays(monthStart(todayKey, 6), -1)),
      dueOn: toDate(monthStart(todayKey, 6)),
      status: 'CLOSED',
      openedAt: new Date(),
      closedAt: new Date(),
    },
  });

  for (const person of enrolled) {
    const reviewerId = managerOf(person);
    const rating = random.int(3, 5);
    await prisma.performanceReview.create({
      data: {
        organizationId: orgId,
        cycleId: previous.id,
        employeeId: person.employeeId,
        reviewerId,
        status: 'ACKNOWLEDGED',
        selfRating: rating,
        selfComment: 'A steady half. Shipped what I said I would, and learned where I did not.',
        selfSubmittedAt: new Date(),
        managerRating: rating,
        managerComment: 'Reliable through the half, and visibly better at the harder work.',
        managerActions: 'Take the lead on one cross-team piece next cycle.',
        managerSubmittedAt: new Date(),
        sharedAt: new Date(),
        acknowledgedAt: new Date(),
      },
    });
  }

  // ── The one that is running ───────────────────────────────────────────
  const current = await prisma.reviewCycle.create({
    data: {
      organizationId: orgId,
      name: `H1 ${todayKey.slice(0, 4)}`,
      periodStart: toDate(monthStart(todayKey, 5)),
      periodEnd: toDate(monthStart(todayKey, -1)),
      // Yesterday, so the cycle reads as "assessments due" rather than as
      // months of quiet — the phase most worth looking at.
      dueOn: toDate(addDays(todayKey, -1)),
      status: 'OPEN',
      openedAt: new Date(),
    },
  });

  /*
   * The spread. Index-based rather than random so the demo workspace is the
   * same every time — the whole reason `makeRandom` is seeded.
   */
  const states = [
    'PENDING_SELF',
    'PENDING_SELF',
    'PENDING_SELF',
    'PENDING_MANAGER',
    'PENDING_MANAGER',
    'SHARED',
    'ACKNOWLEDGED',
    'CANCELLED',
  ] as const;

  for (const [index, person] of enrolled.entries()) {
    const status = states[index % states.length] ?? 'PENDING_SELF';
    const reviewerId = managerOf(person);
    const wroteSelf = status !== 'PENDING_SELF';
    const wroteManager = status === 'SHARED' || status === 'ACKNOWLEDGED';
    const rating = random.int(2, 5);

    await prisma.performanceReview.create({
      data: {
        organizationId: orgId,
        cycleId: current.id,
        employeeId: person.employeeId,
        // The CEO has no manager, and that review is meant to be visible
        // sitting on HR's desk waiting to be reassigned.
        reviewerId,
        status,
        ...(wroteSelf
          ? {
              selfRating: rating,
              selfComment:
                'Two of the three landed. The third slipped, and most of why was mine to fix.',
              selfSubmittedAt: new Date(),
            }
          : {}),
        ...(wroteManager
          ? {
              managerRating: rating,
              managerComment: 'Good half. Clear about what went wrong, which is the harder part.',
              managerActions: 'Pair on the estimate for the next big piece.',
              managerSubmittedAt: new Date(),
              sharedAt: new Date(),
            }
          : {}),
        ...(status === 'ACKNOWLEDGED' ? { acknowledgedAt: new Date() } : {}),
        ...(status === 'CANCELLED' ? { cancelNote: 'Left before the cycle ended.' } : {}),
      },
    });
  }

  // ── Goals ─────────────────────────────────────────────────────────────

  /*
   * The first person gets weights totalling exactly 100; the second gets a set
   * with no weights at all. Both are legitimate, they render differently, and
   * `weightProblems` has to stay quiet about both — which is only checkable by
   * eye if both exist.
   */
  const weighted: { title: string; weight: number; progress: number }[] = [
    { title: 'Ship the billing rewrite', weight: 50, progress: 70 },
    { title: 'Cut p95 on the dashboard below 300ms', weight: 30, progress: 45 },
    { title: 'Bring one junior engineer up to independent review', weight: 20, progress: 90 },
  ];
  const unweighted: { title: string; weight: number; progress: number }[] = [
    { title: 'Close the quarter with no overdue tickets', weight: 0, progress: 60 },
    { title: 'Write the runbook nobody has written', weight: 0, progress: 20 },
  ];

  const goalOwners = enrolled.slice(0, 8);
  for (const [index, person] of goalOwners.entries()) {
    const set = index === 1 ? unweighted : weighted;
    for (const [goalIndex, goal] of set.entries()) {
      await prisma.performanceGoal.create({
        data: {
          organizationId: orgId,
          cycleId: current.id,
          employeeId: person.employeeId,
          title: goal.title,
          description: 'Agreed at the start of the half.',
          target: 'Done means it is in production and somebody other than me has used it.',
          weight: goal.weight,
          progress: goal.progress,
          status: 'ACTIVE',
          // The first goal of the first person is deliberately late and
          // unfinished, so the derived overdue badge has a subject.
          dueOn:
            index === 0 && goalIndex === 0
              ? toDate(addDays(todayKey, -9))
              : toDate(addDays(todayKey, 20)),
        },
      });
    }
  }

  // ── And one to open ───────────────────────────────────────────────────
  await prisma.reviewCycle.create({
    data: {
      organizationId: orgId,
      name: `H2 ${todayKey.slice(0, 4)}`,
      periodStart: toDate(monthStart(todayKey, -1)),
      periodEnd: toDate(addDays(monthStart(todayKey, -7), -1)),
      dueOn: toDate(monthStart(todayKey, -7)),
      status: 'DRAFT',
    },
  });

  return { cycles: 3, enrolled: enrolled.length, goals: goalOwners.length * 3, byId };
}
