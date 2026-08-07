import { defaultSettings, exitChecklistSchema } from '@hrms/shared';
import { addDays, daysBetween, toDate } from '../../src/common/utils/calendar';
import type { PrismaClient } from '../../src/generated/prisma/client';
import { availableDays } from '../../src/modules/leave/leave.util';
import {
  encashmentLines,
  gratuityFor,
  noticeShortfallDays,
  perDayRate,
  settlementTotals,
} from '../../src/modules/settlements/settlement.calc';
import type { People, SeededPerson } from './people';
import type { Random } from './random';

const money = (n: number) =>
  `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * The whole exit chain: resignation → offboarding → clearance → settlement.
 *
 * Every state a screen can render is represented, because the ones that are
 * not are the ones nobody notices are broken. The settlement figures are
 * produced by `settlement.calc.ts` — the same pure functions the service
 * calls — so the statement's basis lines and its totals reconcile. Typing the
 * numbers in here would produce a demo statement that does not add up, which
 * is precisely the thing a settlement screen exists to avoid.
 */
export async function seedExit(
  prisma: PrismaClient,
  orgId: string,
  people: People,
  random: Random,
  todayKey: string,
) {
  const config = defaultSettings().settlement;
  const checklist = exitChecklistSchema.parse({}).items;
  const hrUser = people.usr('hr@hrms.local');
  const managerUser = people.usr('manager@hrms.local');
  const financeUser = people.usr('finance@hrms.local');

  const onNotice = people.all.filter((p) => p.status === 'ON_NOTICE');
  const gone = people.all.filter((p) => p.status === 'EXITED');
  const staying = people.staff.filter((p) => p.role === 'EMPLOYEE').slice(-4);

  const NOTICE_DAYS = 60;

  /** A resignation, with the notice that was in force frozen onto it. */
  const resign = async (input: {
    person: SeededPerson;
    status: 'SUBMITTED' | 'MANAGER_APPROVED' | 'APPROVED' | 'REJECTED' | 'WITHDRAWN' | 'COMPLETED';
    submittedBack: number;
    lastWorkingDate: string;
  }) => {
    const submittedOn = addDays(todayKey, -input.submittedBack);
    const decided = input.status !== 'SUBMITTED';
    const hrDecided = ['APPROVED', 'REJECTED', 'COMPLETED'].includes(input.status);

    return prisma.resignation.create({
      data: {
        organizationId: orgId,
        employeeId: input.person.employeeId,
        status: input.status,
        reason: random.pick([
          'BETTER_OPPORTUNITY',
          'COMPENSATION',
          'RELOCATION',
          'HIGHER_STUDIES',
          'PERSONAL',
        ] as const),
        remarks: 'Thank you for everything — happy to help with the handover.',
        requestedLastWorkingDate: toDate(input.lastWorkingDate),
        approvedLastWorkingDate: hrDecided ? toDate(input.lastWorkingDate) : null,
        noticeDays: NOTICE_DAYS,
        earliestLastWorkingDate: toDate(addDays(submittedOn, NOTICE_DAYS)),
        submittedAt: toDate(submittedOn),
        routedManagerId: input.person.managerEmail
          ? people.emp(input.person.managerEmail)
          : people.emp('hr@hrms.local'),
        ...(decided
          ? {
              managerDecidedAt: toDate(addDays(submittedOn, 1)),
              managerDecidedById: managerUser,
              managerRemarks: 'Sorry to see them go. Handover plan agreed.',
            }
          : {}),
        ...(hrDecided
          ? {
              hrDecidedAt: toDate(addDays(submittedOn, 2)),
              hrDecidedById: hrUser,
              hrRemarks:
                input.status === 'REJECTED'
                  ? 'Discussed and retained — resignation withdrawn by agreement.'
                  : 'Accepted. Last working day confirmed.',
            }
          : {}),
        ...(input.status === 'WITHDRAWN' ? { withdrawnAt: toDate(addDays(submittedOn, 3)) } : {}),
      },
    });
  };

  /** The operational half, with the checklist copied off the template. */
  const offboard = async (input: {
    person: SeededPerson;
    resignationId: string | null;
    status: 'IN_PROGRESS' | 'COMPLETED';
    lastWorkingDate: string;
    doneThrough: number;
  }) => {
    const offboarding = await prisma.offboarding.create({
      data: {
        organizationId: orgId,
        employeeId: input.person.employeeId,
        resignationId: input.resignationId,
        reason: input.resignationId ? 'RESIGNATION' : 'CONTRACT_END',
        reasonNote: input.resignationId ? null : 'Fixed-term contract reached its end date',
        lastWorkingDate: toDate(input.lastWorkingDate),
        status: input.status,
        // Frozen at start, so the record still reads true after the department
        // is reorganised away or the manager themselves leaves.
        snapshotDepartment: input.person.departmentName,
        snapshotDesignation: input.person.designation,
        snapshotManagerName: input.person.managerEmail
          ? `${people.byEmail(input.person.managerEmail).firstName} ${people.byEmail(input.person.managerEmail).lastName}`
          : null,
        snapshotJoinDate: toDate(input.person.joinDate),
        startedAt: toDate(addDays(input.lastWorkingDate, -NOTICE_DAYS)),
        startedById: hrUser,
        ...(input.status === 'COMPLETED'
          ? {
              completedAt: toDate(addDays(input.lastWorkingDate, 2)),
              completedById: hrUser,
            }
          : {}),
      },
    });

    await prisma.offboardingTask.createMany({
      data: checklist.map((item, order) => {
        const done = input.status === 'COMPLETED' || order < input.doneThrough;
        return {
          offboardingId: offboarding.id,
          label: item.label,
          description: item.description ?? null,
          owner: item.owner,
          kind: item.kind,
          required: item.required,
          order,
          // An ASSET_RETURN item is owned by the register, not by a person —
          // AssetClearanceService writes its status, so seeding it DONE would
          // be a lie the next read corrects. It stays PENDING and the register
          // decides.
          status: item.kind === 'ASSET_RETURN' ? 'PENDING' : done ? 'DONE' : 'PENDING',
          note: item.kind !== 'ASSET_RETURN' && done ? 'Signed off' : null,
          doneAt: item.kind !== 'ASSET_RETURN' && done ? toDate(input.lastWorkingDate) : null,
          doneById: item.kind !== 'ASSET_RETURN' && done ? hrUser : null,
        };
      }),
    });

    return offboarding;
  };

  /** The statement, computed rather than typed. */
  const settle = async (input: {
    person: SeededPerson;
    offboardingId: string;
    lastWorkingDate: string;
    earliestLastWorkingDate: string | null;
    status: 'DRAFT' | 'APPROVED' | 'PAID';
  }) => {
    const monthlyPay =
      config.rateBasis === 'GROSS'
        ? input.person.monthlyCtc
        : Math.round(input.person.monthlyCtc * 0.4);
    const rate = perDayRate(monthlyPay, input.lastWorkingDate.slice(0, 7), config.perDayBasis);

    const balances = await prisma.leaveBalance.findMany({
      where: { employeeId: input.person.employeeId, year: Number(todayKey.slice(0, 4)) },
      include: { leaveType: true },
    });

    const encashment = encashmentLines(
      balances.map((b) => ({
        leaveTypeId: b.leaveTypeId,
        code: b.leaveType.code,
        name: b.leaveType.name,
        encashable: b.leaveType.encashable,
        availableDays: availableDays({
          allocated: Number(b.allocated),
          carriedOver: Number(b.carriedOver),
          used: Number(b.used),
        }),
      })),
      rate,
    );

    const shortfall = config.recoverShortNotice
      ? noticeShortfallDays(input.lastWorkingDate, input.earliestLastWorkingDate)
      : 0;
    const gratuity = gratuityFor(
      input.person.joinDate,
      input.lastWorkingDate,
      monthlyPay,
      config.gratuity,
    );

    const lines: {
      kind: 'EARNING' | 'DEDUCTION';
      source: 'LEAVE_ENCASHMENT' | 'NOTICE_RECOVERY' | 'GRATUITY' | 'MANUAL';
      label: string;
      basis: string | null;
      amount: number;
    }[] = [
      ...encashment.map((line) => ({
        kind: 'EARNING' as const,
        source: 'LEAVE_ENCASHMENT' as const,
        label: `${line.name} encashment`,
        basis: `${line.days} days × ${money(rate)}`,
        amount: line.amount,
      })),
    ];

    if (gratuity.eligible) {
      lines.push({
        kind: 'EARNING',
        source: 'GRATUITY',
        label: 'Gratuity',
        basis: `${gratuity.years} years × ${config.gratuity.daysPerYear}/${config.gratuity.divisor} × ${money(monthlyPay)}`,
        amount: gratuity.amount,
      });
    }
    if (shortfall > 0) {
      lines.push({
        kind: 'DEDUCTION',
        source: 'NOTICE_RECOVERY',
        label: 'Notice period recovery',
        basis: `${shortfall} days × ${money(rate)}`,
        amount: Math.round(shortfall * rate * 100) / 100,
      });
    }
    // One line HR added by hand, so the manual source appears somewhere and a
    // recompute has something to preserve.
    lines.push({
      kind: 'DEDUCTION',
      source: 'MANUAL',
      label: 'Salary advance recovery',
      basis: 'Advance taken in March',
      amount: 5000,
    });

    const totals = settlementTotals(lines);
    const paidOrApproved = input.status !== 'DRAFT';

    await prisma.settlement.create({
      data: {
        organizationId: orgId,
        offboardingId: input.offboardingId,
        employeeId: input.person.employeeId,
        status: input.status,
        lastWorkingDate: toDate(input.lastWorkingDate),
        joinDate: toDate(input.person.joinDate),
        monthlyPay,
        perDayRate: rate,
        totalEarnings: totals.totalEarnings,
        totalDeductions: totals.totalDeductions,
        netPayable: totals.netPayable,
        computedAt: toDate(input.lastWorkingDate),
        ...(paidOrApproved
          ? { approvedAt: toDate(addDays(input.lastWorkingDate, 3)), approvedById: hrUser }
          : {}),
        ...(input.status === 'PAID'
          ? {
              paidAt: toDate(addDays(input.lastWorkingDate, 9)),
              paidById: financeUser,
              paymentRef: `NEFT-FNF-${input.person.code}`,
            }
          : {}),
        lines: {
          create: lines.map((line, order) => ({ ...line, order, overridden: false })),
        },
      },
    });
  };

  // ── Three serving notice: one per stage of the workflow ────────────────
  for (const [i, person] of onNotice.entries()) {
    const lastWorkingDate = person.exitDate as string;
    const resignation = await resign({
      person,
      status: 'APPROVED',
      submittedBack: Math.max(5, daysBetween(todayKey, lastWorkingDate) + 30),
      lastWorkingDate,
    });
    const offboarding = await offboard({
      person,
      resignationId: resignation.id,
      status: 'IN_PROGRESS',
      lastWorkingDate,
      doneThrough: i + 1,
    });
    // Only the first has a settlement drafted; the others have not got there,
    // which is what the "compute settlement" button is for.
    if (i === 0) {
      await settle({
        person,
        offboardingId: offboarding.id,
        lastWorkingDate,
        earliestLastWorkingDate: addDays(todayKey, 25),
        status: 'DRAFT',
      });
    }
  }

  // ── Three already gone: completed exits, settlements approved and paid ──
  for (const [i, person] of gone.entries()) {
    const lastWorkingDate = person.exitDate as string;
    const resignation =
      i < 2
        ? await resign({
            person,
            status: 'COMPLETED',
            submittedBack: 120 + i * 20,
            lastWorkingDate,
          })
        : null;
    const offboarding = await offboard({
      person,
      resignationId: resignation?.id ?? null,
      status: 'COMPLETED',
      lastWorkingDate,
      doneThrough: checklist.length,
    });

    await prisma.exitInterview.create({
      data: {
        offboardingId: offboarding.id,
        conductedOn: toDate(addDays(lastWorkingDate, -2)),
        conductedById: hrUser,
        responses: [
          {
            key: 'reason',
            question: 'What is the main reason you decided to leave?',
            answer: 'A role with more ownership of the platform side.',
          },
          {
            key: 'manager',
            question: 'How would you describe your relationship with your manager?',
            answer: 'Supportive, and honest about what was and was not possible.',
          },
          {
            key: 'improve',
            question: 'What one thing would you change about working here?',
            answer: 'Clearer career levels — it was never obvious what came next.',
          },
        ],
        notes: 'Amicable throughout. Offered to stay on call for a fortnight.',
        wouldRecommend: i !== 2,
        rehireEligible: i !== 2,
      },
    });

    await settle({
      person,
      offboardingId: offboarding.id,
      lastWorkingDate,
      earliestLastWorkingDate: resignation ? addDays(lastWorkingDate, 8) : null,
      status: i === 0 ? 'APPROVED' : 'PAID',
    });
  }

  // ── Resignations that never became an exit ─────────────────────────────
  // One waiting on a manager, one waiting on HR, one turned down, one pulled
  // back. None of these has an offboarding, which is the point of them.
  const [waitingManager, waitingHr, rejected, withdrawn] = staying;

  if (waitingManager) {
    await resign({
      person: waitingManager,
      status: 'SUBMITTED',
      submittedBack: 2,
      lastWorkingDate: addDays(todayKey, 60),
    });
  }
  if (waitingHr) {
    await resign({
      person: waitingHr,
      status: 'MANAGER_APPROVED',
      submittedBack: 4,
      lastWorkingDate: addDays(todayKey, 58),
    });
  }
  if (rejected) {
    await resign({
      person: rejected,
      status: 'REJECTED',
      submittedBack: 40,
      lastWorkingDate: addDays(todayKey, 20),
    });
  }
  if (withdrawn) {
    await resign({
      person: withdrawn,
      status: 'WITHDRAWN',
      submittedBack: 70,
      lastWorkingDate: addDays(todayKey, -10),
    });
  }
}
