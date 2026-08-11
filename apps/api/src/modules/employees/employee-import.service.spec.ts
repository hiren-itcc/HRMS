import type { AccessTokenClaims } from '@hrms/types';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { EmployeeImportService } from './employee-import.service';

type Mock = jest.Mock;

const claims = {
  sub: 'u1',
  orgId: 'org1',
  employeeId: 'e1',
  roleCode: 'HR',
  perms: ['employee.import'],
  mustChangePassword: false,
} as AccessTokenClaims;

const HEADERS =
  'Employee code,First name,Last name,Work email,Personal email,Phone,Date of birth,Gender,Join date,Department,Designation,Location,Shift,Employment type,Manager';

const row = (over: Partial<Record<string, string>> = {}) => {
  const values = {
    code: '',
    first: 'Asha',
    last: 'Verma',
    work: 'asha.new@acme.test',
    personal: 'asha@personal.test',
    phone: '',
    dob: '',
    gender: '',
    join: '2026-01-05',
    department: 'Engineering',
    designation: 'Engineer',
    location: 'Bengaluru',
    shift: 'General',
    type: 'Full time',
    manager: '',
    ...over,
  };
  return [
    values.code,
    values.first,
    values.last,
    values.work,
    values.personal,
    values.phone,
    values.dob,
    values.gender,
    values.join,
    values.department,
    values.designation,
    values.location,
    values.shift,
    values.type,
    values.manager,
  ].join(',');
};

const file = (...rows: string[]) => ({
  originalname: 'people.csv',
  buffer: Buffer.from([HEADERS, ...rows].join('\r\n'), 'utf8'),
});

function makeService() {
  const prisma = {
    department: { findMany: jest.fn().mockResolvedValue([{ id: 'd1', name: 'Engineering' }]) },
    designation: { findMany: jest.fn().mockResolvedValue([{ id: 'g1', title: 'Engineer' }]) },
    location: { findMany: jest.fn().mockResolvedValue([{ id: 'l1', name: 'Bengaluru' }]) },
    shift: { findMany: jest.fn().mockResolvedValue([{ id: 's1', name: 'General' }]) },
    employmentType: { findMany: jest.fn().mockResolvedValue([{ id: 't1', name: 'Full time' }]) },
    employee: {
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn(),
      update: jest.fn(),
    },
    employeeImport: {
      create: jest.fn().mockImplementation(({ data }) => ({ id: 'imp1', ...data })),
      findFirst: jest.fn(),
      update: jest
        .fn()
        .mockImplementation(({ data }) => ({ id: 'imp1', invitedCount: 0, ...data })),
    },
    auditLog: { create: jest.fn() },
  };
  const employees = {
    create: jest.fn().mockImplementation(async () => ({ id: 'new1', employeeCode: 'EMP900' })),
  };
  const onboarding = {
    onboard: jest
      .fn()
      .mockImplementation(async () => ({ employee: { id: 'new2', employeeCode: 'EMP901' } })),
  };
  const service = new EmployeeImportService(
    // biome-ignore lint/suspicious/noExplicitAny: structural test doubles
    prisma as any,
    // biome-ignore lint/suspicious/noExplicitAny: structural test doubles
    employees as any,
    // biome-ignore lint/suspicious/noExplicitAny: structural test doubles
    onboarding as any,
  );
  return { service, prisma, employees, onboarding };
}

/** A committed import whose rows were all clean. */
const staged = (rows: unknown[], mode = 'RECORDS') => ({
  id: 'imp1',
  organizationId: 'org1',
  mode,
  status: 'PREVIEW',
  rows,
});

describe('preview', () => {
  it('writes no employee at all — that is the whole point of a dry run', async () => {
    const { service, prisma, employees, onboarding } = makeService();
    await service.preview(claims, file(row()), 'RECORDS');

    expect(prisma.employee.create).not.toHaveBeenCalled();
    expect(employees.create).not.toHaveBeenCalled();
    expect(onboarding.onboard).not.toHaveBeenCalled();
  });

  it('accepts a clean row', async () => {
    const { service } = makeService();
    const preview = await service.preview(claims, file(row()), 'RECORDS');
    expect(preview.readyCount).toBe(1);
    expect(preview.errorCount).toBe(0);
  });

  /* A missing column is a file-level refusal, not a thousand identical row
     errors — the second is not a more useful answer than the first. */
  it('refuses a file with a required column missing, without parsing rows', async () => {
    const { service } = makeService();
    const preview = await service.preview(
      claims,
      { originalname: 'x.csv', buffer: Buffer.from('First name,Last name\nA,B', 'utf8') },
      'RECORDS',
    );
    expect(preview.fatal[0]).toMatch(/columns are missing/);
    expect(preview.rows).toHaveLength(0);
  });

  it('reports an unknown department against the row, and suggests the near miss', async () => {
    const { service } = makeService();
    const preview = await service.preview(
      claims,
      file(row({ department: 'Enginering' })),
      'RECORDS',
    );
    expect(preview.errorCount).toBe(1);
    expect(preview.rows[0]?.problems[0]?.message).toMatch(/Did you mean/);
  });

  /* An invite has nowhere to go without a personal address — the work one is
     for somebody who has not started. */
  it('requires a personal email in INVITE mode and not in RECORDS mode', async () => {
    const { service } = makeService();
    const blank = row({ personal: '' });
    expect((await service.preview(claims, file(blank), 'RECORDS')).errorCount).toBe(0);
    expect((await service.preview(claims, file(blank), 'INVITE')).errorCount).toBe(1);
  });

  it('refuses a file past the row cap rather than holding a request open for minutes', async () => {
    const { service } = makeService();
    const many = Array.from({ length: 501 }, (_, i) => row({ work: `p${i}@acme.test` }));
    const preview = await service.preview(claims, file(...many), 'RECORDS');
    expect(preview.fatal[0]).toMatch(/limit is 500/);
  });
});

describe('commit', () => {
  /*
   * The regression test for the rule this feature exists under: creation goes
   * through the services that already exist, and never writes the table itself.
   * A second creation path would be a second copy of employee-code generation,
   * the login decision and the invite — and one of the copies would drift.
   */
  it('creates through EmployeesService in RECORDS mode, never prisma directly', async () => {
    const { service, prisma, employees, onboarding } = makeService();
    (prisma.employeeImport.findFirst as Mock).mockResolvedValue(
      staged([{ row: 2, values: {}, resolved: { workEmail: 'a@b.c' }, problems: [] }]),
    );

    await service.commit(claims, 'imp1', { sendInvites: false });

    expect(employees.create).toHaveBeenCalledTimes(1);
    expect(prisma.employee.create).not.toHaveBeenCalled();
    expect(onboarding.onboard).not.toHaveBeenCalled();
    // No login for a backfill — the deliberate third creation path.
    expect((employees.create as Mock).mock.calls[0][1]).toMatchObject({ createLogin: false });
  });

  it('creates through OnboardingService when actually inviting', async () => {
    const { service, prisma, employees, onboarding } = makeService();
    (prisma.employeeImport.findFirst as Mock).mockResolvedValue(
      staged([{ row: 2, values: {}, resolved: { workEmail: 'a@b.c' }, problems: [] }], 'INVITE'),
    );

    await service.commit(claims, 'imp1', { sendInvites: true });

    expect(onboarding.onboard).toHaveBeenCalledTimes(1);
    expect(employees.create).not.toHaveBeenCalled();
  });

  /*
   * `nextCode()` inside onboard has no collision retry, so concurrent creation
   * produces duplicate employee codes. Asserted by observing that no second
   * create begins before the first resolves.
   */
  it('creates strictly one at a time', async () => {
    const { service, prisma, employees } = makeService();
    let inFlight = 0;
    let overlapped = false;
    (employees.create as Mock).mockImplementation(async () => {
      inFlight += 1;
      if (inFlight > 1) overlapped = true;
      await new Promise((resolve) => setTimeout(resolve, 1));
      inFlight -= 1;
      return { id: 'x', employeeCode: 'EMP1' };
    });
    (prisma.employeeImport.findFirst as Mock).mockResolvedValue(
      staged(
        Array.from({ length: 5 }, (_, i) => ({
          row: i + 2,
          values: {},
          resolved: { workEmail: `p${i}@b.c` },
          problems: [],
        })),
      ),
    );

    await service.commit(claims, 'imp1', { sendInvites: false });

    expect(overlapped).toBe(false);
    expect(employees.create).toHaveBeenCalledTimes(5);
  });

  /* Per-row commit is only defensible because nothing with problems can reach
     it, so this is the guard that makes the whole design honest. */
  it('refuses to commit while any row still has a problem', async () => {
    const { service, prisma, employees } = makeService();
    (prisma.employeeImport.findFirst as Mock).mockResolvedValue(
      staged([
        { row: 2, values: {}, resolved: {}, problems: [{ column: 'Department', message: 'nope' }] },
      ]),
    );

    await expect(service.commit(claims, 'imp1', { sendInvites: false })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(employees.create).not.toHaveBeenCalled();
  });

  it('refuses a second commit rather than duplicating everybody', async () => {
    const { service, prisma } = makeService();
    (prisma.employeeImport.findFirst as Mock).mockResolvedValue({
      ...staged([]),
      status: 'COMMITTED',
    });
    await expect(service.commit(claims, 'imp1', { sendInvites: false })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  /* There is no undo for a sent email, so the cap is a refusal rather than a
     warning. */
  it('refuses to email more people than the invite cap', async () => {
    const { service, prisma } = makeService();
    (prisma.employeeImport.findFirst as Mock).mockResolvedValue(
      staged(
        Array.from({ length: 51 }, (_, i) => ({
          row: i + 2,
          values: {},
          resolved: { workEmail: `p${i}@b.c` },
          problems: [],
        })),
        'INVITE',
      ),
    );
    await expect(service.commit(claims, 'imp1', { sendInvites: true })).rejects.toThrow(/no undo/i);
  });

  it('reports a partial run honestly rather than as success', async () => {
    const { service, prisma, employees } = makeService();
    (employees.create as Mock)
      .mockResolvedValueOnce({ id: 'a', employeeCode: 'E1' })
      .mockRejectedValueOnce(new Error('Work email already exists'));
    (prisma.employeeImport.findFirst as Mock).mockResolvedValue(
      staged([
        { row: 2, values: {}, resolved: { workEmail: 'a@b.c' }, problems: [] },
        { row: 3, values: {}, resolved: { workEmail: 'b@b.c' }, problems: [] },
      ]),
    );

    const result = await service.commit(claims, 'imp1', { sendInvites: false });

    expect(result.status).toBe('PARTIAL');
    expect(result.createdCount).toBe(1);
    expect(result.failedCount).toBe(1);
    expect(result.rows[1]?.message).toMatch(/already exists/);
  });

  /* The staged rows held dates of birth and personal addresses. Keeping them
     after the import would be a second copy of everybody's personal data with
     no retention story of its own. */
  it('prunes the stored rows to outcomes when it finishes', async () => {
    const { service, prisma } = makeService();
    (prisma.employeeImport.findFirst as Mock).mockResolvedValue(
      staged([
        {
          row: 2,
          values: { 'date of birth': '1990-01-01' },
          resolved: { workEmail: 'a@b.c', dateOfBirth: '1990-01-01' },
          problems: [],
        },
      ]),
    );

    await service.commit(claims, 'imp1', { sendInvites: false });

    const written = JSON.stringify(
      (prisma.employeeImport.update as Mock).mock.calls[0][0].data.rows,
    );
    expect(written).not.toContain('1990-01-01');
    expect(written).toContain('CREATED');
  });

  /* Importing an organisation top-down puts managers below their reports, so
     the second pass is what makes an ordinary file work at all. */
  it('links a manager who appeared later in the file, on a second pass', async () => {
    const { service, prisma, employees } = makeService();
    (employees.create as Mock)
      .mockResolvedValueOnce({ id: 'report1', employeeCode: 'E1' })
      .mockResolvedValueOnce({ id: 'boss1', employeeCode: 'E2' });
    (prisma.employeeImport.findFirst as Mock).mockResolvedValue(
      staged([
        {
          row: 2,
          values: {},
          resolved: { workEmail: 'report@b.c' },
          problems: [],
          managerDeferred: true,
          managerRef: 'boss@b.c',
        },
        { row: 3, values: {}, resolved: { workEmail: 'boss@b.c' }, problems: [], managerRef: '' },
      ]),
    );

    await service.commit(claims, 'imp1', { sendInvites: false });

    expect(prisma.employee.update).toHaveBeenCalledWith({
      where: { id: 'report1' },
      data: { managerId: 'boss1' },
    });
  });

  it('404s for an import belonging to another organization', async () => {
    const { service, prisma } = makeService();
    (prisma.employeeImport.findFirst as Mock).mockResolvedValue(null);
    await expect(service.commit(claims, 'imp9', { sendInvites: false })).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
