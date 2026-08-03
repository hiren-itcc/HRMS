import type { AccessTokenClaims } from '@hrms/types';
import { NotFoundException } from '@nestjs/common';
import { DirectoryService } from './directory.service';

type Mock = jest.Mock;

/** Every column the Employee table carries that must never reach a colleague. */
const SENSITIVE_FIELDS = [
  'dateOfBirth',
  'personalEmail',
  'addressLine',
  'city',
  'country',
  'gender',
  'bankDetail',
  'salaries',
  'payslips',
  'user',
  'exitDate',
];

function makeService() {
  const prisma = {
    $transaction: jest.fn(async (ops: Promise<unknown>[]) => Promise.all(ops)),
    employee: {
      findMany: jest.fn(async () => []),
      count: jest.fn(async () => 0),
      findFirst: jest.fn(async () => null),
    },
  };
  // biome-ignore lint/suspicious/noExplicitAny: structural test double
  return { service: new DirectoryService(prisma as any), prisma };
}

const claims = (over: Partial<AccessTokenClaims> = {}): AccessTokenClaims => ({
  sub: 'u1',
  orgId: 'org1',
  employeeId: 'e1',
  roleCode: 'EMPLOYEE',
  perms: ['directory.read'],
  ...over,
});

const query = { page: 1, limit: 20, order: 'asc' as const };

describe('DirectoryService.list', () => {
  it('asks for a whitelist of columns, never a whole row', async () => {
    const { service, prisma } = makeService();
    await service.list(claims(), query);

    const args = (prisma.employee.findMany as Mock).mock.calls[0][0];
    // A `select` is the guarantee: with `include`, a column added to Employee
    // tomorrow would be published to the whole company without a code change.
    expect(args.select).toBeDefined();
    expect(args.include).toBeUndefined();
    for (const field of SENSITIVE_FIELDS) {
      expect(args.select[field]).toBeUndefined();
    }
  });

  it('lists only current colleagues of the caller organization', async () => {
    const { service, prisma } = makeService();
    await service.list(claims(), query);

    const { where } = (prisma.employee.findMany as Mock).mock.calls[0][0];
    expect(where.organizationId).toBe('org1');
    expect(where.deletedAt).toBeNull();
    // Leavers and not-yet-arrived alike: an invited hire who has not accepted
    // must not be able to read every colleague's work email.
    expect(where.status).toEqual({ notIn: ['EXITED', 'ONBOARDING'] });
  });

  it('does not scope to the caller — a directory is the whole company', async () => {
    const { service, prisma } = makeService();
    await service.list(claims(), query);

    const { where } = (prisma.employee.findMany as Mock).mock.calls[0][0];
    expect(where.managerId).toBeUndefined();
    expect(where.id).toBeUndefined();
  });

  it('passes department and location filters through', async () => {
    const { service, prisma } = makeService();
    await service.list(claims(), { ...query, departmentId: 'd1', locationId: 'l1' });

    const { where } = (prisma.employee.findMany as Mock).mock.calls[0][0];
    expect(where.departmentId).toBe('d1');
    expect(where.locationId).toBe('l1');
  });
});

describe('DirectoryService.profile', () => {
  it('returns work contact details and nothing sensitive', async () => {
    const { service, prisma } = makeService();
    (prisma.employee.findFirst as Mock).mockResolvedValue({
      id: 'e2',
      employeeCode: 'EMP-0002',
      firstName: 'Vaibhavi',
      lastName: 'Shah',
      workEmail: 'vaibhavi@hrms.local',
      phone: '+91 90000 00000',
      avatarUrl: null,
      department: { name: 'People' },
      designation: { title: 'HR Manager' },
      location: { name: 'Ahmedabad' },
      manager: null,
    });

    const profile = await service.profile(claims(), 'e2');
    expect(profile.workEmail).toBe('vaibhavi@hrms.local');
    const args = (prisma.employee.findFirst as Mock).mock.calls[0][0];
    expect(args.select).toBeDefined();
    expect(args.include).toBeUndefined();
    for (const field of SENSITIVE_FIELDS) {
      expect(args.select[field]).toBeUndefined();
    }
  });

  it('treats another tenant’s employee as missing', async () => {
    const { service, prisma } = makeService();
    await expect(service.profile(claims(), 'someone-else')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    const { where } = (prisma.employee.findFirst as Mock).mock.calls[0][0];
    expect(where.organizationId).toBe('org1');
  });

  it('does not list someone who has left', async () => {
    const { service, prisma } = makeService();
    await expect(service.profile(claims(), 'gone')).rejects.toBeInstanceOf(NotFoundException);
    const { where } = (prisma.employee.findFirst as Mock).mock.calls[0][0];
    // Leavers and not-yet-arrived alike: an invited hire who has not accepted
    // must not be able to read every colleague's work email.
    expect(where.status).toEqual({ notIn: ['EXITED', 'ONBOARDING'] });
    expect(where.deletedAt).toBeNull();
  });
});
