import { NotFoundException } from '@nestjs/common';
import { TdsChallansService } from './tds-challans.service';

const claims = { orgId: 'org-1', sub: 'user-1' } as never;

function makePrisma() {
  return {
    tdsChallan: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    auditLog: { create: jest.fn() },
  };
}

const input = {
  period: '2026-07',
  bsrCode: '0510308',
  challanSerial: '00123',
  depositDate: '2026-08-07',
  sectionCode: '92B',
  minorHead: '200',
  tds: 12_500,
  surcharge: 0,
  educationCess: 0,
  interest: 0,
  fee: 0,
  penalty: 0,
  others: 0,
};

describe('TdsChallansService', () => {
  it('scopes every read to the caller organization', async () => {
    const prisma = makePrisma();
    prisma.tdsChallan.findMany.mockResolvedValue([]);
    const service = new TdsChallansService(prisma as never);

    await service.list(claims);

    expect(prisma.tdsChallan.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ organizationId: 'org-1' }) }),
    );
  });

  it('filters to the months of a financial year when one is given', async () => {
    const prisma = makePrisma();
    prisma.tdsChallan.findMany.mockResolvedValue([]);
    const service = new TdsChallansService(prisma as never);

    await service.list(claims, '2026-27');

    const where = prisma.tdsChallan.findMany.mock.calls[0][0].where;
    expect(where.period).toEqual({ in: expect.arrayContaining(['2026-04', '2027-03']) });
  });

  it('returns money as a number, not a Decimal string', async () => {
    // Prisma serialises Decimal to a string and the web types say number. This
    // is the bug recruitment shipped; every module converts its own.
    const prisma = makePrisma();
    prisma.tdsChallan.create.mockResolvedValue({ ...input, id: 'c1', tds: '12500.00' });
    const service = new TdsChallansService(prisma as never);

    const created = await service.create(claims, input);

    expect(created.tds).toBe(12_500);
    expect(typeof created.tds).toBe('number');
  });

  it('writes an audit row on create', async () => {
    const prisma = makePrisma();
    prisma.tdsChallan.create.mockResolvedValue({ ...input, id: 'c1', tds: '12500.00' });
    const service = new TdsChallansService(prisma as never);

    await service.create(claims, input);

    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'payroll.challan.create',
          entity: 'TdsChallan',
          entityId: 'c1',
        }),
      }),
    );
  });

  it('404s a challan belonging to another organization', async () => {
    // 404 and not 403: whether a row exists is itself information.
    const prisma = makePrisma();
    prisma.tdsChallan.findFirst.mockResolvedValue(null);
    const service = new TdsChallansService(prisma as never);

    await expect(service.remove(claims, 'someone-elses')).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.tdsChallan.delete).not.toHaveBeenCalled();
  });
});
