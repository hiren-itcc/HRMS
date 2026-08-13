import type { AccessTokenClaims } from '@hrms/types';
import { ProjectsService } from './projects.service';

type Mock = jest.Mock;

/**
 * The register: who may see a project, who may staff one, and what stops one
 * being deleted.
 *
 * The arithmetic and the sentences are `projects.rules.spec.ts` — pure and
 * exhaustive there. What is here is the wiring those rules hang off, and the
 * two places this module makes an access decision the guard cannot: the
 * ownership grant, and 404-not-403.
 */

const PROJECT = {
  id: 'p1',
  organizationId: 'org1',
  code: 'APOLLO',
  name: 'Apollo replatform',
  description: null,
  status: 'ACTIVE',
  startsOn: new Date('2026-01-01T00:00:00Z'),
  endsOn: null,
  managerId: 'e-maya',
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
  manager: { id: 'e-maya', firstName: 'Maya', lastName: 'Rao', employeeCode: 'EMP-0002' },
  members: [
    {
      id: 'm1',
      projectId: 'p1',
      employeeId: 'e-asha',
      role: 'Engineer',
      allocation: 60,
      joinedOn: new Date('2026-02-01T00:00:00Z'),
      leftOn: null,
      employee: { id: 'e-asha', firstName: 'Asha', lastName: 'Verma', employeeCode: 'EMP-0005' },
    },
  ],
  _count: { members: 1, entries: 0 },
};

function makeService(project: unknown = PROJECT) {
  // biome-ignore lint/suspicious/noExplicitAny: structural test double
  const prisma: any = {
    project: {
      findFirst: jest.fn().mockResolvedValue(project),
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
      create: jest.fn().mockResolvedValue(project),
      update: jest
        .fn()
        .mockImplementation(({ data }: { data: Record<string, unknown> }) =>
          Promise.resolve({ ...(project as object), ...data }),
        ),
      delete: jest.fn().mockResolvedValue({}),
    },
    projectMember: {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue(PROJECT.members[0]),
      update: jest.fn().mockResolvedValue(PROJECT.members[0]),
      delete: jest.fn().mockResolvedValue({}),
    },
    timesheetEntry: { count: jest.fn().mockResolvedValue(0), findMany: jest.fn() },
    employee: { findFirst: jest.fn().mockResolvedValue({ id: 'e-maya' }) },
    auditLog: { create: jest.fn().mockResolvedValue({}) },
    $transaction: jest.fn((ops: unknown[]) => Promise.all(ops as Promise<unknown>[])),
  };
  return { service: new ProjectsService(prisma), prisma };
}

/** HR: holds the register permission, is on nothing. */
const hr: AccessTokenClaims = {
  sub: 'u-hr',
  orgId: 'org1',
  roleCode: 'HR',
  perms: ['project.read', 'project.manage'],
  employeeId: 'e-hr',
};

/** The project's own manager, holding no register permission at all. */
const owner: AccessTokenClaims = {
  sub: 'u-maya',
  orgId: 'org1',
  roleCode: 'EMPLOYEE',
  perms: ['project.read.own'],
  employeeId: 'e-maya',
};

/** On the project, and nothing more. */
const member: AccessTokenClaims = {
  sub: 'u-asha',
  orgId: 'org1',
  roleCode: 'EMPLOYEE',
  perms: ['project.read.own'],
  employeeId: 'e-asha',
};

/** In the org, on nothing, holding nothing. */
const stranger: AccessTokenClaims = {
  sub: 'u-rohan',
  orgId: 'org1',
  roleCode: 'EMPLOYEE',
  perms: ['project.read.own'],
  employeeId: 'e-rohan',
};

describe('who may see a project', () => {
  it('lets a member read it', async () => {
    const { service } = makeService();
    await expect(service.get(member, 'p1')).resolves.toMatchObject({ code: 'APOLLO' });
  });

  it('lets its manager read it without any org-wide permission', async () => {
    const { service } = makeService();
    await expect(service.get(owner, 'p1')).resolves.toMatchObject({ code: 'APOLLO' });
  });

  /*
   * 404 rather than 403: whether a project exists is itself information about
   * what the company is working on, and the same rule every other module here
   * follows for an unreadable row.
   */
  it('tells somebody with no standing it does not exist, not that they may not look', async () => {
    const { service } = makeService();
    await expect(service.get(stranger, 'p1')).rejects.toThrow('Project not found');
  });

  it('404s a project in another organization before anything else runs', async () => {
    const { service, prisma } = makeService(null);
    await expect(service.get(hr, 'p1')).rejects.toThrow('Project not found');
    expect(prisma.project.delete).not.toHaveBeenCalled();
  });

  /* `'__none__'` rather than undefined: undefined would match every project. */
  it('matches nothing for a token with no employee record', async () => {
    const { service, prisma } = makeService();
    await service.list({ ...stranger, employeeId: undefined }, {
      page: 1,
      limit: 20,
      order: 'asc',
      scope: 'own',
      // biome-ignore lint/suspicious/noExplicitAny: partial query fixture
    } as any);
    const where = (prisma.project.findMany as Mock).mock.calls[0][0].where;
    expect(JSON.stringify(where)).toContain('__none__');
  });
});

describe('the ownership grant', () => {
  /*
   * The decision this module exists to record: a project's own manager may
   * staff it without `project.manage`. The alternative is every membership
   * change routing through HR, which is how a register stops matching reality.
   */
  it('lets the project manager add somebody without holding project.manage', async () => {
    const { service, prisma } = makeService();
    prisma.employee.findFirst.mockResolvedValue({ id: 'e-rohan' });

    await service.addMember(owner, 'p1', {
      employeeId: 'e-rohan',
      allocation: 50,
      joinedOn: '2026-08-10',
      role: null,
      leftOn: null,
    });

    expect(prisma.projectMember.create).toHaveBeenCalled();
  });

  it('refuses a member who neither runs the project nor holds the permission', async () => {
    const { service } = makeService();
    await expect(
      service.addMember(member, 'p1', {
        employeeId: 'e-rohan',
        allocation: 50,
        joinedOn: '2026-08-10',
        role: null,
        leftOn: null,
      }),
    ).rejects.toThrow('manager or HR');
  });

  /*
   * Deleting is a register-level act, not staffing, so the grant deliberately
   * does not extend to it — the owner is refused where HR would not be.
   */
  it('does not extend to deleting the project', async () => {
    const { service } = makeService();
    await expect(service.remove(owner, 'p1')).rejects.toThrow('Only HR can delete');
  });
});

describe('deleting a project', () => {
  it('goes through when nothing was logged against it', async () => {
    const { service, prisma } = makeService();
    await expect(service.remove(hr, 'p1')).resolves.toEqual({ id: 'p1' });
    expect(prisma.project.delete).toHaveBeenCalledWith({ where: { id: 'p1' } });
  });

  /*
   * The _count pre-flight is not decoration. TimesheetEntry.projectId is
   * RESTRICT, so without it the database refuses as a raw Prisma error and the
   * caller gets a 500 with no sentence in it.
   */
  it('refuses with a sentence naming the count, not a raw database error', async () => {
    const { service, prisma } = makeService({ ...PROJECT, _count: { members: 1, entries: 37 } });
    await expect(service.remove(hr, 'p1')).rejects.toThrow('37 timesheet entries have been logged');
    expect(prisma.project.delete).not.toHaveBeenCalled();
  });
});

describe('members', () => {
  it('refuses to add the same person twice', async () => {
    const { service, prisma } = makeService();
    prisma.employee.findFirst.mockResolvedValue({ id: 'e-asha' });
    prisma.projectMember.findFirst.mockResolvedValue({ id: 'm1' });

    await expect(
      service.addMember(hr, 'p1', {
        employeeId: 'e-asha',
        allocation: 60,
        joinedOn: '2026-08-10',
        role: null,
        leftOn: null,
      }),
    ).rejects.toThrow('already on this project');
  });

  it('refuses somebody from another organization', async () => {
    const { service, prisma } = makeService();
    prisma.employee.findFirst.mockResolvedValue(null);

    await expect(
      service.addMember(hr, 'p1', {
        employeeId: 'e-outsider',
        allocation: 60,
        joinedOn: '2026-08-10',
        role: null,
        leftOn: null,
      }),
    ).rejects.toThrow('not in this organization');
  });

  /*
   * Once there are hours the honest record is a leaving date: they were on the
   * project, and deleting the membership leaves those hours belonging to
   * somebody the register says was never there.
   */
  it('refuses to remove somebody who has logged hours, and says to set a leaving date', async () => {
    const { service, prisma } = makeService();
    prisma.projectMember.findFirst.mockResolvedValue({
      id: 'm1',
      projectId: 'p1',
      employeeId: 'e-asha',
      joinedOn: new Date('2026-02-01T00:00:00Z'),
      leftOn: null,
      project: { id: 'p1', managerId: 'e-maya' },
    });
    prisma.timesheetEntry.count.mockResolvedValue(4);

    await expect(service.removeMember(hr, 'm1')).rejects.toThrow('leaving date');
    expect(prisma.projectMember.delete).not.toHaveBeenCalled();
  });

  it('removes somebody who logged nothing', async () => {
    const { service, prisma } = makeService();
    prisma.projectMember.findFirst.mockResolvedValue({
      id: 'm1',
      projectId: 'p1',
      employeeId: 'e-asha',
      joinedOn: new Date('2026-02-01T00:00:00Z'),
      leftOn: null,
      project: { id: 'p1', managerId: 'e-maya' },
    });

    await expect(service.removeMember(hr, 'm1')).resolves.toEqual({ id: 'm1' });
    expect(prisma.projectMember.delete).toHaveBeenCalled();
  });
});

describe('creating and editing', () => {
  it('refuses a code another project already uses', async () => {
    const { service, prisma } = makeService();
    prisma.project.findFirst.mockResolvedValue({ id: 'other' });

    await expect(
      service.create(hr, {
        code: 'APOLLO',
        name: 'Apollo again',
        status: 'PLANNED',
        startsOn: '2026-08-10',
        description: null,
        endsOn: null,
        managerId: 'e-maya',
      }),
    ).rejects.toThrow('already uses the code APOLLO');
  });

  it('refuses an end date before the start', async () => {
    const { service } = makeService();
    await expect(
      service.create(hr, {
        code: 'ZEUS',
        name: 'Zeus',
        status: 'PLANNED',
        startsOn: '2026-08-10',
        endsOn: '2026-08-01',
        description: null,
        managerId: 'e-maya',
      }),
    ).rejects.toThrow('before the start date');
  });

  /*
   * The stored start is only half the comparison on a patch: sending an end
   * date alone has to be checked against the date already on the row, not
   * against nothing.
   */
  it('checks a patched end date against the stored start date', async () => {
    const { service } = makeService();
    await expect(service.update(hr, 'p1', { endsOn: '2025-06-01' })).rejects.toThrow(
      'before the start date',
    );
  });

  it('writes an audit row for every mutation', async () => {
    const { service, prisma } = makeService();
    await service.update(hr, 'p1', { name: 'Apollo, renamed' });
    expect(prisma.auditLog.create).toHaveBeenCalled();
  });
});
