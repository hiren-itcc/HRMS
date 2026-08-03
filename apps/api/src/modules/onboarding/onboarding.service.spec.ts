import type { AccessTokenClaims } from '@hrms/types';
import { ConflictException, ForbiddenException } from '@nestjs/common';
import { OnboardingService } from './onboarding.service';

type Mock = jest.Mock;

const complete = {
  id: 'ob1',
  employeeId: 'e2',
  status: 'IN_PROGRESS' as string,
  hasPreviousEmployment: true,
  idProofDocId: 'd1',
  bankProofDocId: 'd2',
  educationDocId: 'd3',
  prevEmploymentDocId: 'd4',
  employee: {
    id: 'e2',
    userId: 'u2',
    dateOfBirth: new Date('1995-01-01'),
    bankDetail: { id: 'b1' },
    departmentId: 'dep1',
    designationId: 'des1',
    locationId: 'loc1',
    shiftId: 'sh1',
    employmentTypeId: 'et1',
  },
};

function makeService(record: Record<string, unknown> = { ...complete }) {
  // Annotated because `$transaction` hands the double back to itself, and the
  // inferred type would be circular.
  // biome-ignore lint/suspicious/noExplicitAny: structural test double
  const prisma: any = {
    onboarding: {
      findUnique: jest.fn().mockResolvedValue(record),
      findFirst: jest.fn().mockResolvedValue(record),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      update: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
      create: jest.fn(),
    },
    employee: { update: jest.fn(), findFirst: jest.fn().mockResolvedValue(null) },
    auditLog: { create: jest.fn() },
    $transaction: jest.fn((arg: unknown) =>
      typeof arg === 'function'
        ? (arg as (tx: unknown) => Promise<unknown>)(prisma)
        : Promise.all(arg as Promise<unknown>[]),
    ),
  };
  const invites = { mint: jest.fn(), send: jest.fn() };
  const tokens = { revokeAllForUser: jest.fn() };
  const logger = { setContext: jest.fn(), error: jest.fn(), info: jest.fn() };
  return {
    service: new OnboardingService(
      // biome-ignore lint/suspicious/noExplicitAny: structural test doubles
      prisma as any,
      // biome-ignore lint/suspicious/noExplicitAny: structural test doubles
      invites as any,
      // biome-ignore lint/suspicious/noExplicitAny: structural test doubles
      tokens as any,
      // biome-ignore lint/suspicious/noExplicitAny: structural test doubles
      logger as any,
    ),
    prisma,
    tokens,
  };
}

const hire = (): AccessTokenClaims => ({
  sub: 'u2',
  orgId: 'org1',
  roleCode: 'EMPLOYEE',
  perms: [],
  employeeId: 'e2',
});

const hr = (): AccessTokenClaims => ({
  sub: 'u1',
  orgId: 'org1',
  roleCode: 'HR',
  perms: ['employee.read', 'employee.onboarding.approve'],
  employeeId: 'e-hr',
});

describe('the wizard closes when it leaves IN_PROGRESS', () => {
  /*
   * The check the JWT claim cannot make. Without it an approved employee could
   * keep POSTing to the wizard and rewrite their own bank details forever,
   * with no HR review — which is exactly the widening the separate schema was
   * introduced to prevent.
   */
  it.each(['SUBMITTED', 'APPROVED'])('refuses a profile edit while %s', async (status) => {
    const { service } = makeService({ ...complete, status });
    await expect(service.updateMine(hire(), { phone: '999' })).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('refuses a bank write once approved', async () => {
    const { service } = makeService({ ...complete, status: 'APPROVED' });
    await expect(service.assertOwnAndEditable(hire())).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('allows edits while in progress', async () => {
    const { service } = makeService();
    await expect(service.assertOwnAndEditable(hire())).resolves.toBeUndefined();
  });
});

describe('filing a document against a checklist slot', () => {
  function withDoc(record: Record<string, unknown>) {
    const made = makeService(record);
    made.prisma.document = { findFirst: jest.fn().mockResolvedValue({ id: 'doc9' }) };
    return made;
  }

  it('writes the document id to the slot column', async () => {
    const { service, prisma } = withDoc({ ...complete, idProofDocId: null });
    await service.attachDocument(hire(), { slot: 'idProof', documentId: 'doc9' });
    expect(prisma.onboarding.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { idProofDocId: 'doc9' } }),
    );
  });

  /*
   * The uploaded file must belong to the person filing it — otherwise a hire
   * could satisfy their own checklist with somebody else's document id.
   */
  it('refuses a document that is not theirs', async () => {
    const { service, prisma } = withDoc({ ...complete });
    (prisma.document.findFirst as Mock).mockResolvedValue(null);
    await expect(
      service.attachDocument(hire(), { slot: 'idProof', documentId: 'someone-elses' }),
    ).rejects.toThrow(/not found/i);
  });

  it('refuses once the record has left the employee', async () => {
    const { service } = withDoc({ ...complete, status: 'SUBMITTED' });
    await expect(
      service.attachDocument(hire(), { slot: 'idProof', documentId: 'doc9' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe('submission completeness', () => {
  it('refuses while a required document is missing', async () => {
    const { service } = makeService({ ...complete, idProofDocId: null });
    await expect(service.submit(hire())).rejects.toThrow(/photo id proof/i);
  });

  it('refuses until the first-job question is answered', async () => {
    const { service } = makeService({ ...complete, hasPreviousEmployment: null });
    await expect(service.submit(hire())).rejects.toThrow(/first job/i);
  });

  /*
   * The fresher case: declaring no previous employment satisfies the relieving
   * letter, rather than the requirement being silently waived.
   */
  it('lets a first-jobber submit without a relieving letter', async () => {
    const { service, prisma } = makeService({
      ...complete,
      hasPreviousEmployment: false,
      prevEmploymentDocId: null,
    });
    await service.submit(hire());
    expect(prisma.onboarding.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'SUBMITTED' }) }),
    );
  });

  it('refuses a relieving letter gap from someone who has worked before', async () => {
    const { service } = makeService({ ...complete, prevEmploymentDocId: null });
    await expect(service.submit(hire())).rejects.toThrow(/relieving letter/i);
  });

  it('refuses without bank details', async () => {
    const { service } = makeService({
      ...complete,
      employee: { ...complete.employee, bankDetail: null },
    });
    await expect(service.submit(hire())).rejects.toThrow(/bank details/i);
  });

  it('refuses a second submission', async () => {
    const { service, prisma } = makeService();
    (prisma.onboarding.updateMany as Mock).mockResolvedValue({ count: 0 });
    await expect(service.submit(hire())).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('approval', () => {
  it('makes the employee active and kills their stale sessions', async () => {
    const { service, prisma, tokens } = makeService({ ...complete, status: 'SUBMITTED' });
    await service.approve(hr(), 'ob1');

    expect(prisma.employee.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'ACTIVE' } }),
    );
    // Their token still says onboarding: true, and the guard reads the claim.
    expect(tokens.revokeAllForUser).toHaveBeenCalledWith('u2');
  });

  it('refuses to approve anything not submitted', async () => {
    const { service } = makeService();
    await expect(service.approve(hr(), 'ob1')).rejects.toBeInstanceOf(ConflictException);
  });

  it('refuses a second approval', async () => {
    const { service, prisma } = makeService({ ...complete, status: 'SUBMITTED' });
    (prisma.onboarding.updateMany as Mock).mockResolvedValue({ count: 0 });
    await expect(service.approve(hr(), 'ob1')).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.employee.update).not.toHaveBeenCalled();
  });

  /*
   * The job fields HR was allowed to defer at invite time are validated here,
   * so nobody reaches ACTIVE without a department or a shift — which is what
   * employeeCreateSchema has always insisted on.
   */
  it('refuses to approve an employee with no department', async () => {
    const { service } = makeService({
      ...complete,
      status: 'SUBMITTED',
      employee: { ...complete.employee, departmentId: null },
    });
    await expect(service.approve(hr(), 'ob1')).rejects.toThrow(/department/i);
  });
});

describe('request changes', () => {
  it('reopens the wizard with a note', async () => {
    const { service, prisma } = makeService({ ...complete, status: 'SUBMITTED' });
    await service.requestChanges(hr(), 'ob1', 'The PAN card is unreadable');
    expect(prisma.onboarding.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'IN_PROGRESS',
          reviewNote: 'The PAN card is unreadable',
        }),
      }),
    );
  });
});
