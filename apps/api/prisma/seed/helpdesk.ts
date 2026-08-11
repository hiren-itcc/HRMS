import type { PrismaClient } from '../../src/generated/prisma/client';
import type { People } from './people';

/**
 * A helpdesk with one ticket in every state that renders differently.
 *
 * The pieces worth checking by eye rather than only in a test:
 *
 * - A ticket **waiting on the requester**, which is the one status that asks
 *   the reader for something and the only automatic transition in the module.
 * - A ticket carrying an **internal note** underneath a public reply, so the
 *   two-sided rendering is visible: Asha's thread shows two entries and HR's
 *   shows three. If that ever stops being true, this is where it shows.
 * - A **system entry**, because the module has no status-history table and this
 *   is what stands in for one.
 * - An **unassigned** ticket, so the queue has something in it that nobody has
 *   picked up — the case a default assignee would otherwise always hide.
 */
export async function seedHelpdesk(prisma: PrismaClient, orgId: string, people: People) {
  const priya = people.emp('hr@hrms.local');
  const hrUser = people.usr('hr@hrms.local');
  const asha = people.emp('asha@hrms.local');
  const ashaUser = people.usr('asha@hrms.local');
  const rohan = people.emp('rohan@hrms.local');

  const [payroll, itSupport, general] = await Promise.all(
    [
      {
        name: 'Payroll query',
        description: 'Payslips, reimbursements, tax and bank details',
        defaultAssigneeId: priya,
      },
      {
        name: 'IT support',
        description: 'Laptops, accounts, access',
        /* Deliberately unrouted, so the queue has something unassigned in it. */
        defaultAssigneeId: null,
      },
      { name: 'Anything else', description: null, defaultAssigneeId: priya },
    ].map((data) => prisma.ticketCategory.create({ data: { organizationId: orgId, ...data } })),
  );

  /* Resolved, and closed by the person who raised it — the ordinary happy end. */
  const done = await prisma.ticket.create({
    data: {
      organizationId: orgId,
      categoryId: general?.id ?? '',
      requesterId: rohan,
      assigneeId: priya,
      subject: 'Wrong shift on my profile',
      description: 'My profile says General but I am on the Pune early shift.',
      status: 'CLOSED',
      priority: 'LOW',
      resolution: 'Shift corrected to Early on the profile.',
      assignedAt: new Date(),
      resolvedAt: new Date(),
      closedAt: new Date(),
    },
  });
  await prisma.ticketComment.createMany({
    data: [
      { ticketId: done.id, authorId: hrUser, kind: 'PUBLIC', body: 'Fixed — have a look now.' },
      { ticketId: done.id, kind: 'SYSTEM', body: 'Resolved' },
      { ticketId: done.id, kind: 'SYSTEM', body: 'Closed' },
    ],
  });

  /* In progress, with an internal note under a public reply. The two-sided
     thread everything in this module is arranged around. */
  const live = await prisma.ticket.create({
    data: {
      organizationId: orgId,
      categoryId: payroll?.id ?? '',
      requesterId: asha,
      assigneeId: priya,
      subject: 'Payslip is missing a reimbursement',
      description: 'My August payslip does not show the travel claim that was approved.',
      status: 'IN_PROGRESS',
      priority: 'HIGH',
      assignedAt: new Date(),
    },
  });
  await prisma.ticketComment.createMany({
    data: [
      { ticketId: live.id, kind: 'SYSTEM', body: 'Assigned to Priya Nair' },
      { ticketId: live.id, authorId: hrUser, kind: 'PUBLIC', body: 'Looking into this now.' },
      {
        ticketId: live.id,
        authorId: hrUser,
        kind: 'INTERNAL',
        body: 'Claim was approved after the run closed. Do not promise a date until finance confirm the next one.',
      },
    ],
  });

  /* Waiting on the requester — the status that asks the reader for something. */
  const waiting = await prisma.ticket.create({
    data: {
      organizationId: orgId,
      categoryId: payroll?.id ?? '',
      requesterId: rohan,
      assigneeId: priya,
      subject: 'Update my bank account',
      description: 'I have changed banks and need my salary paid into the new account.',
      status: 'WAITING_ON_REQUESTER',
      assignedAt: new Date(),
    },
  });
  await prisma.ticketComment.createMany({
    data: [
      {
        ticketId: waiting.id,
        authorId: hrUser,
        kind: 'PUBLIC',
        body: 'Please send a cancelled cheque or a bank letter and we will update it.',
      },
      { ticketId: waiting.id, kind: 'SYSTEM', body: 'Waiting on the person who raised this' },
    ],
  });

  /* Open and unassigned: what the queue looks like before anybody picks it up. */
  await prisma.ticket.create({
    data: {
      organizationId: orgId,
      categoryId: itSupport?.id ?? '',
      requesterId: asha,
      subject: 'Laptop will not connect to the office wifi',
      description: 'Since the update on Monday it drops every few minutes.',
      status: 'OPEN',
      priority: 'NORMAL',
    },
  });

  /* And one the requester withdrew, so a cancelled ticket is on screen too. */
  const dropped = await prisma.ticket.create({
    data: {
      organizationId: orgId,
      categoryId: general?.id ?? '',
      requesterId: asha,
      subject: 'Duplicate of my payslip question',
      description: 'Raised this twice by mistake.',
      status: 'CANCELLED',
    },
  });
  await prisma.ticketComment.create({
    data: {
      ticketId: dropped.id,
      authorId: ashaUser,
      kind: 'SYSTEM',
      body: 'Cancelled — duplicate',
    },
  });

  return { categories: 3, tickets: 5 };
}
