import { OrgChartService } from './org-chart.service';

type Mock = jest.Mock;

const person = (id: string, managerId: string | null) => ({
  id,
  firstName: id.toUpperCase(),
  lastName: 'Person',
  employeeCode: `EMP-${id}`,
  managerId,
  avatarUrl: null,
  designation: { title: 'Engineer' },
  department: { name: 'Engineering' },
});

function makeService(rows: ReturnType<typeof person>[]) {
  const prisma = { employee: { findMany: jest.fn().mockResolvedValue(rows) } };
  // biome-ignore lint/suspicious/noExplicitAny: structural test double
  return { service: new OrgChartService(prisma as any), prisma };
}

describe('OrgChartService', () => {
  it('nests reports under their manager', async () => {
    const { service } = makeService([
      person('ceo', null),
      person('cto', 'ceo'),
      person('dev', 'cto'),
    ]);

    const { roots, total } = await service.get('org1');
    expect(total).toBe(3);
    expect(roots).toHaveLength(1);
    expect(roots[0]?.id).toBe('ceo');
    expect(roots[0]?.reports[0]?.id).toBe('cto');
    expect(roots[0]?.reports[0]?.reports[0]?.id).toBe('dev');
  });

  it('counts everybody below, not just direct reports', async () => {
    const { service } = makeService([
      person('ceo', null),
      person('cto', 'ceo'),
      person('dev1', 'cto'),
      person('dev2', 'cto'),
    ]);

    const { roots } = await service.get('org1');
    expect(roots[0]?.totalReports).toBe(3);
    expect(roots[0]?.reports[0]?.totalReports).toBe(2);
  });

  it('keeps somebody whose manager has left, as a root', async () => {
    // The manager is not in the result set — exited, or soft-deleted. Dropping
    // the report is how a department silently loses three people.
    const { service } = makeService([person('ceo', null), person('orphan', 'someone-who-left')]);

    const { roots } = await service.get('org1');
    expect(roots.map((r) => r.id).sort()).toEqual(['ceo', 'orphan']);
  });

  it('supports several roots — nobody has to be at the top', async () => {
    const { service } = makeService([person('a', null), person('b', null)]);
    const { roots } = await service.get('org1');
    expect(roots).toHaveLength(2);
  });

  it('excludes leavers and unstarted hires', async () => {
    const { service, prisma } = makeService([]);
    await service.get('org1');

    const { where } = (prisma.employee.findMany as Mock).mock.calls[0][0];
    expect(where.status).toEqual({ notIn: ['EXITED', 'ONBOARDING'] });
    expect(where.deletedAt).toBeNull();
  });

  it('never exposes anything beyond work contact facts', async () => {
    const { service, prisma } = makeService([]);
    await service.get('org1');

    const { select } = (prisma.employee.findMany as Mock).mock.calls[0][0];
    // A chart says who reports to whom. It is not a personnel record.
    for (const leaked of ['workEmail', 'phone', 'dateOfBirth', 'bankDetail', 'salaries']) {
      expect(select).not.toHaveProperty(leaked);
    }
  });

  it('terminates on a reporting cycle instead of hanging', async () => {
    // ensureNoManagerCycle refuses these on write, but "should never happen"
    // plus recursion is a hung request.
    const { service } = makeService([person('a', 'b'), person('b', 'a')]);

    const { roots } = await service.get('org1');
    // Both attach to each other, so neither is a root — the important part is
    // that this returned at all.
    expect(Array.isArray(roots)).toBe(true);
  });

  it('returns an empty chart for an organization with nobody in it', async () => {
    const { service } = makeService([]);
    await expect(service.get('org1')).resolves.toEqual({ roots: [], total: 0 });
  });
});
