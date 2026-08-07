import type { AccessTokenClaims } from '@hrms/types';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { RecruitmentService } from './recruitment.service';

const OFFER = {
  id: 'off1',
  organizationId: 'org1',
  applicationId: 'app1',
  status: 'ACCEPTED' as string,
  hiredEmployeeId: null as string | null,
  joinDate: new Date('2026-09-01T00:00:00.000Z'),
  departmentId: 'dep1',
  designationId: 'des1',
  locationId: 'loc1',
  employmentTypeId: 'emp1',
  notes: null,
  application: {
    id: 'app1',
    stage: 'OFFER' as string,
    candidate: {
      id: 'cand1',
      firstName: 'Nadia',
      lastName: 'Rahman',
      email: 'nadia@example.com',
    },
    opening: { id: 'op1', title: 'Software Engineer' },
  },
};

interface Over {
  offer?: Partial<typeof OFFER>;
}

function makeService(over: Over = {}) {
  const offer = {
    ...OFFER,
    ...over.offer,
    application: { ...OFFER.application, ...over.offer?.application },
  };
  // biome-ignore lint/suspicious/noExplicitAny: structural test double
  const prisma: any = {
    offer: { findFirst: jest.fn().mockResolvedValue(offer), update: jest.fn() },
    application: { update: jest.fn(), count: jest.fn().mockResolvedValue(0) },
    jobOpening: {
      findFirst: jest.fn(),
      update: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
    },
    candidate: { findUnique: jest.fn(), findFirst: jest.fn(), create: jest.fn() },
    auditLog: { create: jest.fn() },
    $transaction: jest.fn().mockResolvedValue([]),
  };
  const onboarding = {
    onboard: jest.fn().mockResolvedValue({
      employee: { id: 'newEmp', employeeCode: 'EMP-0099' },
      inviteSent: true,
      inviteError: null,
    }),
  };
  const policy = { contextFor: async () => ({ todayKey: '2026-08-06' }) };
  // Only `ensureSlug` is reached from here — the public URL an opening gets
  // when it is first published.
  const careers = { ensureSlug: jest.fn().mockResolvedValue('a-role') };
  // biome-ignore lint/suspicious/noExplicitAny: structural test doubles
  const service = new RecruitmentService(prisma, onboarding as any, policy as any, careers as any);
  return { service, prisma, onboarding };
}

const claims = (perms: string[]): AccessTokenClaims => ({
  sub: 'u1',
  orgId: 'org1',
  roleCode: 'HR',
  perms,
  employeeId: 'hr1',
});

const HIRER = ['recruitment.hire', 'employee.invite', 'recruitment.read'];

/* `employeeCode` is optional but present on the type — the schema's transform
   turns "" into undefined rather than dropping the key. */
const hireInput = { workEmail: 'nadia@acme.com', employeeCode: undefined };

describe('hiring', () => {
  /*
   * The point of the whole module. A hire is not a second way to create an
   * employee — it goes through the same onboarding invite as HR's own screen,
   * so employee-code generation, the unusable password and the audit entry all
   * stay in one place.
   */
  it('converts through the existing onboarding invite rather than creating an employee', async () => {
    const { service, onboarding } = makeService();
    await service.hire(claims(HIRER), 'off1', hireInput);

    expect(onboarding.onboard).toHaveBeenCalledTimes(1);
    const [, input] = onboarding.onboard.mock.calls[0];
    expect(input).toMatchObject({
      firstName: 'Nadia',
      lastName: 'Rahman',
      workEmail: 'nadia@acme.com',
      departmentId: 'dep1',
    });
  });

  /*
   * The invite goes to the address they can actually read. Their work mailbox
   * is created by this very act, so sending there would be posting a letter to
   * a house nobody has moved into.
   */
  it('sends the invite to the personal address, not the new work one', async () => {
    const { service, onboarding } = makeService();
    await service.hire(claims(HIRER), 'off1', hireInput);

    expect(onboarding.onboard.mock.calls[0][1].personalEmail).toBe('nadia@example.com');
  });

  /* The date agreed in the offer, not today, and not a guess. */
  it('starts them on the date the offer said', async () => {
    const { service, onboarding } = makeService();
    await service.hire(claims(HIRER), 'off1', hireInput);

    expect(onboarding.onboard.mock.calls[0][1].joinDate).toBe('2026-09-01');
  });

  it('links the offer to the new employee and moves the application to HIRED', async () => {
    const { service, prisma } = makeService();
    await service.hire(claims(HIRER), 'off1', hireInput);

    const [offerUpdate, applicationUpdate] = prisma.$transaction.mock.calls[0][0];
    void offerUpdate;
    void applicationUpdate;
    expect(prisma.offer.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { hiredEmployeeId: 'newEmp' } }),
    );
    expect(prisma.application.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ stage: 'HIRED' }) }),
    );
  });

  /* Passed through rather than swallowed: onboard() deliberately does not fail
     the request when the mail does not send, and the screen must be able to
     say so and offer a resend. */
  it('reports whether the invite actually went', async () => {
    const { service } = makeService();
    const result = await service.hire(claims(HIRER), 'off1', hireInput);
    expect(result.inviteSent).toBe(true);
  });

  it('refuses an offer nobody has accepted', async () => {
    const { service } = makeService({ offer: { status: 'SENT' } });
    await expect(service.hire(claims(HIRER), 'off1', hireInput)).rejects.toThrow(
      BadRequestException,
    );
  });

  /* Converting twice would create a second employee for one person. */
  it('refuses a second conversion of the same offer', async () => {
    const { service } = makeService({ offer: { hiredEmployeeId: 'already' } });
    await expect(service.hire(claims(HIRER), 'off1', hireInput)).rejects.toThrow(
      /already been converted/,
    );
  });

  it('refuses somebody who cannot hire', async () => {
    const { service, onboarding } = makeService();
    await expect(
      service.hire(claims(['recruitment.offer.manage', 'employee.invite']), 'off1', hireInput),
    ).rejects.toThrow(ForbiddenException);
    expect(onboarding.onboard).not.toHaveBeenCalled();
  });

  /*
   * Stated rather than discovered. Without this the caller reaches onboard()
   * and gets *its* refusal, which is correct but reads as though the
   * recruitment permission was the problem.
   */
  it('says plainly that hiring also needs employee.invite', async () => {
    const { service } = makeService();
    await expect(
      service.hire(claims(['recruitment.hire', 'recruitment.read']), 'off1', hireInput),
    ).rejects.toThrow(/employee\.invite/);
  });
});

describe('what a hiring manager can see', () => {
  /*
   * The sentinel. A manager with no employee record must match nothing — an
   * undefined here would drop the filter and show them every opening.
   */
  it('narrows a team reader to their own openings', async () => {
    const { service, prisma } = makeService();
    await service.listOpenings(claims(['recruitment.read.team']), { page: 1, limit: 20 });

    expect(prisma.jobOpening.findMany.mock.calls[0][0].where).toMatchObject({
      organizationId: 'org1',
      hiringManagerId: 'hr1',
    });
  });

  it('leaves an org-wide reader unnarrowed', async () => {
    const { service, prisma } = makeService();
    await service.listOpenings(claims(['recruitment.read']), { page: 1, limit: 20 });

    expect(prisma.jobOpening.findMany.mock.calls[0][0].where.hiringManagerId).toBeUndefined();
  });

  /* A manager with no employee record matches nothing, not everything. */
  it('matches nothing for a team reader with no employee record', async () => {
    const { service, prisma } = makeService();
    await service.listOpenings(
      { ...claims(['recruitment.read.team']), employeeId: undefined },
      { page: 1, limit: 20 },
    );

    expect(prisma.jobOpening.findMany.mock.calls[0][0].where.hiringManagerId).toBe('__none__');
  });

  it('refuses somebody with no recruitment read at all', async () => {
    const { service } = makeService();
    await expect(
      service.listOpenings(claims(['employee.read']), { page: 1, limit: 20 }),
    ).rejects.toThrow(ForbiddenException);
  });
});
