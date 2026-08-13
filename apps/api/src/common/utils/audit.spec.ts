import type { PrismaService } from '../../database/prisma.service';
import { auditOrgMutation } from '../../modules/organization/services/audit.helper';
import { runWithRequestContext } from '../request-context';
import { auditMutation } from './audit';

/**
 * `AuditLog.ip` was NULL on every business mutation this system had written.
 *
 * The column is in the first migration and `audit.service.ts:114` returns it on
 * every row, so the trail has always claimed to record where a change came
 * from — and for sign-in events, which build their own insert, it did. Every
 * other row was blank: `auditMutation` had no `ip` in its `create`, and neither
 * did `auditOrgMutation`, which kept its own copy of the same insert.
 *
 * These tests pin both writers, because the second one is how the fix would
 * silently rot — an org mutation that goes through its own `create` will not
 * pick up anything added here.
 */

interface Captured {
  organizationId: string;
  actorId: string | null;
  action: string;
  entity: string;
  entityId: string;
  ip: string | null;
  meta?: unknown;
}

function makePrisma() {
  const rows: Captured[] = [];
  const prisma = {
    auditLog: {
      create: jest.fn(({ data }: { data: Captured }) => {
        rows.push(data);
        return Promise.resolve(data);
      }),
    },
  } as unknown as PrismaService;
  return { prisma, rows };
}

const CTX = { orgId: 'org1', userId: 'user1' };

describe('auditMutation', () => {
  it('records the address of the request it happened on', async () => {
    const { prisma, rows } = makePrisma();

    await runWithRequestContext({ ip: '203.0.113.7' }, () =>
      auditMutation(prisma, CTX, 'employee.update', 'Employee', 'e1'),
    );

    expect(rows[0]?.ip).toBe('203.0.113.7');
  });

  /*
   * The seeder, a CLI, the lifecycle tick outside a request. Null is the honest
   * answer — an invented address in an audit trail is worse than an absent one.
   */
  it('writes null when there is no request', async () => {
    const { prisma, rows } = makePrisma();

    await auditMutation(prisma, CTX, 'lifecycle.probation.confirm', 'Employee', 'e1');

    expect(rows[0]?.ip).toBeNull();
  });

  /* Ambient is a default, not a hijack: a caller that knows better still wins. */
  it('prefers an address the caller passed explicitly', async () => {
    const { prisma, rows } = makePrisma();

    await runWithRequestContext({ ip: '203.0.113.7' }, () =>
      auditMutation(prisma, { ...CTX, ip: '198.51.100.4' }, 'employee.update', 'Employee', 'e1'),
    );

    expect(rows[0]?.ip).toBe('198.51.100.4');
  });

  it('still records everything it recorded before', async () => {
    const { prisma, rows } = makePrisma();

    await auditMutation(prisma, CTX, 'employee.update', 'Employee', 'e1', { before: 1, after: 2 });

    expect(rows[0]).toMatchObject({
      organizationId: 'org1',
      actorId: 'user1',
      action: 'employee.update',
      entity: 'Employee',
      entityId: 'e1',
      meta: { before: 1, after: 2 },
    });
  });
});

describe('auditOrgMutation', () => {
  /*
   * The whole reason this helper now delegates. It used to build its own
   * `create`, so every department, designation, location, shift and holiday
   * change would have carried on writing NULL after the fix above.
   */
  it('records the address too, rather than keeping its own insert', async () => {
    const { prisma, rows } = makePrisma();

    await runWithRequestContext({ ip: '203.0.113.7' }, () =>
      auditOrgMutation(prisma, CTX, 'department.create', 'Department', 'd1'),
    );

    expect(rows[0]).toMatchObject({
      organizationId: 'org1',
      actorId: 'user1',
      action: 'department.create',
      entity: 'Department',
      entityId: 'd1',
      ip: '203.0.113.7',
    });
  });
});
