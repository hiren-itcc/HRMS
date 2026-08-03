import { letterTemplateDefault } from '@hrms/shared';
import type { AccessTokenClaims } from '@hrms/types';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { LettersService } from './letters.service';

type Mock = jest.Mock;

const employee = {
  id: 'e2',
  employeeCode: 'EMP-0002',
  firstName: 'Asha',
  lastName: 'Verma',
  joinDate: new Date('2024-04-01T00:00:00Z'),
  exitDate: null,
  department: { name: 'Engineering' },
  designation: { title: 'Senior Engineer' },
  location: { name: 'Pune' },
  employmentType: { name: 'permanent' },
  manager: { firstName: 'Meera', lastName: 'Iyer' },
};

function makeService(salary: { monthlyCtc: number } | null = { monthlyCtc: 120000 }) {
  const prisma = {
    employee: { findFirst: jest.fn().mockResolvedValue(employee) },
    organization: { findUniqueOrThrow: jest.fn().mockResolvedValue({ name: 'Acme Industries' }) },
    employeeSalary: { findFirst: jest.fn().mockResolvedValue(salary) },
    letter: {
      count: jest.fn().mockResolvedValue(0),
      create: jest.fn((args: { data: Record<string, unknown> }) =>
        Promise.resolve({ id: 'l1', ...args.data }),
      ),
      findFirst: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      update: jest.fn().mockResolvedValue({ id: 'l1' }),
    },
    auditLog: { create: jest.fn() },
  };
  const templates = {
    // Resolves to the shipped catalogue, as the real service does when an
    // organization has not customised anything.
    resolve: jest.fn((_org: string, key: string) => {
      const template = letterTemplateDefault(key);
      if (!template) throw new Error(`${key} missing from the catalogue`);
      return Promise.resolve({ template, title: template.title, bodyHtml: template.bodyHtml });
    }),
  };
  return {
    // biome-ignore lint/suspicious/noExplicitAny: structural test doubles
    service: new LettersService(prisma as any, templates as any),
    prisma,
  };
}

const claims = (over: Partial<AccessTokenClaims>): AccessTokenClaims => ({
  sub: 'u1',
  orgId: 'org1',
  roleCode: 'HR',
  perms: [],
  ...over,
});

const hr = claims({ perms: ['letter.issue', 'letter.read', 'payroll.read'], employeeId: 'e-hr' });

describe('the salary gate', () => {
  const salaryLetter = { employeeId: 'e2', containsSalary: true };
  const plainLetter = { employeeId: 'e2', containsSalary: false };

  it('lets the subject read their own salary letter', async () => {
    const { service, prisma } = makeService();
    (prisma.letter.findFirst as Mock).mockResolvedValue(salaryLetter);
    await expect(
      service.detail(claims({ perms: ['letter.read.own'], employeeId: 'e2' }), 'l1'),
    ).resolves.toEqual(salaryLetter);
  });

  /*
   * The point of gating on the letter's content rather than on the role: a
   * role composed in Settings with letter.read but no payroll.read is not a
   * role anyone designed, and it still cannot read a CTC.
   */
  it('refuses a salary letter to letter.read without payroll.read', async () => {
    const { service, prisma } = makeService();
    (prisma.letter.findFirst as Mock).mockResolvedValue(salaryLetter);
    await expect(
      service.detail(claims({ perms: ['letter.read'], employeeId: 'e9' }), 'l1'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('allows the same reader a letter that quotes no pay', async () => {
    const { service, prisma } = makeService();
    (prisma.letter.findFirst as Mock).mockResolvedValue(plainLetter);
    await expect(
      service.detail(claims({ perms: ['letter.read'], employeeId: 'e9' }), 'l1'),
    ).resolves.toEqual(plainLetter);
  });

  it('hides salary letters from a list that would then refuse them', async () => {
    const { service, prisma } = makeService();
    await service.listForEmployee(claims({ perms: ['letter.read'], employeeId: 'e9' }), 'e2');
    expect(prisma.letter.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ containsSalary: false }) }),
    );
  });

  it('refuses a stranger with no letter permission at all', async () => {
    const { service } = makeService();
    await expect(
      service.listForEmployee(claims({ perms: [], employeeId: 'e9' }), 'e2'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe('issuing', () => {
  it('freezes the rendered HTML with the values resolved', async () => {
    const { service, prisma } = makeService();
    await service.issue(hr, { employeeId: 'e2', templateKey: 'offer_letter' });

    const written = (prisma.letter.create as Mock).mock.calls[0][0].data;
    expect(written.bodyHtml).toContain('Asha Verma');
    expect(written.bodyHtml).toContain('₹1,20,000');
    // Nothing unresolved may ever reach a document that is never re-rendered.
    expect(written.bodyHtml).not.toContain('{{');
    expect(written.employeeName).toBe('Asha Verma');
    expect(written.containsSalary).toBe(true);
  });

  it('refuses to issue a salary letter when no salary is assigned', async () => {
    const { service } = makeService(null);
    await expect(
      service.issue(hr, { employeeId: 'e2', templateKey: 'salary_certificate' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('still issues a salary-free letter for someone with no salary', async () => {
    const { service, prisma } = makeService(null);
    await service.issue(hr, { employeeId: 'e2', templateKey: 'appointment_letter' });
    expect(prisma.letter.create).toHaveBeenCalled();
    const written = (prisma.letter.create as Mock).mock.calls[0][0].data;
    expect(written.containsSalary).toBe(false);
    expect(written.monthlyCtc).toBeNull();
  });

  it('quotes the salary in force on the issue date, not a future increment', async () => {
    const { service, prisma } = makeService();
    await service.issue(hr, { employeeId: 'e2', templateKey: 'salary_certificate' });
    expect(prisma.employeeSalary.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ effectiveFrom: { lte: expect.any(Date) } }),
      }),
    );
  });

  it('numbers letters per template per year', async () => {
    const { service, prisma } = makeService();
    (prisma.letter.count as Mock).mockResolvedValue(6);
    await service.issue(hr, { employeeId: 'e2', templateKey: 'offer_letter' });
    const written = (prisma.letter.create as Mock).mock.calls[0][0].data;
    expect(written.letterNumber).toMatch(/^OFR\/\d{4}\/0007$/);
  });

  it('audits the issue', async () => {
    const { service, prisma } = makeService();
    await service.issue(hr, { employeeId: 'e2', templateKey: 'offer_letter' });
    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: 'letter.issue' }) }),
    );
  });
});

describe('voiding', () => {
  it('keeps the row and records why', async () => {
    const { service, prisma } = makeService();
    (prisma.letter.findFirst as Mock).mockResolvedValue({ id: 'l1', status: 'ISSUED' });
    await service.void(hr, 'l1', 'Superseded by a revised offer');
    expect(prisma.letter.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'VOID',
          voidReason: 'Superseded by a revised offer',
        }),
      }),
    );
  });

  it('refuses to void twice', async () => {
    const { service, prisma } = makeService();
    (prisma.letter.findFirst as Mock).mockResolvedValue({ id: 'l1', status: 'VOID' });
    await expect(service.void(hr, 'l1', 'again')).rejects.toBeInstanceOf(BadRequestException);
  });
});
