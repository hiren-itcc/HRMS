import { addDays, toDate } from '../../src/common/utils/calendar';
import type { PrismaClient } from '../../src/generated/prisma/client';
import { weekStartOf } from '../../src/modules/projects/projects.rules';
import type { People } from './people';
import type { Random } from './random';

/**
 * Projects and six weeks of timesheets, with one of every state on screen.
 *
 * The pieces worth checking by eye rather than only in a test:
 *
 * - A project in **every** status. PLANNED and COMPLETED are what the "takes no
 *   more hours" refusal reads from, and they are invisible in a register that
 *   only ever seeds ACTIVE.
 * - A member with a **leaving date**, so the membership window is visible.
 *   Their hours stay, which is the whole reason `leftOn` exists rather than a
 *   delete.
 * - Weeks in DRAFT, SUBMITTED, APPROVED **and** REJECTED. The rejected one
 *   carries a note, because a rejection without one is a state the service
 *   refuses to create and the screen should never have to render.
 * - Somebody split across two projects in one week, which is the only way the
 *   per-day total across projects is visible on the grid.
 */

/** Monday, `back` weeks before the Monday of the week `todayKey` falls in. */
function weekBack(todayKey: string, back: number): string {
  return addDays(weekStartOf(todayKey), -7 * back);
}

export async function seedProjects(
  prisma: PrismaClient,
  orgId: string,
  people: People,
  random: Random,
  todayKey: string,
) {
  // A manager owns the projects, so the ownership grant — a project's own
  // manager staffing it without `project.manage` — is exercisable by signing in
  // as them rather than only in a unit test.
  const owner = people.staff.find((person) => person.role === 'MANAGER') ?? people.staff[0];
  if (!owner) return;

  // Everybody who can hold a project down: staff, minus the manager we are
  // making the owner, capped so the seed stays legible on screen.
  const crew = people.staff.filter((person) => person.employeeId !== owner.employeeId).slice(0, 6);
  if (crew.length < 2) return;

  const specs = [
    {
      code: 'APOLLO',
      name: 'Apollo replatform',
      description: 'Moving the billing stack off the legacy scheduler.',
      status: 'ACTIVE' as const,
      startsOn: weekBack(todayKey, 20),
      endsOn: null,
    },
    {
      code: 'ATLAS',
      name: 'Atlas data migration',
      description: 'One-off migration of ten years of historical records.',
      status: 'ACTIVE' as const,
      startsOn: weekBack(todayKey, 12),
      endsOn: null,
    },
    {
      code: 'BOREAS',
      name: 'Boreas cost review',
      description: 'Paused pending the quarterly budget.',
      status: 'ON_HOLD' as const,
      startsOn: weekBack(todayKey, 8),
      endsOn: null,
    },
    {
      code: 'CERES',
      name: 'Ceres onboarding refresh',
      description: 'Approved, not yet started.',
      status: 'PLANNED' as const,
      startsOn: addDays(weekStartOf(todayKey), 14),
      endsOn: null,
    },
    {
      code: 'DELOS',
      name: 'Delos office move',
      description: 'Delivered last quarter.',
      status: 'COMPLETED' as const,
      startsOn: weekBack(todayKey, 30),
      endsOn: weekBack(todayKey, 10),
    },
  ];

  const projects = [];
  for (const spec of specs) {
    projects.push(
      await prisma.project.create({
        data: {
          organizationId: orgId,
          code: spec.code,
          name: spec.name,
          description: spec.description,
          status: spec.status,
          startsOn: toDate(spec.startsOn),
          endsOn: spec.endsOn ? toDate(spec.endsOn) : null,
          managerId: owner.employeeId,
        },
      }),
    );
  }

  const [apollo, atlas, boreas] = projects;
  if (!apollo || !atlas || !boreas) return;

  const ROLES = ['Engineer', 'Designer', 'Analyst', 'Tech lead', 'QA'];

  // Apollo takes everybody; Atlas takes the first half. The overlap is what
  // puts two projects on one person's week.
  const apolloCrew = crew;
  const atlasCrew = crew.slice(0, Math.max(2, Math.ceil(crew.length / 2)));

  for (const [index, person] of apolloCrew.entries()) {
    // One person rolled off last month. Their hours stay — that is what a
    // leaving date is for, and why removal is refused once there are any.
    const rolledOff = index === apolloCrew.length - 1;
    await prisma.projectMember.create({
      data: {
        projectId: apollo.id,
        employeeId: person.employeeId,
        role: ROLES[index % ROLES.length] ?? 'Engineer',
        allocation: rolledOff ? 40 : random.pick([50, 60, 80, 100]),
        joinedOn: toDate(weekBack(todayKey, 18 - index)),
        leftOn: rolledOff ? toDate(weekBack(todayKey, 4)) : null,
      },
    });
  }

  for (const [index, person] of atlasCrew.entries()) {
    await prisma.projectMember.create({
      data: {
        projectId: atlas.id,
        employeeId: person.employeeId,
        role: ROLES[(index + 2) % ROLES.length] ?? 'Analyst',
        allocation: random.pick([20, 40, 50]),
        joinedOn: toDate(weekBack(todayKey, 10)),
        leftOn: null,
      },
    });
  }

  await prisma.projectMember.create({
    data: {
      projectId: boreas.id,
      employeeId: owner.employeeId,
      role: 'Tech lead',
      allocation: 20,
      joinedOn: toDate(weekBack(todayKey, 8)),
      leftOn: null,
    },
  });

  /*
   * Six weeks back, one row per person per week.
   *
   * The oldest are settled and the newest are not, which is what a real
   * timesheet history looks like: week 5 approved, week 1 still a draft
   * somebody has not sent. Week 2 is the rejected one and carries a note.
   */
  const STATUSES = [
    { back: 5, status: 'APPROVED' as const },
    { back: 4, status: 'APPROVED' as const },
    { back: 3, status: 'APPROVED' as const },
    { back: 2, status: 'REJECTED' as const },
    { back: 1, status: 'SUBMITTED' as const },
    { back: 0, status: 'DRAFT' as const },
  ];

  // Only people still on Apollo for the whole stretch, so no seeded entry
  // lands outside its own membership window.
  const loggers = apolloCrew.slice(0, -1);

  for (const person of loggers) {
    const onAtlas = atlasCrew.some((other) => other.employeeId === person.employeeId);

    for (const { back, status } of STATUSES) {
      const weekStart = weekBack(todayKey, back);
      const entries: { projectId: string; workedOn: Date; hours: number }[] = [];

      // Monday to Friday. The weekend stays empty, which is the normal case
      // and the one the grid has to render without looking broken.
      for (let day = 0; day < 5; day += 1) {
        const workedOn = toDate(addDays(weekStart, day));
        if (onAtlas && day >= 3) {
          entries.push({ projectId: atlas.id, workedOn, hours: random.pick([3, 4, 4.5]) });
          entries.push({ projectId: apollo.id, workedOn, hours: random.pick([3.5, 4]) });
        } else {
          entries.push({ projectId: apollo.id, workedOn, hours: random.pick([7, 7.5, 8]) });
        }
      }

      const decided = status === 'APPROVED' || status === 'REJECTED';
      await prisma.timesheet.create({
        data: {
          organizationId: orgId,
          employeeId: person.employeeId,
          weekStart: toDate(weekStart),
          status,
          submittedAt: status === 'DRAFT' ? null : toDate(addDays(weekStart, 7)),
          decidedById: decided ? owner.userId : null,
          decidedAt: decided ? toDate(addDays(weekStart, 8)) : null,
          decisionNote:
            status === 'REJECTED'
              ? 'Thursday looks like Atlas rather than Apollo — please split it.'
              : null,
          entries: { create: entries },
        },
      });
    }
  }
}
