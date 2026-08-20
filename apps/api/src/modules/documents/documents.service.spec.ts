import type { AccessTokenClaims } from '@hrms/types';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { PERMISSIONS_KEY } from '../../common/decorators/require-permissions.decorator';
import { DocumentsController } from './documents.controller';
import { DocumentsService } from './documents.service';

type Mock = jest.Mock;

function makeService() {
  const prisma = {
    employee: { findFirst: jest.fn().mockResolvedValue({ managerId: 'e-mgr' }) },
    document: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn(),
      create: jest.fn().mockResolvedValue({ id: 'd1' }),
      update: jest.fn(),
      count: jest.fn().mockResolvedValue(0),
    },
    auditLog: { create: jest.fn() },
    // Null = the document is not an expense receipt, which is every test's
    // default; the receipt describe block below overrides it.
    expenseItem: { findFirst: jest.fn().mockResolvedValue(null) },
    // The real client runs both halves of a list in one transaction; the
    // double just resolves whatever the service handed it.
    $transaction: jest.fn((ops: Promise<unknown>[]) => Promise.all(ops)),
  };
  const storage = { put: jest.fn().mockResolvedValue('org1/key.pdf'), stream: jest.fn() };
  const categories = { assertBelongs: jest.fn() };
  const config = { get: jest.fn().mockReturnValue(10) };
  return {
    // biome-ignore lint/suspicious/noExplicitAny: structural test doubles
    service: new DocumentsService(prisma as any, storage as any, categories as any, config as any),
    prisma,
    storage,
  };
}

const claims = (over: Partial<AccessTokenClaims>): AccessTokenClaims => ({
  sub: 'u1',
  orgId: 'org1',
  roleCode: 'EMPLOYEE',
  perms: [],
  ...over,
});

const pdf = {
  originalname: 'offer.pdf',
  mimetype: 'application/pdf',
  size: 1024,
  buffer: Buffer.from('x'),
};

describe('DocumentsService access matrix', () => {
  it('lets HR (document.read) list anyone', async () => {
    const { service } = makeService();
    await expect(
      service.listForEmployee(claims({ perms: ['document.read'] }), 'e2'),
    ).resolves.toEqual([]);
  });

  it("lets a manager (read.team) list a direct report's documents", async () => {
    const { service } = makeService();
    await expect(
      service.listForEmployee(claims({ perms: ['document.read.team'], employeeId: 'e-mgr' }), 'e2'),
    ).resolves.toEqual([]);
  });

  it('blocks a manager from a non-report', async () => {
    const { service, prisma } = makeService();
    (prisma.employee.findFirst as Mock).mockResolvedValue({ managerId: 'other' });
    await expect(
      service.listForEmployee(claims({ perms: ['document.read.team'], employeeId: 'e-mgr' }), 'e2'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('lets an employee (read.own) list only their own', async () => {
    const { service } = makeService();
    await expect(
      service.listForEmployee(claims({ perms: ['document.read.own'], employeeId: 'e2' }), 'e2'),
    ).resolves.toEqual([]);
    await expect(
      service.listForEmployee(claims({ perms: ['document.read.own'], employeeId: 'e3' }), 'e2'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe('DocumentsService.listAll', () => {
  const query = { page: 1, limit: 20, order: 'asc' as const };

  /*
   * This list is gated by @RequirePermissions('document.read') on the route,
   * not inside the service — so the service is tested for what it actually
   * decides (scope, filters, shape) and the gate is asserted separately below.
   */
  it('scopes to the org, skips deleted rows and skips documents with no employee', async () => {
    const { service, prisma } = makeService();
    await service.listAll(claims({ perms: ['document.read'] }), query);
    expect(prisma.document.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          organizationId: 'org1',
          deletedAt: null,
          employeeId: { not: null },
        }),
      }),
    );
  });

  it('narrows to one employee and folder when asked', async () => {
    const { service, prisma } = makeService();
    await service.listAll(claims({ perms: ['document.read'] }), {
      ...query,
      employeeId: 'e2',
      categoryId: 'c1',
    });
    expect(prisma.document.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ employeeId: 'e2', categoryId: 'c1' }),
      }),
    );
  });

  it('paginates and reports the total', async () => {
    const { service, prisma } = makeService();
    (prisma.document.count as Mock).mockResolvedValue(42);
    const result = await service.listAll(claims({ perms: ['document.read'] }), {
      ...query,
      page: 3,
      limit: 10,
    });
    expect(prisma.document.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 20, take: 10 }),
    );
    expect(result.meta).toEqual({ page: 3, limit: 10, total: 42 });
  });
});

describe('the org-wide list route', () => {
  it('demands document.read — not .own or .team', () => {
    const required = Reflect.getMetadata(
      PERMISSIONS_KEY,
      DocumentsController.prototype.listAll,
    ) as string[];
    expect(required).toEqual(['document.read']);
  });
});

describe('DocumentsService.upload validation', () => {
  it('rejects disallowed mime types', async () => {
    const { service } = makeService();
    await expect(
      service.upload(claims({ perms: ['document.upload'] }), 'e2', {
        ...pdf,
        mimetype: 'application/zip',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects files over the size limit', async () => {
    const { service } = makeService();
    await expect(
      service.upload(claims({ perms: ['document.upload'] }), 'e2', {
        ...pdf,
        size: 11 * 1024 * 1024,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('stores and audits a valid upload', async () => {
    const { service, prisma, storage } = makeService();
    await service.upload(claims({ perms: ['document.upload'] }), 'e2', pdf);
    expect(storage.put).toHaveBeenCalled();
    expect(prisma.document.create).toHaveBeenCalled();
    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: 'document.upload' }) }),
    );
  });
});

describe('DocumentsService.remove', () => {
  const row = { id: 'd1', employeeId: 'e2', uploadedById: 'u1', fileKey: 'k' };

  it('allows document.manage holders', async () => {
    const { service, prisma } = makeService();
    (prisma.document.findFirst as Mock).mockResolvedValue(row);
    await service.remove(claims({ perms: ['document.manage'] }), 'd1');
    expect(prisma.document.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { deletedAt: expect.any(Date) } }),
    );
  });

  it('allows the self-uploader on their own record', async () => {
    const { service, prisma } = makeService();
    (prisma.document.findFirst as Mock).mockResolvedValue(row);
    await expect(
      service.remove(claims({ perms: [], employeeId: 'e2', sub: 'u1' }), 'd1'),
    ).resolves.toBeUndefined();
  });

  it("blocks others' deletes without document.manage", async () => {
    const { service, prisma } = makeService();
    (prisma.document.findFirst as Mock).mockResolvedValue({ ...row, uploadedById: 'someone' });
    await expect(
      service.remove(claims({ perms: [], employeeId: 'e2' }), 'd1'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe('DocumentsService.openFile on an expense receipt', () => {
  const receiptDoc = { id: 'd1', employeeId: 'e2', fileKey: 'k' };

  function makeReceiptCase() {
    const made = makeService();
    (made.prisma.document.findFirst as Mock).mockResolvedValue(receiptDoc);
    (made.prisma.expenseItem.findFirst as Mock).mockResolvedValue({
      claim: { employeeId: 'e2' },
    });
    (made.storage.stream as Mock).mockResolvedValue('stream');
    return made;
  }

  /*
   * The case this rule exists for: Finance approves every claim in the
   * organization but holds only document.read.own, so without the receipt
   * rule it was refused the very file it was being asked to approve.
   */
  it('lets an org-wide expense reader (Finance) open it', async () => {
    const { service } = makeReceiptCase();
    await expect(
      service.openFile(claims({ perms: ['expense.read', 'document.read.own'] }), 'd1'),
    ).resolves.toMatchObject({ doc: receiptDoc });
  });

  it("lets a manager with expense.approve.team open a report's receipt", async () => {
    const { service, prisma } = makeReceiptCase();
    (prisma.employee.findFirst as Mock).mockResolvedValue({ id: 'e2' });
    await expect(
      service.openFile(claims({ perms: ['expense.approve.team'], employeeId: 'e-mgr' }), 'd1'),
    ).resolves.toMatchObject({ doc: receiptDoc });
  });

  it('refuses that manager for a non-report', async () => {
    const { service, prisma } = makeReceiptCase();
    (prisma.employee.findFirst as Mock)
      .mockResolvedValueOnce(null) // the managed-claimant lookup
      .mockResolvedValueOnce({ managerId: 'someone-else' }); // ensureEmployeeAccess
    await expect(
      service.openFile(claims({ perms: ['expense.approve.team'], employeeId: 'e-mgr' }), 'd1'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('refuses a holder of no expense permission at all', async () => {
    const { service, prisma } = makeReceiptCase();
    (prisma.employee.findFirst as Mock).mockResolvedValue({ managerId: 'someone-else' });
    await expect(
      service.openFile(claims({ perms: ['document.read.own'], employeeId: 'e9' }), 'd1'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  /*
   * The boundary that keeps this from being a general widening: expense.read
   * opens receipts, not the rest of the HR record. A document that is not a
   * receipt answers exactly as it did before the rule existed.
   */
  it('does not let expense.read open a non-receipt document', async () => {
    const { service, prisma } = makeReceiptCase();
    (prisma.expenseItem.findFirst as Mock).mockResolvedValue(null);
    (prisma.employee.findFirst as Mock).mockResolvedValue({ managerId: 'someone-else' });
    await expect(
      service.openFile(claims({ perms: ['expense.read'], employeeId: 'e9' }), 'd1'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
