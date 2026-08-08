import type { AccessTokenClaims } from '@hrms/types';
import { LeaveRequestsService } from './leave-requests.service';

type Mock = jest.Mock;

/**
 * What leave says when something happens to a request.
 *
 * Until this shipped it said nothing at all — not an email, and not even a bell.
 * The feature audit recorded only the missing email, because it went looking for
 * the sender of a template rather than for a notification.
 *
 * Scoped to the announcing, not to the deciding: the balance arithmetic and the
 * permission checks are `leave.util.spec.ts` and the controller's business.
 */

const REQUEST = {
  id: 'lr1',
  employeeId: 'e1',
  leaveTypeId: 'lt1',
  leaveYear: 2026,
  days: 2,
  status: 'PENDING',
  startDate: new Date('2026-10-01T00:00:00Z'),
  endDate: new Date('2026-10-02T00:00:00Z'),
  halfDaySide: null,
  reason: 'Diwali',
  approverNote: null,
  actedAt: null,
  createdAt: new Date('2026-09-01T00:00:00Z'),
  leaveType: { id: 'lt1', name: 'Casual leave', code: 'CL' },
  employee: {
    id: 'e1',
    firstName: 'Asha',
    lastName: 'Verma',
    employeeCode: 'EMP-0005',
    managerId: 'e9',
  },
};

function makeService() {
  // biome-ignore lint/suspicious/noExplicitAny: structural test double
  const prisma: any = {
    leaveRequest: {
      findFirst: jest.fn().mockResolvedValue(REQUEST),
      findUniqueOrThrow: jest.fn().mockResolvedValue({ ...REQUEST, status: 'APPROVED' }),
      update: jest.fn().mockResolvedValue(REQUEST),
    },
    leaveBalance: {
      findUniqueOrThrow: jest
        .fn()
        .mockResolvedValue({ id: 'b1', allocated: 12, carriedOver: 0, used: 0 }),
      update: jest.fn().mockResolvedValue({}),
    },
    employee: {
      findUnique: jest.fn().mockResolvedValue({ user: { id: 'u-asha', email: 'asha@acme.test' } }),
    },
    user: {
      findUnique: jest.fn().mockResolvedValue({
        email: 'meera@acme.test',
        employee: { firstName: 'Meera', lastName: 'Iyer' },
      }),
    },
    auditLog: { create: jest.fn().mockResolvedValue({}) },
    $transaction: jest.fn((ops: unknown[]) => Promise.all(ops as Promise<unknown>[])),
  };
  const balances = { ensureForEmployee: jest.fn().mockResolvedValue(undefined) };
  const settings = { get: jest.fn().mockResolvedValue({ workingWeek: { weekOffDays: [0] } }) };
  const notifications = { notify: jest.fn(), notifyPermission: jest.fn() };
  const mail = { sendTemplate: jest.fn().mockResolvedValue(true) };

  const service = new LeaveRequestsService(
    prisma,
    // biome-ignore lint/suspicious/noExplicitAny: structural test double
    balances as any,
    // biome-ignore lint/suspicious/noExplicitAny: structural test double
    settings as any,
    // biome-ignore lint/suspicious/noExplicitAny: structural test double
    notifications as any,
    // biome-ignore lint/suspicious/noExplicitAny: structural test double
    mail as any,
  );
  return { service, prisma, notifications, mail };
}

/** A manager who is not the requester, and can approve their team. */
const approver: AccessTokenClaims = {
  sub: 'u-meera',
  orgId: 'org1',
  roleCode: 'MANAGER',
  perms: ['leave.approve.team'],
  employeeId: 'e9',
};

describe('deciding a leave request', () => {
  it('rings the requester’s bell and emails the approved template', async () => {
    const { service, notifications, mail } = makeService();

    await service.decide(approver, 'lr1', 'APPROVED', { note: undefined });

    expect(notifications.notify).toHaveBeenCalledWith(
      ['u-asha'],
      expect.objectContaining({ type: 'leave.approved', linkPath: '/leave' }),
      // The generic notification email is suppressed because the specific one
      // below carries the dates and the approver's name, which the generic
      // template has no way to know.
      { email: false },
    );
    expect(mail.sendTemplate).toHaveBeenCalledWith(
      'org1',
      'leave_approved',
      'asha@acme.test',
      expect.objectContaining({
        firstName: 'Asha',
        leaveType: 'Casual leave',
        startDate: '1 Oct 2026',
        endDate: '2 Oct 2026',
        approverName: 'Meera Iyer',
      }),
    );
  });

  it('emails the declined template instead, with the note', async () => {
    const { service, mail } = makeService();

    await service.decide(approver, 'lr1', 'REJECTED', { note: 'Team is short that week' });

    expect(mail.sendTemplate).toHaveBeenCalledWith(
      'org1',
      'leave_rejected',
      'asha@acme.test',
      expect.objectContaining({ approverNote: 'Team is short that week' }),
    );
  });

  /*
   * `mapRequest` forwards `employee` verbatim, so anything the request include
   * grows appears on every leave response. Reading the address separately is
   * what keeps an email address off the wire — this is the assertion that stops
   * somebody helpfully adding it back.
   */
  it('does not put the requester’s email address on the response', async () => {
    const { service } = makeService();

    const result = await service.decide(approver, 'lr1', 'APPROVED', { note: undefined });

    expect(JSON.stringify(result)).not.toContain('asha@acme.test');
  });

  /*
   * The decision is written and the balance already moved before any of this
   * runs. Neither may be undone because a mail host was unreachable.
   */
  it('still returns when the mail transport throws', async () => {
    const { service, mail } = makeService();
    (mail.sendTemplate as Mock).mockRejectedValue(new Error('smtp down'));

    await expect(
      service.decide(approver, 'lr1', 'APPROVED', { note: undefined }),
    ).resolves.toBeDefined();
  });

  /* A record created with `createLogin: false` has nowhere to receive either. */
  it('sends no email to somebody with no sign-in', async () => {
    const { service, prisma, mail } = makeService();
    (prisma.employee.findUnique as Mock).mockResolvedValue({ user: null });

    await service.decide(approver, 'lr1', 'APPROVED', { note: undefined });

    expect(mail.sendTemplate).not.toHaveBeenCalled();
  });
});
