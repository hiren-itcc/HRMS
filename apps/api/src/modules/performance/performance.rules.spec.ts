import { GOAL_STATUSES, REVIEW_CYCLE_STATUSES, REVIEW_STATUSES } from '@hrms/shared';
import type { ReviewAction } from './performance.rules';
import {
  averageProgress,
  blocksClose,
  canCloseCycle,
  canDeleteCycle,
  canEditCycle,
  canEditGoal,
  canOpenCycle,
  closeProblems,
  cycleCoverage,
  eligibleFor,
  isEligible,
  isGoalOverdue,
  managerSubmissionProblems,
  nextStatus,
  overlapsExistingCycle,
  periodProblems,
  selfSubmissionProblems,
  weightedProgress,
  weightProblems,
  weightTotal,
} from './performance.rules';

const employee = (over: Partial<Parameters<typeof isEligible>[0]> = {}) => ({
  id: 'e1',
  status: 'ACTIVE',
  joinDate: '2025-01-01',
  managerId: 'm1',
  ...over,
});

const cycle = { periodEnd: '2026-06-30', minServiceDays: 90 };

describe('cycle transitions', () => {
  it('lets only a draft be edited', () => {
    expect(canEditCycle('DRAFT')).toBe(true);
    expect(canEditCycle('OPEN')).toBe(false);
    expect(canEditCycle('CLOSED')).toBe(false);
  });

  /*
   * The counterintuitive one. A closed cycle is openable on purpose: it is what
   * lets a prematurely closed cycle be reopened, and what makes enrolling
   * somebody who joined late a re-run of `open` rather than a special case.
   */
  it('lets a closed cycle be opened again', () => {
    expect(canOpenCycle('CLOSED')).toBe(true);
    expect(canOpenCycle('DRAFT')).toBe(true);
    expect(canOpenCycle('OPEN')).toBe(false);
  });

  it('closes only what is running', () => {
    expect(canCloseCycle('OPEN')).toBe(true);
    expect(canCloseCycle('DRAFT')).toBe(false);
  });

  it('refuses to delete a cycle anybody has been enrolled in', () => {
    expect(canDeleteCycle('DRAFT', 0)).toBe(true);
    expect(canDeleteCycle('DRAFT', 1)).toBe(false);
    expect(canDeleteCycle('OPEN', 0)).toBe(false);
  });
});

describe('periodProblems', () => {
  it('refuses a cycle that ends before it starts', () => {
    expect(periodProblems({ periodStart: '2026-07-01', periodEnd: '2026-01-01' }, null)).toEqual([
      'The cycle has to end after it starts.',
    ]);
  });

  it('allows a year and refuses three', () => {
    expect(periodProblems({ periodStart: '2026-01-01', periodEnd: '2026-12-31' }, null)).toEqual(
      [],
    );
    expect(
      periodProblems({ periodStart: '2026-01-01', periodEnd: '2029-01-01' }, null),
    ).toHaveLength(1);
  });

  it('refuses a due date before the period it assesses', () => {
    const problems = periodProblems(
      { periodStart: '2026-01-01', periodEnd: '2026-06-30' },
      '2025-12-01',
    );
    expect(problems).toEqual(['Assessments cannot be due before the period they assess.']);
  });

  /* One at a time is a form people abandon. */
  it('reports every problem at once', () => {
    const problems = periodProblems(
      { periodStart: '2026-07-01', periodEnd: '2026-01-01' },
      '2026-01-01',
    );
    expect(problems).toHaveLength(2);
  });
});

describe('overlapsExistingCycle', () => {
  const h1 = { periodStart: '2026-01-01', periodEnd: '2026-06-30' };

  /* Half-open: H1 ending on the 30th and H2 starting on the 1st are adjacent,
     not overlapping. Getting this wrong makes every second cycle unopenable. */
  it('does not treat abutting cycles as an overlap', () => {
    expect(
      overlapsExistingCycle({ periodStart: '2026-07-01', periodEnd: '2026-12-31' }, [h1]),
    ).toBe(false);
  });

  it('catches an identical, a contained and a single-day-shared cycle', () => {
    expect(overlapsExistingCycle(h1, [h1])).toBe(true);
    expect(
      overlapsExistingCycle({ periodStart: '2026-02-01', periodEnd: '2026-03-01' }, [h1]),
    ).toBe(true);
    expect(
      overlapsExistingCycle({ periodStart: '2026-06-30', periodEnd: '2026-12-31' }, [h1]),
    ).toBe(true);
  });

  it('is false against nothing', () => {
    expect(overlapsExistingCycle(h1, [])).toBe(false);
  });
});

describe('eligibility', () => {
  it('excludes somebody who never started and somebody already gone', () => {
    expect(isEligible(employee({ status: 'ONBOARDING' }), cycle)).toBe(false);
    expect(isEligible(employee({ status: 'EXITED' }), cycle)).toBe(false);
    expect(isEligible(employee({ status: 'ON_NOTICE' }), cycle)).toBe(true);
  });

  it('excludes somebody three weeks in and includes them at exactly the threshold', () => {
    expect(isEligible(employee({ joinDate: '2026-06-20' }), cycle)).toBe(false);
    // 2026-04-01 → 2026-06-30 is 90 days. The boundary is inclusive.
    expect(isEligible(employee({ joinDate: '2026-04-01' }), cycle)).toBe(true);
  });

  it('includes a day-one joiner when the threshold is zero', () => {
    expect(isEligible(employee({ joinDate: '2026-06-30' }), { ...cycle, minServiceDays: 0 })).toBe(
      true,
    );
  });

  /*
   * The asymmetry this function exists for. Whoever is at the top of the chart
   * has no manager, and excluding them would mean the CEO is silently absent
   * from every cycle the company runs. They are enrolled; HR assigns a reviewer.
   */
  it('still enrols somebody with no manager', () => {
    expect(isEligible(employee({ managerId: null }), cycle)).toBe(true);
  });

  it('filters a list', () => {
    const people = [employee({ id: 'a' }), employee({ id: 'b', status: 'EXITED' })];
    expect(eligibleFor(people, cycle).map((p) => p.id)).toEqual(['a']);
  });
});

describe('goal editing', () => {
  it('refuses a closed cycle and a dropped goal', () => {
    expect(canEditGoal('OPEN', 'ACTIVE')).toBe(true);
    expect(canEditGoal('CLOSED', 'ACTIVE')).toBe(false);
    expect(canEditGoal('OPEN', 'CANCELLED')).toBe(false);
  });
});

describe('weights', () => {
  it('says nothing when nothing is weighted', () => {
    expect(weightProblems([{ weight: 0 }, { weight: 0 }])).toEqual([]);
  });

  it('says nothing at exactly 100, and nothing about an empty list', () => {
    expect(weightProblems([{ weight: 60 }, { weight: 40 }])).toEqual([]);
    expect(weightProblems([{ weight: 100 }])).toEqual([]);
    expect(weightProblems([])).toEqual([]);
  });

  it('names the total when it is short or over', () => {
    expect(weightProblems([{ weight: 40 }, { weight: 50 }])[0]).toContain('90%');
    expect(weightProblems([{ weight: 60 }, { weight: 55 }])[0]).toContain('115%');
  });

  /* Half-weighted is the one that looks fine and is not: that 0 is almost
     always somebody who stopped halfway, not a goal worth nothing. */
  it('refuses a partly-weighted set, and does not also complain about the total', () => {
    const problems = weightProblems([{ weight: 50 }, { weight: 50 }, { weight: 0 }]);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('no weight');
  });

  it('totals', () => {
    expect(weightTotal([{ weight: 30 }, { weight: 70 }])).toBe(100);
  });
});

describe('weightedProgress', () => {
  /* null, not 0 — "not weighted" is not "no progress", and a 0 would draw an
     honest-looking empty bar. Same distinction as an absent expense cap. */
  it('is null when nothing is weighted', () => {
    expect(weightedProgress([{ weight: 0, progress: 80 }])).toBeNull();
    expect(weightedProgress([])).toBeNull();
  });

  it('weights the average', () => {
    expect(
      weightedProgress([
        { weight: 50, progress: 100 },
        { weight: 50, progress: 0 },
      ]),
    ).toBe(50);
  });

  /* The 0.1 + 0.2 guard, lifted from expense.rules.spec.ts because it is the
     same class of bug: a figure that renders as 33.300000000000004. */
  it('does not leak float dust', () => {
    const value = weightedProgress([
      { weight: 30, progress: 33 },
      { weight: 70, progress: 66 },
    ]);
    expect(value).toBe(Number(value?.toFixed(1)));
  });

  it('ignores unweighted goals rather than counting them as zero', () => {
    expect(
      weightedProgress([
        { weight: 100, progress: 50 },
        { weight: 0, progress: 0 },
      ]),
    ).toBe(50);
  });
});

describe('averageProgress', () => {
  it('is 0 for nothing, not NaN', () => {
    expect(averageProgress([])).toBe(0);
  });

  it('averages', () => {
    expect(averageProgress([{ progress: 100 }, { progress: 50 }])).toBe(75);
  });
});

describe('isGoalOverdue', () => {
  const today = '2026-06-15';

  it('is true for an active goal whose date has passed', () => {
    expect(isGoalOverdue({ dueOn: '2026-06-14', status: 'ACTIVE' }, today)).toBe(true);
  });

  /* Today is not late. Off by one here means every goal due today is scolded. */
  it('is false on the due date itself', () => {
    expect(isGoalOverdue({ dueOn: today, status: 'ACTIVE' }, today)).toBe(false);
  });

  it('is false once the goal is finished, however late', () => {
    expect(isGoalOverdue({ dueOn: '2020-01-01', status: 'ACHIEVED' }, today)).toBe(false);
    expect(isGoalOverdue({ dueOn: '2020-01-01', status: 'MISSED' }, today)).toBe(false);
  });

  it('is false with no due date', () => {
    expect(isGoalOverdue({ dueOn: null, status: 'ACTIVE' }, today)).toBe(false);
  });
});

/**
 * The exhaustive one, and the reason `nextStatus` is a table rather than a pile
 * of if-statements: every status × every action is asserted, so adding a status
 * member without giving it a row fails here rather than silently refusing
 * everything at runtime.
 */
describe('the review state machine', () => {
  const ACTIONS: ReviewAction[] = [
    'saveSelf',
    'submitSelf',
    'skipSelf',
    'saveManager',
    'share',
    'acknowledge',
    'reopen',
    'cancel',
  ];

  const EXPECTED: Record<string, Record<string, string | null>> = {
    PENDING_SELF: {
      saveSelf: 'PENDING_SELF',
      submitSelf: 'PENDING_MANAGER',
      skipSelf: 'PENDING_MANAGER',
      saveManager: null,
      share: null,
      acknowledge: null,
      reopen: null,
      cancel: 'CANCELLED',
    },
    PENDING_MANAGER: {
      saveSelf: null,
      submitSelf: null,
      skipSelf: null,
      saveManager: 'PENDING_MANAGER',
      share: 'SHARED',
      acknowledge: null,
      reopen: null,
      cancel: 'CANCELLED',
    },
    SHARED: {
      saveSelf: null,
      submitSelf: null,
      skipSelf: null,
      saveManager: null,
      share: null,
      acknowledge: 'ACKNOWLEDGED',
      reopen: 'PENDING_MANAGER',
      cancel: 'CANCELLED',
    },
    ACKNOWLEDGED: {
      saveSelf: null,
      submitSelf: null,
      skipSelf: null,
      saveManager: null,
      share: null,
      acknowledge: null,
      reopen: 'PENDING_MANAGER',
      cancel: null,
    },
    CANCELLED: {
      saveSelf: null,
      submitSelf: null,
      skipSelf: null,
      saveManager: null,
      share: null,
      acknowledge: null,
      reopen: null,
      cancel: null,
    },
  };

  it.each(REVIEW_STATUSES)('has a row for %s', (status) => {
    expect(EXPECTED[status]).toBeDefined();
  });

  for (const status of REVIEW_STATUSES) {
    for (const action of ACTIONS) {
      it(`${action} from ${status}`, () => {
        expect(nextStatus(status, action)).toBe(EXPECTED[status][action]);
      });
    }
  }

  /* Signed off and then erased is not something this system should offer. It
     can be reopened, which leaves the trail. */
  it('will not cancel a review the employee has already signed', () => {
    expect(nextStatus('ACKNOWLEDGED', 'cancel')).toBeNull();
    expect(nextStatus('ACKNOWLEDGED', 'reopen')).toBe('PENDING_MANAGER');
  });

  it('lets nothing out of CANCELLED', () => {
    for (const action of ACTIONS) expect(nextStatus('CANCELLED', action)).toBeNull();
  });
});

describe('selfSubmissionProblems', () => {
  const good = { selfRating: 4, selfComment: 'A solid half.' };

  it('passes a complete draft', () => {
    expect(selfSubmissionProblems(good, [{ weight: 100 }])).toEqual([]);
  });

  it('refuses an empty comment and whitespace alone', () => {
    expect(selfSubmissionProblems({ ...good, selfComment: '' }, [])).toHaveLength(1);
    expect(selfSubmissionProblems({ ...good, selfComment: '   ' }, [])).toHaveLength(1);
  });

  it('refuses a missing or out-of-range rating', () => {
    expect(selfSubmissionProblems({ ...good, selfRating: null }, [])).toHaveLength(1);
    expect(selfSubmissionProblems({ ...good, selfRating: 0 }, [])).toHaveLength(1);
    expect(selfSubmissionProblems({ ...good, selfRating: 6 }, [])).toHaveLength(1);
  });

  /* A perfectly-written assessment over a broken weight set is still not
     submittable, and the weight problem has to surface here or nowhere. */
  it('carries weight problems through', () => {
    const problems = selfSubmissionProblems(good, [{ weight: 40 }, { weight: 40 }]);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('80%');
  });

  it('reports everything at once', () => {
    expect(selfSubmissionProblems({ selfRating: null, selfComment: '' }, [])).toHaveLength(2);
  });
});

describe('managerSubmissionProblems', () => {
  it('refuses a rating with no words, and words with no rating', () => {
    expect(managerSubmissionProblems({ managerRating: 4, managerComment: null })).toEqual([
      'Write something to go with the rating.',
    ]);
    expect(managerSubmissionProblems({ managerRating: null, managerComment: 'Good' })).toEqual([
      'Give a rating.',
    ]);
  });

  it('reports both at once', () => {
    expect(managerSubmissionProblems({ managerRating: null, managerComment: '' })).toHaveLength(2);
  });
});

describe('cycle coverage and closing', () => {
  const reviews = (statuses: string[]) =>
    statuses.map((status) => ({ status }) as { status: (typeof REVIEW_STATUSES)[number] });

  it('counts every state', () => {
    const coverage = cycleCoverage(
      reviews(['PENDING_SELF', 'PENDING_MANAGER', 'SHARED', 'ACKNOWLEDGED', 'CANCELLED']),
    );
    expect(coverage).toEqual({
      total: 5,
      pendingSelf: 1,
      pendingManager: 1,
      shared: 1,
      acknowledged: 1,
      cancelled: 1,
    });
  });

  it('closes clean when everything is finished, and when there is nothing at all', () => {
    expect(blocksClose(cycleCoverage(reviews(['ACKNOWLEDGED', 'ACKNOWLEDGED'])))).toBe(false);
    expect(blocksClose(cycleCoverage([]))).toBe(false);
  });

  it('blocks on an unwritten self-assessment and names the count', () => {
    const coverage = cycleCoverage(reviews(['PENDING_SELF', 'PENDING_SELF', 'ACKNOWLEDGED']));
    expect(blocksClose(coverage)).toBe(true);
    expect(closeProblems(coverage)[0]).toContain('2 people');
  });

  /* Dropped reviews were dropped precisely so they would stop holding the
     cycle open. If this ever fails, a leaver blocks the whole company. */
  it('is never blocked by a dropped review', () => {
    expect(blocksClose(cycleCoverage(reviews(['CANCELLED', 'CANCELLED'])))).toBe(false);
  });

  /* An unsigned share is worth mentioning and not worth blocking on: chasing a
     signature is not HR's to enforce, and a cycle held open for one never closes. */
  it('mentions an unsigned share without blocking on it', () => {
    const coverage = cycleCoverage(reviews(['SHARED']));
    expect(closeProblems(coverage)).toHaveLength(1);
    expect(blocksClose(coverage)).toBe(false);
  });
});

/* Cheap guards that the shared vocabularies did not quietly change shape. */
describe('the vocabularies this file switches on', () => {
  it('has the statuses the rules assume', () => {
    expect(REVIEW_CYCLE_STATUSES).toEqual(['DRAFT', 'OPEN', 'CLOSED']);
    expect(GOAL_STATUSES).toEqual(['ACTIVE', 'ACHIEVED', 'MISSED', 'CANCELLED']);
  });
});
