import {
  canDecide,
  canEdit,
  canSubmit,
  canWithdraw,
  capacityHours,
  dailyTotals,
  decisionError,
  deleteBlockedReason,
  editError,
  isWeekStart,
  loggableProblem,
  MAX_DAILY_HOURS,
  memberRemovalBlockedReason,
  type RuleMembership,
  type RuleProject,
  round2,
  submissionProblems,
  totalsByProject,
  utilisationPercent,
  weekDays,
  weekStartOf,
  weekTotal,
} from './projects.rules';

/**
 * The pure half of the module: what a week adds up to, what may happen to it,
 * and whether an hour was allowed to be logged where it was.
 *
 * Exhaustive here so the service specs can be about wiring. No Prisma, no
 * clock, no fixtures beyond plain objects.
 */

// 2026-08-10 is a Monday. Every date below is anchored to that week.
const MONDAY = '2026-08-10';
const WEDNESDAY = '2026-08-12';
const SUNDAY = '2026-08-16';
const NEXT_MONDAY = '2026-08-17';

const ACTIVE: RuleProject = {
  id: 'p1',
  code: 'APOLLO',
  status: 'ACTIVE',
  startsOn: '2026-01-01',
  endsOn: null,
};

const MEMBER: RuleMembership = { projectId: 'p1', joinedOn: '2026-01-01', leftOn: null };

describe('the week', () => {
  it('finds the Monday from any day in the week', () => {
    for (const day of weekDays(MONDAY)) {
      expect(weekStartOf(day)).toBe(MONDAY);
    }
  });

  /*
   * Sunday is the case a naive `day - 1` gets wrong: getUTCDay() calls it 0, so
   * the arithmetic walks forward into the next week instead of back six days.
   */
  it('puts Sunday at the end of its own week, not the start of the next', () => {
    expect(weekStartOf(SUNDAY)).toBe(MONDAY);
    expect(weekStartOf(NEXT_MONDAY)).toBe(NEXT_MONDAY);
  });

  it('recognises only a Monday as a week start', () => {
    expect(isWeekStart(MONDAY)).toBe(true);
    expect(isWeekStart(SUNDAY)).toBe(false);
    expect(isWeekStart(WEDNESDAY)).toBe(false);
  });

  it('lays out seven consecutive days, Monday first', () => {
    expect(weekDays(MONDAY)).toEqual([
      '2026-08-10',
      '2026-08-11',
      '2026-08-12',
      '2026-08-13',
      '2026-08-14',
      '2026-08-15',
      '2026-08-16',
    ]);
  });

  /* Crossing a month boundary is where string-slicing date maths goes wrong. */
  it('handles a week that spans two months', () => {
    expect(weekStartOf('2026-09-01')).toBe('2026-08-31');
    expect(weekDays('2026-08-31')).toContain('2026-09-06');
  });
});

describe('what may happen to a week', () => {
  it('lets a draft and a sent-back week be edited, and nothing else', () => {
    expect(canEdit('DRAFT')).toBe(true);
    expect(canEdit('REJECTED')).toBe(true);
    expect(canEdit('SUBMITTED')).toBe(false);
    expect(canEdit('APPROVED')).toBe(false);
  });

  it('submits exactly what it can edit', () => {
    for (const status of ['DRAFT', 'REJECTED', 'SUBMITTED', 'APPROVED'] as const) {
      expect(canSubmit(status)).toBe(canEdit(status));
    }
  });

  it('withdraws only a submitted week', () => {
    expect(canWithdraw('SUBMITTED')).toBe(true);
    expect(canWithdraw('DRAFT')).toBe(false);
    expect(canWithdraw('APPROVED')).toBe(false);
    expect(canWithdraw('REJECTED')).toBe(false);
  });

  it('decides only a submitted week', () => {
    expect(canDecide('SUBMITTED')).toBe(true);
    expect(canDecide('DRAFT')).toBe(false);
    expect(canDecide('APPROVED')).toBe(false);
    expect(canDecide('REJECTED')).toBe(false);
  });

  it('explains a refusal in words the person can act on', () => {
    expect(editError('SUBMITTED')).toContain('withdraw');
    expect(editError('APPROVED')).toContain('send it back');
    expect(decisionError('DRAFT')).toContain('not been submitted');
    expect(decisionError('APPROVED')).toContain('already approved');
  });
});

describe('totals', () => {
  const entries = [
    { projectId: 'p1', workedOn: MONDAY, hours: 3.5 },
    { projectId: 'p2', workedOn: MONDAY, hours: 4.25 },
    { projectId: 'p1', workedOn: WEDNESDAY, hours: 8 },
  ];

  it('adds up the week', () => {
    expect(weekTotal(entries)).toBe(15.75);
  });

  it('adds up each day across every project', () => {
    expect(dailyTotals(entries).get(MONDAY)).toBe(7.75);
    expect(dailyTotals(entries).get(WEDNESDAY)).toBe(8);
  });

  it('adds up each project across the week', () => {
    expect(totalsByProject(entries).get('p1')).toBe(11.5);
    expect(totalsByProject(entries).get('p2')).toBe(4.25);
  });

  it('is empty rather than NaN for an empty week', () => {
    expect(weekTotal([])).toBe(0);
    expect(dailyTotals([]).size).toBe(0);
  });

  /* Float addition: 0.1 + 0.2 is the classic, and quarter-hours hit it too. */
  it('rounds away binary float drift', () => {
    expect(round2(0.1 + 0.2)).toBe(0.3);
    expect(weekTotal([{ projectId: 'p1', workedOn: MONDAY, hours: 0.1 + 0.2 }])).toBe(0.3);
  });
});

describe('whether an hour could be logged there', () => {
  it('allows an active project the person is on', () => {
    expect(loggableProblem(ACTIVE, MEMBER, WEDNESDAY)).toBeNull();
  });

  it('allows an on-hold project — the work paused, the record did not', () => {
    expect(loggableProblem({ ...ACTIVE, status: 'ON_HOLD' }, MEMBER, WEDNESDAY)).toBeNull();
  });

  it.each([
    ['PLANNED', 'planned'],
    ['COMPLETED', 'completed'],
    ['CANCELLED', 'cancelled'],
  ] as const)('refuses a %s project by name', (status, word) => {
    const problem = loggableProblem({ ...ACTIVE, status }, MEMBER, WEDNESDAY);
    expect(problem).toBe(`APOLLO is ${word} and takes no more hours`);
  });

  it('refuses a day before the project started', () => {
    const project = { ...ACTIVE, startsOn: '2026-08-13' };
    expect(loggableProblem(project, MEMBER, WEDNESDAY)).toContain('had not started');
  });

  it('refuses a day after the project ended', () => {
    const project = { ...ACTIVE, endsOn: '2026-08-11' };
    expect(loggableProblem(project, MEMBER, WEDNESDAY)).toContain('had ended');
  });

  it('refuses somebody who is not on the project at all', () => {
    expect(loggableProblem(ACTIVE, undefined, WEDNESDAY)).toBe('You are not a member of APOLLO');
  });

  it('refuses a day outside the membership window at either end', () => {
    expect(loggableProblem(ACTIVE, { ...MEMBER, joinedOn: '2026-08-13' }, WEDNESDAY)).toContain(
      'joined APOLLO after',
    );
    expect(loggableProblem(ACTIVE, { ...MEMBER, leftOn: '2026-08-11' }, WEDNESDAY)).toContain(
      'left APOLLO before',
    );
  });

  it('allows the joining and leaving days themselves', () => {
    expect(
      loggableProblem(ACTIVE, { ...MEMBER, joinedOn: WEDNESDAY, leftOn: WEDNESDAY }, WEDNESDAY),
    ).toBeNull();
  });

  it('says something useful when the project is gone entirely', () => {
    expect(loggableProblem(undefined, MEMBER, WEDNESDAY)).toContain('no longer exists');
  });

  /*
   * Order matters. A closed project the person was never on should say the
   * project is closed — that is the fact they can do nothing about, and the
   * membership is beside the point once it is.
   */
  it('reports the project problem before the membership problem', () => {
    const problem = loggableProblem({ ...ACTIVE, status: 'COMPLETED' }, undefined, WEDNESDAY);
    expect(problem).toContain('completed');
  });
});

describe('submitting a week', () => {
  const projects = [ACTIVE];
  const memberships = [MEMBER];

  it('passes a clean week and reports its total', () => {
    const { problems, total } = submissionProblems(
      [
        { projectId: 'p1', workedOn: MONDAY, hours: 8 },
        { projectId: 'p1', workedOn: WEDNESDAY, hours: 7.5 },
      ],
      projects,
      memberships,
      MONDAY,
    );
    expect(problems).toEqual([]);
    expect(total).toBe(15.5);
  });

  it('refuses an empty week', () => {
    const { problems } = submissionProblems([], projects, memberships, MONDAY);
    expect(problems).toContain('Log some hours before submitting');
  });

  it('refuses a week that does not start on a Monday', () => {
    const { problems } = submissionProblems(
      [{ projectId: 'p1', workedOn: SUNDAY, hours: 8 }],
      projects,
      memberships,
      SUNDAY,
    );
    expect(problems).toContain('A timesheet week runs Monday to Sunday');
  });

  it('refuses a day outside the week', () => {
    const { problems } = submissionProblems(
      [{ projectId: 'p1', workedOn: NEXT_MONDAY, hours: 8 }],
      projects,
      memberships,
      MONDAY,
    );
    expect(problems).toContain(`${NEXT_MONDAY} is not in the week beginning ${MONDAY}`);
  });

  it('refuses a day totalling more than a day, across every project at once', () => {
    const { problems } = submissionProblems(
      [
        { projectId: 'p1', workedOn: MONDAY, hours: 14 },
        { projectId: 'p1', workedOn: MONDAY, hours: 12 },
      ],
      projects,
      memberships,
      MONDAY,
    );
    expect(problems.some((p) => p.includes(`a day has ${MAX_DAILY_HOURS}`))).toBe(true);
  });

  /*
   * Zod refuses this on the wire, but the seed and any future importer reach
   * the rules without passing through it — so the rules say so themselves.
   */
  it('refuses hours that are not a quarter-hour step', () => {
    const { problems } = submissionProblems(
      [{ projectId: 'p1', workedOn: MONDAY, hours: 1.3 }],
      projects,
      memberships,
      MONDAY,
    );
    expect(problems.some((p) => p.includes('quarter-hour'))).toBe(true);
  });

  /*
   * The whole reason this returns an array rather than throwing on the first
   * failure: fixing one problem and only then hearing about the next is what
   * makes people abandon a form.
   */
  it('reports every distinct problem in one pass', () => {
    const { problems } = submissionProblems(
      [
        { projectId: 'p1', workedOn: NEXT_MONDAY, hours: 8 },
        { projectId: 'p2', workedOn: MONDAY, hours: 4 },
      ],
      projects,
      memberships,
      MONDAY,
    );
    expect(problems).toHaveLength(2);
  });

  /*
   * A project that closed last month produces the same sentence once per day it
   * was logged against. Five copies of it are not five pieces of information.
   */
  it('says a repeated problem once', () => {
    const closed = [{ ...ACTIVE, status: 'COMPLETED' as const }];
    const { problems } = submissionProblems(
      weekDays(MONDAY)
        .slice(0, 5)
        .map((day) => ({ projectId: 'p1', workedOn: day, hours: 8 })),
      closed,
      memberships,
      MONDAY,
    );
    expect(problems).toEqual(['APOLLO is completed and takes no more hours']);
  });
});

describe('guardrails on the register', () => {
  it('lets an unused project go', () => {
    expect(deleteBlockedReason(0)).toBeNull();
  });

  it('names the count and offers the way out', () => {
    const reason = deleteBlockedReason(37);
    expect(reason).toContain('37');
    expect(reason).toContain('Completed');
  });

  it('gets the singular right, because "1 entries" reads as a bug', () => {
    expect(deleteBlockedReason(1)).toContain('1 timesheet entry has');
    expect(deleteBlockedReason(2)).toContain('2 timesheet entries have');
  });

  it('offers a leaving date rather than deletion once somebody has logged hours', () => {
    expect(memberRemovalBlockedReason(0)).toBeNull();
    expect(memberRemovalBlockedReason(4)).toContain('leaving date');
    expect(memberRemovalBlockedReason(1)).toContain('1 timesheet entry');
  });
});

describe('utilisation', () => {
  it('is hours over a full-time week', () => {
    expect(capacityHours(1)).toBe(40);
    expect(capacityHours(4)).toBe(160);
  });

  it('never returns a negative capacity for an inverted range', () => {
    expect(capacityHours(-3)).toBe(0);
  });

  it('is a percentage of that capacity', () => {
    expect(utilisationPercent(20, 40)).toBe(50);
    expect(utilisationPercent(40, 40)).toBe(100);
  });

  /* Over-allocation is real and must be visible, not clamped away. */
  it('reports above 100% rather than capping', () => {
    expect(utilisationPercent(52, 40)).toBe(130);
  });

  it('is zero rather than Infinity when there is no capacity', () => {
    expect(utilisationPercent(10, 0)).toBe(0);
  });
});
