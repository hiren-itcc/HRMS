import type { ReportRangeQuery } from '@hrms/shared';
import type { AccessTokenClaims } from '@hrms/types';
import type { PrismaService } from '../../database/prisma.service';
import { settingsDouble } from '../settings/settings.test-double';
import { ReportsService } from './reports.service';

/**
 * The scope resolver is the only thing standing between a manager and the
 * whole org's payroll-adjacent data, so it gets tested at the query level:
 * we assert on the `where` Prisma is actually handed.
 */

const RANGE: ReportRangeQuery = { from: '2026-01-01', to: '2026-06-30', format: 'json' };

function claims(overrides: Partial<AccessTokenClaims> = {}): AccessTokenClaims {
  return {
    sub: 'user-1',
    orgId: 'org-1',
    employeeId: 'emp-1',
    roleCode: 'MANAGER',
    perms: ['report.view.team'],
    ...overrides,
  };
}

/** Captures the employee `where` and returns empty result sets. */
function makePrisma() {
  const captured: { employeeWhere?: Record<string, unknown> } = {};
  const prisma = {
    employee: {
      findMany: jest.fn(async ({ where }: { where: Record<string, unknown> }) => {
        captured.employeeWhere = where;
        return [];
      }),
    },
    organization: { findUniqueOrThrow: jest.fn(async () => ({ timezone: 'Asia/Kolkata' })) },
    holiday: { findMany: jest.fn(async () => []) },
    leaveRequest: { findMany: jest.fn(async () => []) },
    leaveBalance: { groupBy: jest.fn(async () => []) },
    leaveType: { findMany: jest.fn(async () => []) },
    attendanceRecord: { findMany: jest.fn(async () => []) },
    department: { findMany: jest.fn(async () => []) },
  } as unknown as PrismaService;
  return { prisma, captured };
}

describe('ReportsService scoping', () => {
  it('always constrains to the caller organisation', async () => {
    const { prisma, captured } = makePrisma();
    await new ReportsService(prisma, settingsDouble()).employees(claims(), RANGE);
    expect(captured.employeeWhere?.organizationId).toBe('org-1');
    expect(captured.employeeWhere?.deletedAt).toBeNull();
  });

  it('limits a manager to their direct reports', async () => {
    const { prisma, captured } = makePrisma();
    await new ReportsService(prisma, settingsDouble()).employees(claims(), RANGE);
    expect(captured.employeeWhere?.managerId).toBe('emp-1');
  });

  it('never runs unscoped when a manager has no employee record', async () => {
    const { prisma, captured } = makePrisma();
    await new ReportsService(prisma, settingsDouble()).employees(
      claims({ employeeId: undefined }),
      RANGE,
    );
    expect(captured.employeeWhere?.managerId).toBe('__none__');
  });

  it('leaves the scope open for an org-wide report.view holder', async () => {
    const { prisma, captured } = makePrisma();
    await new ReportsService(prisma, settingsDouble()).employees(
      claims({ perms: ['report.view'], roleCode: 'HR' }),
      RANGE,
    );
    expect(captured.employeeWhere).not.toHaveProperty('managerId');
  });

  it('keeps people who exited mid-range — attrition depends on them', async () => {
    const { prisma, captured } = makePrisma();
    await new ReportsService(prisma, settingsDouble()).employees(
      claims({ perms: ['report.view'] }),
      RANGE,
    );
    /*
     * The status filter must exclude ONBOARDING and nothing else. Excluding
     * EXITED here would erase exactly the people an attrition report exists
     * to show, which is what this test is really guarding.
     */
    expect(captured.employeeWhere?.status).toEqual({ not: 'ONBOARDING' });
    // The employment window must live under AND: a top-level OR would be
    // silently overwritten by any other OR added to the same object.
    expect(captured.employeeWhere?.AND).toEqual([
      { joinDate: { lte: new Date('2026-06-30T00:00:00.000Z') } },
      {
        OR: [{ exitDate: null }, { exitDate: { gte: new Date('2026-01-01T00:00:00.000Z') } }],
      },
    ]);
  });

  it('applies the department filter when one is chosen', async () => {
    const { prisma, captured } = makePrisma();
    await new ReportsService(prisma, settingsDouble()).employees(
      claims({ perms: ['report.view'] }),
      {
        ...RANGE,
        departmentId: 'dept-9',
      },
    );
    expect(captured.employeeWhere?.departmentId).toBe('dept-9');
  });
});

describe('ReportsService shape', () => {
  it('reports team scope in the metadata so the UI can say so', async () => {
    const { prisma } = makePrisma();
    const result = await new ReportsService(prisma, settingsDouble()).employees(claims(), RANGE);
    expect(result.meta.scope).toBe('team');
    expect(result.meta.from).toBe('2026-01-01');
  });

  it('returns columns and an empty row set rather than throwing on no data', async () => {
    const { prisma } = makePrisma();
    const result = await new ReportsService(prisma, settingsDouble()).attendance(claims(), RANGE);
    expect(result.rows).toEqual([]);
    expect(result.columns.length).toBeGreaterThan(0);
    expect(result.kpis.every((k) => Number.isFinite(k.value))).toBe(true);
  });
});
