import { AssetClearanceService } from './asset-clearance.service';

interface Over {
  task?: object | null;
  outstanding?: number;
}

function makeService(over: Over = {}) {
  // biome-ignore lint/suspicious/noExplicitAny: structural test double
  const prisma: any = {
    offboardingTask: {
      findFirst: jest
        .fn()
        .mockResolvedValue(over.task === undefined ? { id: 't1', status: 'PENDING' } : over.task),
      update: jest.fn(),
    },
    assetAssignment: { count: jest.fn().mockResolvedValue(over.outstanding ?? 0) },
  };
  return { service: new AssetClearanceService(prisma), prisma };
}

describe('AssetClearanceService', () => {
  /* The common case by far, and it must not cost a write. */
  it('does nothing for somebody who is not leaving', async () => {
    const { service, prisma } = makeService({ task: null });
    await service.sync('org1', 'e1');

    expect(prisma.assetAssignment.count).not.toHaveBeenCalled();
    expect(prisma.offboardingTask.update).not.toHaveBeenCalled();
  });

  it('only ever looks at the asset item of an exit still in progress', async () => {
    const { service, prisma } = makeService();
    await service.sync('org1', 'e1');

    expect(prisma.offboardingTask.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          kind: 'ASSET_RETURN',
          offboarding: { employeeId: 'e1', organizationId: 'org1', status: 'IN_PROGRESS' },
        }),
      }),
    );
  });

  /*
   * The case that stops a leaver who was never issued anything from being
   * blocked forever by an item nobody can settle.
   */
  it('settles the item when they are holding nothing', async () => {
    const { service, prisma } = makeService({ outstanding: 0 });
    await service.sync('org1', 'e1');

    expect(prisma.offboardingTask.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 't1' },
        data: expect.objectContaining({ status: 'DONE' }),
      }),
    );
  });

  it('reopens it the moment something is outstanding again', async () => {
    const { service, prisma } = makeService({ task: { id: 't1', status: 'DONE' }, outstanding: 1 });
    await service.sync('org1', 'e1');

    expect(prisma.offboardingTask.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'PENDING' }) }),
    );
  });

  /*
   * Cleared by nobody at no time is what PENDING means. Leaving the stamps
   * behind would make a reopened item look signed off by whoever last handed
   * something back.
   */
  it('clears the sign-off stamps when it reopens', async () => {
    const { service, prisma } = makeService({ task: { id: 't1', status: 'DONE' }, outstanding: 2 });
    await service.sync('org1', 'e1');

    const { data } = prisma.offboardingTask.update.mock.calls[0][0];
    expect(data.doneAt).toBeNull();
    expect(data.doneById).toBeNull();
  });

  /*
   * The waiver wins. "They posted it back, write it off" is a decision somebody
   * made with a reason attached, and a register that silently overturned it
   * would be worse than a register that is behind.
   */
  it('never overturns an item waived by hand', async () => {
    const { service, prisma } = makeService({
      task: { id: 't1', status: 'NOT_APPLICABLE' },
      outstanding: 3,
    });
    await service.sync('org1', 'e1');

    expect(prisma.offboardingTask.update).not.toHaveBeenCalled();
  });

  it('writes nothing when the item is already right', async () => {
    const { service, prisma } = makeService({
      task: { id: 't1', status: 'PENDING' },
      outstanding: 1,
    });
    await service.sync('org1', 'e1');

    expect(prisma.offboardingTask.update).not.toHaveBeenCalled();
  });

  it('counts only what has not come back', async () => {
    const { service, prisma } = makeService({ outstanding: 2 });
    await service.outstandingCount('org1', 'e1');

    expect(prisma.assetAssignment.count).toHaveBeenCalledWith({
      where: { employeeId: 'e1', returnedOn: null, asset: { organizationId: 'org1' } },
    });
  });
});
