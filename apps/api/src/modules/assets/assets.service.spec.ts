import type { AccessTokenClaims } from '@hrms/types';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { AssetsService } from './assets.service';

const asset = {
  id: 'a1',
  organizationId: 'org1',
  categoryId: 'c1',
  assetTag: 'MAC-0042',
  name: 'MacBook Pro 14',
  status: 'IN_STOCK' as string,
  condition: 'GOOD' as string,
};

const employee = {
  id: 'e1',
  firstName: 'Ada',
  lastName: 'Lovelace',
  status: 'ACTIVE' as string,
};

const openAssignment = {
  id: 'as1',
  assetId: 'a1',
  employeeId: 'e1',
  issuedOn: new Date('2026-08-01'),
  conditionOut: 'GOOD' as string,
  notes: 'Charger included' as string | null,
  returnedOn: null as Date | null,
};

interface Over {
  asset?: object;
  employee?: object | null;
  open?: object | null;
  history?: number;
  categoryCount?: number;
}

function makeService(over: Over = {}) {
  // biome-ignore lint/suspicious/noExplicitAny: structural test double
  const prisma: any = {
    asset: {
      findFirst: jest.fn().mockResolvedValue({ ...asset, ...over.asset }),
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
      create: jest.fn().mockResolvedValue({ ...asset, ...over.asset }),
      update: jest.fn().mockResolvedValue({ ...asset, ...over.asset }),
      delete: jest.fn().mockResolvedValue({ id: 'a1' }),
    },
    assetCategory: { count: jest.fn().mockResolvedValue(over.categoryCount ?? 1) },
    assetAssignment: {
      findFirst: jest.fn().mockResolvedValue(over.open === undefined ? openAssignment : over.open),
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(over.history ?? 0),
      create: jest.fn(),
      update: jest.fn(),
    },
    employee: {
      findFirst: jest
        .fn()
        .mockResolvedValue(over.employee === undefined ? employee : over.employee),
    },
    auditLog: { create: jest.fn() },
    $transaction: jest.fn((arg: unknown) =>
      typeof arg === 'function'
        ? (arg as (tx: unknown) => Promise<unknown>)(prisma)
        : Promise.all(arg as Promise<unknown>[]),
    ),
  };
  const clearance = { sync: jest.fn(), outstandingCount: jest.fn().mockResolvedValue(0) };
  const service = new AssetsService(
    prisma,
    // biome-ignore lint/suspicious/noExplicitAny: structural test double
    clearance as any,
    // biome-ignore lint/suspicious/noExplicitAny: structural test double
    { forEntity: jest.fn().mockResolvedValue([]) } as any,
  );
  return { service, prisma, clearance };
}

const it_admin: AccessTokenClaims = {
  sub: 'u-it',
  orgId: 'org1',
  roleCode: 'HR',
  perms: ['asset.manage', 'asset.assign'],
  employeeId: 'e-it',
};

describe('issuing', () => {
  it('records who has it and moves the asset out of stock', async () => {
    const { service, prisma } = makeService();
    await service.issue(it_admin, 'a1', {
      employeeId: 'e1',
      issuedOn: '2026-08-05',
      conditionOut: 'GOOD',
    });

    expect(prisma.assetAssignment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ assetId: 'a1', employeeId: 'e1', conditionOut: 'GOOD' }),
      }),
    );
    expect(prisma.asset.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'ASSIGNED' }) }),
    );
  });

  it('refuses one that is already out, and says so', async () => {
    const { service } = makeService({ asset: { status: 'ASSIGNED' } });
    await expect(
      service.issue(it_admin, 'a1', {
        employeeId: 'e2',
        issuedOn: '2026-08-05',
        conditionOut: 'GOOD',
      }),
    ).rejects.toThrow(/already issued/);
  });

  it('refuses one in repair rather than silently taking it out', async () => {
    const { service } = makeService({ asset: { status: 'IN_REPAIR' } });
    await expect(
      service.issue(it_admin, 'a1', {
        employeeId: 'e1',
        issuedOn: '2026-08-05',
        conditionOut: 'GOOD',
      }),
    ).rejects.toThrow(/in repair/);
  });

  /*
   * The one data-entry slip that creates an asset nobody will ever chase — the
   * person it is charged to has already gone.
   */
  it('will not issue anything to somebody who has left', async () => {
    const { service } = makeService({ employee: { ...employee, status: 'EXITED' } });
    await expect(
      service.issue(it_admin, 'a1', {
        employeeId: 'e1',
        issuedOn: '2026-08-05',
        conditionOut: 'GOOD',
      }),
    ).rejects.toThrow(/already left/);
  });

  /* A leaver handed something new has it outstanding again. */
  it('re-checks their exit clearance', async () => {
    const { service, clearance } = makeService();
    await service.issue(it_admin, 'a1', {
      employeeId: 'e1',
      issuedOn: '2026-08-05',
      conditionOut: 'GOOD',
    });
    expect(clearance.sync).toHaveBeenCalledWith('org1', 'e1');
  });
});

describe('returning', () => {
  it('closes the assignment and puts it back in stock', async () => {
    const { service, prisma } = makeService({ asset: { status: 'ASSIGNED' } });
    await service.return(it_admin, 'a1', { returnedOn: '2026-09-30', conditionIn: 'FAIR' });

    expect(prisma.assetAssignment.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'as1' },
        data: expect.objectContaining({ conditionIn: 'FAIR' }),
      }),
    );
    expect(prisma.asset.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'IN_STOCK' }) }),
    );
  });

  /* "It came back scratched" is a fact on the record, not an argument later. */
  it('carries the condition it came back in onto the asset', async () => {
    const { service, prisma } = makeService({ asset: { status: 'ASSIGNED' } });
    await service.return(it_admin, 'a1', { returnedOn: '2026-09-30', conditionIn: 'DAMAGED' });

    expect(prisma.asset.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ condition: 'DAMAGED' }) }),
    );
  });

  /* Keeps the note written on the way out — it is what the note coming back
     is being compared against. */
  it('appends to the issue note rather than replacing it', async () => {
    const { service, prisma } = makeService({ asset: { status: 'ASSIGNED' } });
    await service.return(it_admin, 'a1', {
      returnedOn: '2026-09-30',
      conditionIn: 'GOOD',
      notes: 'Charger missing',
    });

    expect(prisma.assetAssignment.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ notes: 'Charger included · Charger missing' }),
      }),
    );
  });

  it('refuses a return dated before it went out', async () => {
    const { service } = makeService({ asset: { status: 'ASSIGNED' } });
    await expect(
      service.return(it_admin, 'a1', { returnedOn: '2026-07-01', conditionIn: 'GOOD' }),
    ).rejects.toThrow(/before it went out/);
  });

  it('refuses to take back something nobody is holding', async () => {
    const { service } = makeService();
    await expect(
      service.return(it_admin, 'a1', { returnedOn: '2026-09-30', conditionIn: 'GOOD' }),
    ).rejects.toThrow(/Nobody is holding/);
  });

  it('settles their exit clearance', async () => {
    const { service, clearance } = makeService({ asset: { status: 'ASSIGNED' } });
    await service.return(it_admin, 'a1', { returnedOn: '2026-09-30', conditionIn: 'GOOD' });
    expect(clearance.sync).toHaveBeenCalledWith('org1', 'e1');
  });
});

describe('status changes', () => {
  /*
   * The asymmetry. "It is gone" is exactly the case where it cannot be handed
   * back first, so writing one off closes the assignment rather than refusing.
   */
  it('writes off a lost asset that somebody still holds, closing their assignment', async () => {
    const { service, prisma, clearance } = makeService({ asset: { status: 'ASSIGNED' } });
    await service.setStatus(it_admin, 'a1', { status: 'LOST', reason: 'Left on a train' });

    expect(prisma.assetAssignment.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ notes: 'Charger included · Written off: Left on a train' }),
      }),
    );
    expect(prisma.asset.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'LOST' } }),
    );
    expect(clearance.sync).toHaveBeenCalledWith('org1', 'e1');
  });

  /* Both mean the company has it back, and the company does not. */
  it("refuses to retire something out of somebody's bag", async () => {
    const { service } = makeService({ asset: { status: 'ASSIGNED' } });
    await expect(
      service.setStatus(it_admin, 'a1', { status: 'RETIRED', reason: 'End of life' }),
    ).rejects.toThrow(/take it back/);
  });

  it('leaves the clearance alone for an asset nobody was holding', async () => {
    const { service, clearance } = makeService();
    await service.setStatus(it_admin, 'a1', { status: 'IN_REPAIR', reason: 'Screen flickers' });
    expect(clearance.sync).not.toHaveBeenCalled();
  });
});

describe('the register', () => {
  it('refuses a duplicate asset tag', async () => {
    const { service, prisma } = makeService();
    prisma.asset.create.mockRejectedValue({ code: 'P2002' });
    await expect(
      service.create(it_admin, {
        categoryId: 'c1',
        assetTag: 'MAC-0042',
        name: 'x',
        condition: 'GOOD',
      }),
    ).rejects.toThrow(ConflictException);
  });

  it('refuses an asset filed under a category from another organization', async () => {
    const { service } = makeService({ categoryCount: 0 });
    await expect(
      service.create(it_admin, {
        categoryId: 'nope',
        assetTag: 'X-1',
        name: 'x',
        condition: 'GOOD',
      }),
    ).rejects.toThrow(NotFoundException);
  });

  /*
   * Deleting a row somebody has held erases the answer to "who had this in
   * March", which is the question a register exists to answer.
   */
  it('will not delete one that has been issued before', async () => {
    const { service } = makeService({ history: 2 });
    await expect(service.remove(it_admin, 'a1')).rejects.toThrow(/Retire it instead/);
  });

  it('deletes one nobody has ever held', async () => {
    const { service, prisma } = makeService({ history: 0 });
    await service.remove(it_admin, 'a1');
    expect(prisma.asset.delete).toHaveBeenCalledWith({ where: { id: 'a1' } });
  });

  /* Status is not in the edit schema, and must not slip through anyway. */
  it('does not let a general edit move the status', async () => {
    const { service, prisma } = makeService();
    await service.update(it_admin, 'a1', { name: 'MacBook Pro 16' });

    const data = prisma.asset.update.mock.calls[0][0].data;
    expect(data).not.toHaveProperty('status');
  });

  it('searches the three things somebody reads off a sticker', async () => {
    const { service, prisma } = makeService();
    await service.list(it_admin, { page: 1, limit: 20, order: 'asc', search: 'SN-4471' });

    const or = prisma.asset.findMany.mock.calls[0][0].where.OR;
    expect(or.map((c: Record<string, unknown>) => Object.keys(c)[0])).toEqual([
      'assetTag',
      'serialNumber',
      'name',
    ]);
  });

  it('scopes every read to the caller organization', async () => {
    const { service, prisma } = makeService();
    await service.list(it_admin, { page: 1, limit: 20, order: 'asc' });
    expect(prisma.asset.findMany.mock.calls[0][0].where.organizationId).toBe('org1');
  });
});
