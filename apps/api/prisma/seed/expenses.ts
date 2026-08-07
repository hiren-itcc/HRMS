import { addDays, toDate } from '../../src/common/utils/calendar';
import type { PrismaClient } from '../../src/generated/prisma/client';
import type { People, SeededPerson } from './people';
import type { Random } from './random';

/**
 * Expense claims, with one of every state on screen.
 *
 * The pieces worth checking by eye rather than only in a test:
 *
 * - A category **with** a cap and one **without**, and one that wants a receipt
 *   and one that does not — so the submission rules are visible rather than
 *   only asserted.
 * - A claim that is approved and **paid**, because the run for its month is
 *   published, next to one approved into a month that is not. Those are two
 *   different answers and the screens say both.
 * - **Two approved claims in one month against one category**, which is the
 *   `mode: 'add'` behaviour on `PayrollAdjustment`. The single adjustment row
 *   they share is the thing a later refactor is most likely to break, and the
 *   only place it is visible without reading the code.
 */

/** `yyyy-MM`, `back` months before the given day key. */
function monthKey(todayKey: string, back: number): string {
  const [y = '1970', m = '01'] = todayKey.split('-');
  const date = new Date(Date.UTC(Number(y), Number(m) - 1 - back, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

export async function seedExpenses(
  prisma: PrismaClient,
  orgId: string,
  people: People,
  random: Random,
  todayKey: string,
) {
  // Non-taxable by design: reimbursing a cost is not income. Seeded by
  // `DEFAULT_PAY_COMPONENTS`, so it is always here.
  const component = await prisma.payComponent.findFirstOrThrow({
    where: { organizationId: orgId, code: 'REIMBURSEMENT' },
    select: { id: true },
  });

  const [travel, meals, phone] = await Promise.all(
    [
      {
        code: 'TRAVEL',
        name: 'Travel',
        capPerClaim: 25_000,
        requiresReceipt: true,
        order: 1,
      },
      // No ceiling, no receipt: the two rules absent, so their presence
      // elsewhere is visibly a choice rather than the only setting available.
      { code: 'MEALS', name: 'Meals', capPerClaim: null, requiresReceipt: false, order: 2 },
      {
        code: 'PHONE',
        name: 'Phone and internet',
        capPerClaim: 3000,
        requiresReceipt: true,
        order: 3,
      },
    ].map((spec) =>
      prisma.expenseCategory.create({
        data: { organizationId: orgId, componentId: component.id, ...spec },
      }),
    ),
  );

  const claimants = people.staff.filter((person) => person.role === 'EMPLOYEE').slice(0, 4);
  const finance = people.usr('finance@hrms.local');
  if (claimants.length === 0) return;

  const claim = async (
    person: SeededPerson,
    title: string,
    lines: { categoryId: string; amount: number; description: string; daysBack: number }[],
    state: {
      status: 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'REJECTED' | 'CANCELLED';
      month?: string;
      note?: string;
      daysBack: number;
    },
  ) => {
    const decided = state.status === 'APPROVED' || state.status === 'REJECTED';
    return prisma.expenseClaim.create({
      data: {
        organizationId: orgId,
        employeeId: person.employeeId,
        title,
        status: state.status,
        payrollMonth: state.status === 'APPROVED' ? (state.month ?? null) : null,
        submittedAt: state.status === 'DRAFT' ? null : toDate(addDays(todayKey, -state.daysBack)),
        decidedById: decided ? finance : null,
        decidedAt: decided ? toDate(addDays(todayKey, -state.daysBack + 1)) : null,
        decisionNote: state.note ?? null,
        items: {
          create: lines.map((line) => ({
            categoryId: line.categoryId,
            spentOn: toDate(addDays(todayKey, -line.daysBack)),
            amount: line.amount,
            description: line.description,
          })),
        },
      },
    });
  };

  const [first, second, third, fourth] = claimants;

  // Half-written, and the only editable state.
  await claim(
    first as SeededPerson,
    'Client visit, Pune',
    [
      { categoryId: travel.id, amount: 2450, description: 'Return train fare', daysBack: 3 },
      { categoryId: meals.id, amount: 620, description: 'Lunch with the client', daysBack: 3 },
    ],
    { status: 'DRAFT', daysBack: 2 },
  );

  // Waiting on somebody, so the approvals inbox is not empty on first login.
  await claim(
    (second ?? first) as SeededPerson,
    'Conference tickets',
    [{ categoryId: travel.id, amount: 12_000, description: 'JSConf India, two days', daysBack: 9 }],
    { status: 'SUBMITTED', daysBack: 5 },
  );

  await claim(
    (third ?? first) as SeededPerson,
    'Broadband, last quarter',
    [{ categoryId: phone.id, amount: 2400, description: 'Home broadband, 3 months', daysBack: 20 }],
    { status: 'REJECTED', note: 'Already covered by the connectivity allowance', daysBack: 14 },
  );

  /*
   * The pair that share one payroll row. Both approved into a month whose run
   * is PUBLISHED, both against Travel — so on the payslip they are one
   * Reimbursements line of 4,300 rather than two lines of the same name, and
   * on screen both read as paid.
   */
  const paidMonth = monthKey(todayKey, 2);
  const spender = (fourth ?? first) as SeededPerson;
  await claim(
    spender,
    'Site visit, Hyderabad',
    [{ categoryId: travel.id, amount: 3100, description: 'Flight and cab', daysBack: 70 }],
    { status: 'APPROVED', month: paidMonth, daysBack: 66 },
  );
  await claim(
    spender,
    'Airport parking',
    [{ categoryId: travel.id, amount: 1200, description: 'Four days', daysBack: 68 }],
    { status: 'APPROVED', month: paidMonth, daysBack: 64 },
  );

  await prisma.payrollAdjustment.upsert({
    where: {
      employeeId_month_componentId: {
        employeeId: spender.employeeId,
        month: paidMonth,
        componentId: component.id,
      },
    },
    create: {
      organizationId: orgId,
      employeeId: spender.employeeId,
      month: paidMonth,
      componentId: component.id,
      amount: 4300,
      note: 'Expense claims',
      createdById: finance,
    },
    // Idempotent: the payroll seed may already have written a reimbursement
    // for this person and month, and two claims summing is the whole point.
    update: { amount: { increment: 4300 } },
  });

  // Approved but not yet paid — the month's run does not exist, so `paid`
  // derives false and the screen says "Paid with <month>" instead.
  await claim(
    (second ?? first) as SeededPerson,
    'Team lunch',
    [
      {
        categoryId: meals.id,
        amount: random.step(1800, 3200, 100),
        description: 'Sprint close',
        daysBack: 6,
      },
    ],
    { status: 'APPROVED', month: monthKey(todayKey, -1), daysBack: 4 },
  );
}
