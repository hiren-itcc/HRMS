import { addDays, toDate } from '../../src/common/utils/calendar';
import type { PrismaClient } from '../../src/generated/prisma/client';
import type { ApplicationStage, RejectionReason } from '../../src/generated/prisma/enums';
import type { OrgFixtures } from './org';
import type { People } from './people';
import { FIRST_NAMES_F, FIRST_NAMES_M, LAST_NAMES, type Random } from './random';

/**
 * The front of the lifecycle, with somebody sitting in every state the module
 * can be in.
 *
 * The point of this file is that each screen has something to say without
 * anybody having to type it first: a board with all four live columns
 * occupied, interviews both submitted and still awaited, a rejection with a
 * reason and a rejection that needed a note, an offer out and unanswered, and
 * one that has been accepted and converted.
 *
 * **The hire is linked to a real employee.** One of the two people the staff
 * seed leaves in ONBOARDING is exactly what a conversion produces — an
 * employee who exists, has been invited, and is still filling in their
 * details. Pointing the accepted offer at them makes the story true end to
 * end: their record can be opened from the offer, and the offer can be reached
 * back from the pipeline. Inventing a second employee for it would have shown
 * a workspace where the same person exists twice.
 */

interface CandidateSpec {
  firstName: string;
  lastName: string;
  currentTitle: string;
  currentEmployer: string;
  noticePeriodDays: number;
  expectedMonthlyCtc: number;
  source: string;
}

const EMPLOYERS = [
  'Infosys',
  'Zoho',
  'Freshworks',
  'Razorpay',
  'Swiggy',
  'TCS',
  'Postman',
  'Zerodha',
  'CleverTap',
  'Chargebee',
] as const;

const SOURCES = ['LinkedIn', 'Referral', 'Naukri', 'Careers page', 'Agency', 'Walk-in'] as const;

/** Names not already used by staff, so nobody appears as both a colleague and a candidate. */
function makeCandidateSpecs(random: Random, taken: Set<string>, count: number): CandidateSpec[] {
  const first = random.shuffle([...FIRST_NAMES_F, ...FIRST_NAMES_M]);
  const last = random.shuffle([...LAST_NAMES]);
  const specs: CandidateSpec[] = [];

  for (let i = 0; specs.length < count && i < first.length * 2; i++) {
    const firstName = first[i % first.length] as string;
    const lastName = last[(i * 3 + 1) % last.length] as string;
    const key = `${firstName} ${lastName}`.toLowerCase();
    if (taken.has(key)) continue;
    taken.add(key);
    specs.push({
      firstName,
      lastName,
      currentTitle: random.pick([
        'Software Engineer',
        'Senior Software Engineer',
        'QA Engineer',
        'Product Designer',
        'Sales Executive',
        'Business Analyst',
      ]),
      currentEmployer: random.pick(EMPLOYERS),
      noticePeriodDays: random.pick([0, 15, 30, 60, 90]),
      expectedMonthlyCtc: random.step(70_000, 190_000, 5_000),
      source: random.pick(SOURCES),
    });
  }
  return specs;
}

export async function seedRecruitment(
  prisma: PrismaClient,
  orgId: string,
  fixtures: OrgFixtures,
  people: People,
  random: Random,
  todayKey: string,
): Promise<void> {
  const hr = people.usr('hr@hrms.local');
  const engManager = people.emp('manager@hrms.local');
  const interviewers = people.staff
    .filter((p) => p.status === 'ACTIVE')
    .slice(0, 6)
    .map((p) => p.employeeId);

  /* The person the accepted offer converted into. Already invited, already
     awaiting their checklist — which is where a real hire lands. */
  const hired = people.all.find((p) => p.status === 'ONBOARDING');

  // ── Openings ───────────────────────────────────────────────────────────

  const openings = {
    senior: await prisma.jobOpening.create({
      data: {
        organizationId: orgId,
        title: 'Senior Software Engineer',
        // The slug an opening is minted when it is first published. Seeded
        // here so the careers page has something to show without anybody
        // having to reopen a role by hand.
        slug: 'senior-software-engineer',
        status: 'OPEN',
        departmentId: fixtures.departments.engineering.id,
        designationId: fixtures.designationId('Senior Software Engineer'),
        locationId: fixtures.location('Ahmedabad').id,
        employmentTypeId: fixtures.employmentTypeId('FT'),
        hiringManagerId: engManager,
        headcount: 2,
        minMonthlyCtc: 120_000,
        maxMonthlyCtc: 180_000,
        description:
          'Backend-heavy, on the billing and payroll surfaces. You will own a service end to end, ' +
          'including the on-call for it. We care more about how you reason about a failure than ' +
          'about which framework you last used.',
        openedOn: toDate(addDays(todayKey, -34)),
        createdById: hr,
      },
    }),
    qa: await prisma.jobOpening.create({
      data: {
        organizationId: orgId,
        title: 'QA Engineer',
        slug: 'qa-engineer',
        status: 'OPEN',
        departmentId: fixtures.departments.quality.id,
        designationId: fixtures.designationId('QA Engineer'),
        locationId: fixtures.location('Bengaluru').id,
        employmentTypeId: fixtures.employmentTypeId('FT'),
        hiringManagerId: engManager,
        headcount: 1,
        minMonthlyCtc: 60_000,
        maxMonthlyCtc: 95_000,
        description: 'Manual and automated, with a real say in what gets released.',
        openedOn: toDate(addDays(todayKey, -21)),
        createdById: hr,
      },
    }),
    sales: await prisma.jobOpening.create({
      data: {
        organizationId: orgId,
        title: 'Sales Executive',
        slug: 'sales-executive',
        status: 'OPEN',
        departmentId: fixtures.departments.sales.id,
        designationId: fixtures.designationId('Sales Executive'),
        locationId: fixtures.location('Pune').id,
        employmentTypeId: fixtures.employmentTypeId('FT'),
        headcount: 3,
        // No band advertised on purpose: the screens have to show "Not
        // advertised" rather than ₹0, and this is the row that proves it.
        description: 'Mid-market, inbound-led. Territory is Maharashtra and Gujarat.',
        openedOn: toDate(addDays(todayKey, -12)),
        createdById: hr,
      },
    }),
    /* Raised but not signed off — nothing can be applied to it yet. */
    intern: await prisma.jobOpening.create({
      data: {
        organizationId: orgId,
        title: 'Engineering Intern — Summer',
        status: 'DRAFT',
        departmentId: fixtures.departments.engineering.id,
        designationId: fixtures.designationId('Intern'),
        locationId: fixtures.location('Ahmedabad').id,
        employmentTypeId: fixtures.employmentTypeId('IN'),
        headcount: 4,
        minMonthlyCtc: 25_000,
        maxMonthlyCtc: 25_000,
        description: 'Twelve weeks, with a mentor and something that actually ships.',
        createdById: hr,
      },
    }),
    /* Paused rather than closed: the budget question is open, the applications are not. */
    accounts: await prisma.jobOpening.create({
      data: {
        organizationId: orgId,
        title: 'Accounts Executive',
        status: 'ON_HOLD',
        departmentId: fixtures.departments.finance.id,
        designationId: fixtures.designationId('Accounts Executive'),
        locationId: fixtures.location('Ahmedabad').id,
        employmentTypeId: fixtures.employmentTypeId('FT'),
        headcount: 1,
        minMonthlyCtc: 45_000,
        maxMonthlyCtc: 70_000,
        description: 'Held while the headcount is re-confirmed for the next quarter.',
        openedOn: toDate(addDays(todayKey, -70)),
        createdById: hr,
      },
    }),
    /* The one that worked. Filled, and the offer below says by whom. */
    software: await prisma.jobOpening.create({
      data: {
        organizationId: orgId,
        title: 'Software Engineer',
        status: 'FILLED',
        departmentId: fixtures.departments.engineering.id,
        designationId: fixtures.designationId('Software Engineer'),
        locationId: fixtures.location('Ahmedabad').id,
        employmentTypeId: fixtures.employmentTypeId('FT'),
        hiringManagerId: engManager,
        headcount: 1,
        minMonthlyCtc: 80_000,
        maxMonthlyCtc: 120_000,
        description: 'Product engineering, full stack.',
        openedOn: toDate(addDays(todayKey, -95)),
        closedOn: toDate(addDays(todayKey, -18)),
        createdById: hr,
      },
    }),
  };

  // ── Candidates ─────────────────────────────────────────────────────────

  const taken = new Set(people.all.map((p) => `${p.firstName} ${p.lastName}`.toLowerCase()));
  const specs = makeCandidateSpecs(random, taken, 14);

  const candidateIds: string[] = [];
  for (const [i, spec] of specs.entries()) {
    const candidate = await prisma.candidate.create({
      data: {
        organizationId: orgId,
        firstName: spec.firstName,
        lastName: spec.lastName,
        email: `${spec.firstName}.${spec.lastName}${i}`.toLowerCase().concat('@example.com'),
        phone: `+91 9${random.int(100_000_000, 899_999_999)}`,
        currentEmployer: spec.currentEmployer,
        currentTitle: spec.currentTitle,
        noticePeriodDays: spec.noticePeriodDays,
        expectedMonthlyCtc: spec.expectedMonthlyCtc,
        source: spec.source,
        // Some came in through a colleague, which is what the referral report
        // will eventually be read for.
        referrerId: spec.source === 'Referral' ? random.pick(interviewers) : null,
        createdById: hr,
      },
    });
    candidateIds.push(candidate.id);
  }

  /* The hire keeps their real name, because the employee they became has it. */
  const hiredCandidate = hired
    ? await prisma.candidate.create({
        data: {
          organizationId: orgId,
          firstName: hired.firstName,
          lastName: hired.lastName,
          email: `${hired.firstName}.${hired.lastName}`.toLowerCase().concat('@example.com'),
          phone: `+91 9${random.int(100_000_000, 899_999_999)}`,
          currentEmployer: random.pick(EMPLOYERS),
          currentTitle: 'Software Engineer',
          noticePeriodDays: 30,
          expectedMonthlyCtc: 105_000,
          source: 'Referral',
          referrerId: engManager,
          createdById: hr,
        },
      })
    : null;

  // ── Applications, one per live stage and one per ending ────────────────

  const plan: {
    candidate: string;
    opening: string;
    stage: Exclude<ApplicationStage, 'HIRED'>;
    appliedDaysAgo: number;
    rejectionReason?: RejectionReason;
    rejectionNote?: string;
  }[] = [
    {
      candidate: candidateIds[0] as string,
      opening: openings.senior.id,
      stage: 'APPLIED',
      appliedDaysAgo: 2,
    },
    {
      candidate: candidateIds[1] as string,
      opening: openings.senior.id,
      stage: 'APPLIED',
      appliedDaysAgo: 4,
    },
    {
      candidate: candidateIds[2] as string,
      opening: openings.senior.id,
      stage: 'SCREENING',
      appliedDaysAgo: 9,
    },
    {
      candidate: candidateIds[3] as string,
      opening: openings.senior.id,
      stage: 'INTERVIEW',
      appliedDaysAgo: 16,
    },
    {
      candidate: candidateIds[4] as string,
      opening: openings.senior.id,
      stage: 'INTERVIEW',
      appliedDaysAgo: 19,
    },
    {
      candidate: candidateIds[5] as string,
      opening: openings.senior.id,
      stage: 'OFFER',
      appliedDaysAgo: 26,
    },
    {
      candidate: candidateIds[6] as string,
      opening: openings.senior.id,
      stage: 'REJECTED',
      appliedDaysAgo: 22,
      rejectionReason: 'EXPERIENCE',
    },
    {
      candidate: candidateIds[7] as string,
      opening: openings.senior.id,
      stage: 'REJECTED',
      appliedDaysAgo: 24,
      // OTHER always carries the note — "something else" that says nothing is
      // the reason the schema insists on one.
      rejectionReason: 'OTHER',
      rejectionNote: 'Took another offer before we could get them to the final round.',
    },
    {
      candidate: candidateIds[8] as string,
      opening: openings.qa.id,
      stage: 'SCREENING',
      appliedDaysAgo: 6,
    },
    {
      candidate: candidateIds[9] as string,
      opening: openings.qa.id,
      stage: 'INTERVIEW',
      appliedDaysAgo: 13,
    },
    {
      candidate: candidateIds[10] as string,
      opening: openings.qa.id,
      stage: 'WITHDRAWN',
      appliedDaysAgo: 15,
    },
    {
      candidate: candidateIds[11] as string,
      opening: openings.sales.id,
      stage: 'APPLIED',
      appliedDaysAgo: 1,
    },
    {
      candidate: candidateIds[12] as string,
      opening: openings.sales.id,
      stage: 'SCREENING',
      appliedDaysAgo: 5,
    },
    {
      candidate: candidateIds[13] as string,
      opening: openings.sales.id,
      stage: 'OFFER',
      appliedDaysAgo: 11,
    },
  ];

  const applications: Record<string, string> = {};
  for (const row of plan) {
    const terminal = row.stage === 'REJECTED' || row.stage === 'WITHDRAWN';
    const application = await prisma.application.create({
      data: {
        organizationId: orgId,
        candidateId: row.candidate,
        openingId: row.opening,
        stage: row.stage,
        appliedOn: toDate(addDays(todayKey, -row.appliedDaysAgo)),
        rejectionReason: row.rejectionReason ?? null,
        rejectionNote: row.rejectionNote ?? null,
        decidedAt: terminal
          ? toDate(addDays(todayKey, -Math.max(1, row.appliedDaysAgo - 6)))
          : null,
      },
    });
    applications[`${row.candidate}:${row.opening}`] = application.id;
  }

  // ── Interviews ─────────────────────────────────────────────────────────
  //
  // Everybody at INTERVIEW or beyond has been through at least one round.
  // Rounds in the past carry submitted feedback; one is still to come, so the
  // "give feedback" path has something to act on.

  const interviewed = plan.filter((r) => ['INTERVIEW', 'OFFER', 'REJECTED'].includes(r.stage));

  for (const [i, row] of interviewed.entries()) {
    const applicationId = applications[`${row.candidate}:${row.opening}`] as string;
    const rounds = row.stage === 'OFFER' ? 2 : 1;

    for (let r = 0; r < rounds; r++) {
      const daysAgo = row.appliedDaysAgo - 5 - r * 5;
      const past = daysAgo > 0;
      const at = toDate(addDays(todayKey, -daysAgo));
      at.setUTCHours(random.int(4, 11), random.pick([0, 30]), 0, 0);

      // One person's next round is still ahead of them; everybody else's is
      // done and written up.
      const awaiting = !past || (i === 0 && r === rounds - 1);

      await prisma.interview.create({
        data: {
          applicationId,
          interviewerId: random.pick(interviewers),
          scheduledFor: at,
          durationMinutes: random.pick([30, 45, 60]),
          mode: random.pick(['VIDEO', 'IN_PERSON', 'PHONE'] as const),
          round: r === 0 ? 'Technical screen' : 'Hiring manager',
          recommendation: awaiting
            ? null
            : row.stage === 'REJECTED'
              ? random.pick(['NO', 'STRONG_NO'] as const)
              : random.pick(['YES', 'STRONG_YES'] as const),
          notes: awaiting
            ? null
            : row.stage === 'REJECTED'
              ? 'Answered the warm-up questions well but could not explain the trade-off they had made in their own design. Would look again in a year.'
              : 'Reasoned out loud, asked about the failure modes before the happy path, and pushed back on one of my assumptions with a good example. Would work with them.',
          submittedAt: awaiting ? null : toDate(addDays(todayKey, -daysAgo + 1)),
          createdById: hr,
        },
      });
    }
  }

  // ── Offers ─────────────────────────────────────────────────────────────

  /* Out and unanswered — the state the "record their answer" button is for. */
  await prisma.offer.create({
    data: {
      organizationId: orgId,
      applicationId: applications[`${candidateIds[5]}:${openings.senior.id}`] as string,
      designationId: fixtures.designationId('Senior Software Engineer'),
      departmentId: fixtures.departments.engineering.id,
      locationId: fixtures.location('Ahmedabad').id,
      employmentTypeId: fixtures.employmentTypeId('FT'),
      monthlyCtc: 165_000,
      joinDate: toDate(addDays(todayKey, 45)),
      expiresOn: toDate(addDays(todayKey, 7)),
      status: 'SENT',
      sentAt: toDate(addDays(todayKey, -4)),
      notes:
        'Matched their counter on base; the joining bonus is instead of the retention they lose.',
      createdById: hr,
    },
  });

  /* Drafted, not yet sent: signed off internally this morning. */
  await prisma.offer.create({
    data: {
      organizationId: orgId,
      applicationId: applications[`${candidateIds[13]}:${openings.sales.id}`] as string,
      designationId: fixtures.designationId('Sales Executive'),
      departmentId: fixtures.departments.sales.id,
      locationId: fixtures.location('Pune').id,
      employmentTypeId: fixtures.employmentTypeId('FT'),
      monthlyCtc: 72_000,
      joinDate: toDate(addDays(todayKey, 30)),
      status: 'DRAFT',
      createdById: hr,
    },
  });

  /* Accepted and converted — the whole point of the module. */
  if (hired && hiredCandidate) {
    const application = await prisma.application.create({
      data: {
        organizationId: orgId,
        candidateId: hiredCandidate.id,
        openingId: openings.software.id,
        stage: 'HIRED',
        appliedOn: toDate(addDays(todayKey, -78)),
        decidedAt: toDate(addDays(todayKey, -18)),
      },
    });

    const at = toDate(addDays(todayKey, -52));
    at.setUTCHours(5, 30, 0, 0);
    await prisma.interview.create({
      data: {
        applicationId: application.id,
        interviewerId: engManager,
        scheduledFor: at,
        durationMinutes: 60,
        mode: 'VIDEO',
        round: 'Hiring manager',
        recommendation: 'STRONG_YES',
        notes:
          'Best conversation of the loop. Walked through a migration they had got wrong and what they changed afterwards, without being asked to.',
        submittedAt: toDate(addDays(todayKey, -51)),
        createdById: hr,
      },
    });

    await prisma.offer.create({
      data: {
        organizationId: orgId,
        applicationId: application.id,
        designationId: fixtures.designationId('Software Engineer'),
        departmentId: fixtures.departments.engineering.id,
        locationId: fixtures.location('Ahmedabad').id,
        employmentTypeId: fixtures.employmentTypeId('FT'),
        monthlyCtc: hired.monthlyCtc,
        joinDate: toDate(hired.joinDate),
        expiresOn: toDate(addDays(todayKey, -25)),
        status: 'ACCEPTED',
        sentAt: toDate(addDays(todayKey, -40)),
        respondedAt: toDate(addDays(todayKey, -33)),
        // The link that makes this a conversion rather than a coincidence.
        hiredEmployeeId: hired.employeeId,
        notes: 'Accepted on the same terms as offered.',
        createdById: hr,
      },
    });
  }
}
