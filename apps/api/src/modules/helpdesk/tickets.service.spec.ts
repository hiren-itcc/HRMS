import type { AccessTokenClaims } from '@hrms/types';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { notificationsDouble } from '../notifications/notifications.test-double';
import { TicketsService } from './tickets.service';

/**
 * The wiring the rules hang off.
 *
 * The state machine itself is `helpdesk.rules.spec.ts` — pure and exhaustive
 * there. What is here is what that cannot see: who a scoped query actually
 * reaches, whether an internal note stays internal, and who gets told.
 */

const TICKET = {
  id: 't1',
  organizationId: 'org1',
  categoryId: 'cat1',
  requesterId: 'e-asha',
  assigneeId: null as string | null,
  subject: 'Payslip is missing a reimbursement',
  description: 'The August payslip does not show my travel claim.',
  status: 'OPEN' as const,
  priority: 'NORMAL',
  resolution: null,
  assignedAt: null,
  resolvedAt: null,
  closedAt: null,
  createdAt: new Date('2026-08-01T00:00:00Z'),
  updatedAt: new Date('2026-08-01T00:00:00Z'),
  category: { id: 'cat1', name: 'Payroll query' },
  requester: { id: 'e-asha', firstName: 'Asha', lastName: 'Verma', employeeCode: 'EMP-0005' },
  assignee: null,
  comments: [
    {
      id: 'c1',
      kind: 'PUBLIC' as const,
      body: 'Looking into it.',
      createdAt: new Date('2026-08-02T00:00:00Z'),
      author: { id: 'u-hr', email: 'hr@hrms.local', employee: null },
    },
    {
      id: 'c2',
      kind: 'INTERNAL' as const,
      body: 'Finance says the claim was approved after the run closed — do not promise a date.',
      createdAt: new Date('2026-08-02T01:00:00Z'),
      author: { id: 'u-hr', email: 'hr@hrms.local', employee: null },
    },
  ],
};

function makeService(ticket: unknown = TICKET) {
  // biome-ignore lint/suspicious/noExplicitAny: structural test double
  const prisma: any = {
    ticket: {
      findFirst: jest.fn().mockResolvedValue(ticket),
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
      create: jest.fn().mockResolvedValue(ticket),
      update: jest.fn().mockResolvedValue(ticket),
    },
    ticketComment: { create: jest.fn().mockResolvedValue({}) },
    employee: {
      findUnique: jest.fn().mockResolvedValue({ userId: 'u-asha' }),
      findFirst: jest.fn().mockResolvedValue({
        user: {
          status: 'ACTIVE',
          role: { permissions: [{ permission: { code: 'helpdesk.respond' } }] },
        },
      }),
    },
    user: { findMany: jest.fn().mockResolvedValue([{ id: 'u-hr' }]) },
    auditLog: { create: jest.fn().mockResolvedValue({}) },
    $transaction: jest.fn((ops: unknown[]) => Promise.all(ops as Promise<unknown>[])),
  };
  const categories = {
    requireActive: jest
      .fn()
      .mockResolvedValue({ id: 'cat1', name: 'Payroll query', defaultAssigneeId: 'e-priya' }),
  };
  const notifications = notificationsDouble();
  const service = new TicketsService(
    prisma,
    // biome-ignore lint/suspicious/noExplicitAny: structural test double
    categories as any,
    notifications,
  );
  return { service, prisma, categories, notifications };
}

/** Asha raised the ticket. Holds only the two `.own` codes. */
const asha: AccessTokenClaims = {
  sub: 'u-asha',
  orgId: 'org1',
  roleCode: 'EMPLOYEE',
  perms: ['helpdesk.read.own', 'helpdesk.raise.own'],
  employeeId: 'e-asha',
};

/** HR works the desk. */
const hr: AccessTokenClaims = {
  sub: 'u-hr',
  orgId: 'org1',
  roleCode: 'HR',
  perms: ['helpdesk.read.own', 'helpdesk.raise.own', 'helpdesk.read', 'helpdesk.respond'],
  employeeId: 'e-priya',
};

/** Works the desk, but has no employee record of their own. */
const agentWithoutEmployee: AccessTokenClaims = {
  sub: 'u-admin',
  orgId: 'org1',
  roleCode: 'ADMIN',
  perms: ['helpdesk.read.own', 'helpdesk.respond'],
  employeeId: undefined,
};

describe('scoping a list', () => {
  const whereOf = (prisma: { ticket: { findMany: jest.Mock } }) =>
    prisma.ticket.findMany.mock.calls[0][0].where;

  it('gives an employee only the tickets they raised', async () => {
    const { service, prisma } = makeService();
    await service.list(asha, { scope: 'own', page: 1, limit: 20 } as never);
    expect(whereOf(prisma)).toMatchObject({ organizationId: 'org1', requesterId: 'e-asha' });
  });

  it('gives the desk its queue — assigned to me, plus unassigned', async () => {
    const { service, prisma } = makeService();
    await service.list(hr, { scope: 'queue', page: 1, limit: 20 } as never);
    expect(whereOf(prisma).OR).toEqual([{ assigneeId: 'e-priya' }, { assigneeId: null }]);
  });

  /*
   * The one that matters most, and the reason `'__none__'` exists: an
   * `undefined` here would have dropped the clause entirely and answered "every
   * ticket in the company" to somebody holding nothing but `.read.own`.
   */
  it('matches nothing rather than everything when there is no employee record', async () => {
    const { service, prisma } = makeService();
    await service.list({ ...asha, employeeId: undefined }, {
      scope: 'own',
      page: 1,
      limit: 20,
    } as never);
    expect(whereOf(prisma)).toMatchObject({ requesterId: '__none__' });
  });

  /*
   * Narrowed, not refused — the convention expenses and performance already
   * follow and `rbac.e2e-spec.ts` pins. Worth a test rather than a shrug,
   * because "asked for all, got own" passing silently is precisely how a
   * `where` clause that became `{}` would go unnoticed.
   */
  it('quietly narrows a scope wider than the caller holds', async () => {
    const { service, prisma } = makeService();
    await service.list(asha, { scope: 'all', page: 1, limit: 20 } as never);
    expect(whereOf(prisma)).toMatchObject({ requesterId: 'e-asha' });

    prisma.ticket.findMany.mockClear();
    await service.list(asha, { scope: 'queue', page: 1, limit: 20 } as never);
    expect(whereOf(prisma)).toMatchObject({ requesterId: 'e-asha' });
  });

  it('lets somebody holding helpdesk.read ask for all of them', async () => {
    const { service, prisma } = makeService();
    await service.list(hr, { scope: 'all', page: 1, limit: 20 } as never);
    expect(whereOf(prisma)).toEqual({ organizationId: 'org1' });
  });
});

describe('reading one ticket', () => {
  it('is a 404, not a 403, for a ticket the caller cannot reach', async () => {
    const { service } = makeService(null);
    await expect(service.get(asha, 't1')).rejects.toThrow(NotFoundException);
  });

  /*
   * The end-to-end version of the `visibleComments` unit test, and the bug that
   * actually matters: the internal note is in the row the service read, and
   * must not be in what it returns.
   */
  it('never returns an internal note to the person who raised the ticket', async () => {
    const { service } = borrowed();
    const ticket = await service.get(asha, 't1');
    expect(ticket.comments).toHaveLength(2);
    expect(ticket.comments?.map((c) => c.kind)).toEqual(['PUBLIC', 'PUBLIC']);
    expect(JSON.stringify(ticket)).not.toContain('do not promise a date');
  });

  /* The same thread as the test above, so the two counts are comparable: three
     entries exist, the requester sees two of them. */
  it('returns it to somebody working the desk', async () => {
    const { service } = borrowed();
    const ticket = await service.get(hr, 't1');
    expect(ticket.comments).toHaveLength(3);
    expect(ticket.comments?.some((c) => c.kind === 'INTERNAL')).toBe(true);
  });

  /* Holding the code is not enough if the ticket is your own — nobody is an
     agent on their own complaint. */
  it('treats an agent reading their own ticket as the requester', async () => {
    const { service } = makeService({ ...TICKET, requesterId: 'e-priya' });
    const ticket = await service.get(hr, 't1');
    expect(ticket.comments?.some((c) => c.kind === 'INTERNAL')).toBe(false);
    expect(ticket.canResolve).toBe(false);
  });
});

/* A third public comment so the counts above read clearly. */
function borrowed() {
  return makeService({
    ...TICKET,
    comments: [
      ...TICKET.comments,
      {
        id: 'c3',
        kind: 'PUBLIC' as const,
        body: 'Any update?',
        createdAt: new Date('2026-08-03T00:00:00Z'),
        author: { id: 'u-asha', email: 'asha@hrms.local', employee: null },
      },
    ],
  });
}

describe('commenting', () => {
  it('refuses an internal note from somebody who does not work the desk', async () => {
    const { service, prisma } = makeService();
    await expect(
      service.comment(asha, 't1', { body: 'private thoughts', internal: true }),
    ).rejects.toThrow(ForbiddenException);
    /* And writes nothing — a refusal that still saved the row would be worse
       than no refusal, because it would look like it worked. */
    expect(prisma.ticketComment.create).not.toHaveBeenCalled();
  });

  it('moves a waiting ticket back into progress when the requester replies', async () => {
    const { service, prisma } = makeService({ ...TICKET, status: 'WAITING_ON_REQUESTER' });
    await service.comment(asha, 't1', { body: 'Here is the payslip', internal: false });
    expect(prisma.ticket.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'IN_PROGRESS' } }),
    );
  });

  it('does not reopen a resolved ticket when the requester says thanks', async () => {
    const { service, prisma } = makeService({ ...TICKET, status: 'RESOLVED' });
    await service.comment(asha, 't1', { body: 'Thanks, that worked', internal: false });
    expect(prisma.ticket.update).not.toHaveBeenCalled();
  });

  it('tells nobody about an internal note', async () => {
    const { service, notifications } = makeService();
    await service.comment(hr, 't1', { body: 'escalating', internal: true });
    expect(notifications.notify).not.toHaveBeenCalled();
  });

  /*
   * The rule that removes the internal-note leak class outright: no
   * notification in this module ever carries a comment body, only the subject.
   * Asserted on the body rather than trusted to each call site.
   */
  it('sends the subject as the notification body, never the comment', async () => {
    const { service, notifications } = makeService();
    await service.comment(hr, 't1', { body: 'We have raised it with finance', internal: false });
    const [, notice] = notifications.notify.mock.calls[0];
    expect(notice.body).toBe(TICKET.subject);
    expect(notice.body).not.toContain('finance');
  });

  /* An agent in a queue is already in the app; one mail per reply on a chatty
     ticket is what teaches people to filter the product's mail. */
  it('does not email the desk when the requester replies', async () => {
    const { service, notifications } = makeService();
    await service.comment(asha, 't1', { body: 'Any update?', internal: false });
    const [, , options] = notifications.notify.mock.calls[0];
    expect(options).toEqual({ email: false });
  });

  it('does email the requester when an agent replies', async () => {
    const { service, notifications } = makeService();
    await service.comment(hr, 't1', { body: 'Fixed in the next run', internal: false });
    const [, , options] = notifications.notify.mock.calls[0];
    expect(options).toBeUndefined();
  });
});

describe('creating', () => {
  it('routes to the category default assignee', async () => {
    const { service, prisma } = makeService();
    await service.create(asha, { categoryId: 'cat1', subject: 'A question', description: 'Body' });
    expect(prisma.ticket.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ assigneeId: 'e-priya', requesterId: 'e-asha' }),
      }),
    );
  });

  it('falls back to telling everybody on the desk when the category routes nowhere', async () => {
    const { service, categories, notifications } = makeService();
    categories.requireActive.mockResolvedValue({
      id: 'cat1',
      name: 'General',
      defaultAssigneeId: null,
    });
    await service.create(asha, { categoryId: 'cat1', subject: 'A question', description: 'Body' });
    /* The body is the subject of the row that was written — the stub echoes the
       fixture rather than the input, which is why this reads TICKET.subject and
       not 'A question'. The point stands either way: never the description. */
    expect(notifications.notifyPermission).toHaveBeenCalledWith(
      'org1',
      'helpdesk.respond',
      expect.objectContaining({ body: TICKET.subject, type: 'helpdesk.ticket.raised' }),
      { except: 'u-asha' },
    );
  });

  it('refuses when the account has no employee record to raise it against', async () => {
    const { service } = makeService();
    await expect(
      service.create(agentWithoutEmployee, {
        categoryId: 'cat1',
        subject: 'A question',
        description: 'Body',
      }),
    ).rejects.toThrow(/no employee record/i);
  });
});

describe('assigning', () => {
  it('refuses somebody who cannot work the desk', async () => {
    const { service, prisma } = makeService();
    prisma.employee.findFirst.mockResolvedValue({
      user: {
        status: 'ACTIVE',
        role: { permissions: [{ permission: { code: 'leave.read.own' } }] },
      },
    });
    await expect(service.assign(hr, 't1', { assigneeId: 'e-rohan' })).rejects.toThrow(
      /does not work the helpdesk/i,
    );
  });

  it('refuses somebody whose account is no longer active', async () => {
    const { service, prisma } = makeService();
    prisma.employee.findFirst.mockResolvedValue({
      user: {
        status: 'DISABLED',
        role: { permissions: [{ permission: { code: 'helpdesk.respond' } }] },
      },
    });
    await expect(service.assign(hr, 't1', { assigneeId: 'e-gone' })).rejects.toThrow(
      /does not work the helpdesk/i,
    );
  });

  it('does not notify you about a ticket you picked up yourself', async () => {
    const { service, notifications } = makeService();
    await service.assign(hr, 't1', { assigneeId: 'e-priya' });
    expect(notifications.notify).not.toHaveBeenCalled();
  });
});

describe('the audit trail', () => {
  it('records the status either side of a transition', async () => {
    const { service, prisma } = makeService({ ...TICKET, status: 'IN_PROGRESS' });
    await service.resolve(hr, 't1', { resolution: 'Paid in the September run' });
    const row = prisma.auditLog.create.mock.calls.at(-1)[0].data;
    expect(row).toMatchObject({ action: 'helpdesk.ticket.resolve', entity: 'Ticket' });
    expect(row.meta).toEqual({ before: { status: 'IN_PROGRESS' }, after: { status: 'RESOLVED' } });
  });
});
