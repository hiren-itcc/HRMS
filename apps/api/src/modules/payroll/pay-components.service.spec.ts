import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PayComponentsService } from './pay-components.service';

const ctx = { orgId: 'org-1', userId: 'user-1' };

function makePrisma() {
  return {
    payComponent: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    auditLog: { create: jest.fn() },
  };
}

const createInput = {
  code: 'SHIFT_ALLOWANCE',
  name: 'Shift Allowance',
  kind: 'EARNING' as const,
  taxable: true,
  isStatutory: false,
  order: 30,
  active: true,
};

describe('PayComponentsService', () => {
  describe('list', () => {
    it('defaults to active-only — existing callers see no change', async () => {
      const prisma = makePrisma();
      prisma.payComponent.findMany.mockResolvedValue([]);
      const service = new PayComponentsService(prisma as never);

      await service.list('org-1');

      expect(prisma.payComponent.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { organizationId: 'org-1', active: true } }),
      );
    });

    it('includes inactive components when asked', async () => {
      const prisma = makePrisma();
      prisma.payComponent.findMany.mockResolvedValue([]);
      const service = new PayComponentsService(prisma as never);

      await service.list('org-1', true);

      expect(prisma.payComponent.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { organizationId: 'org-1' } }),
      );
    });
  });

  describe('create', () => {
    it('scopes the duplicate-code check to the caller organization — a different org may reuse a code', async () => {
      const prisma = makePrisma();
      prisma.payComponent.findFirst.mockResolvedValue(null);
      prisma.payComponent.create.mockResolvedValue({ ...createInput, id: 'c1', isSystem: false });
      const service = new PayComponentsService(prisma as never);

      await service.create(ctx, createInput);

      expect(prisma.payComponent.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { organizationId: 'org-1', code: 'SHIFT_ALLOWANCE' },
        }),
      );
    });

    it('rejects a duplicate code within the same organization', async () => {
      const prisma = makePrisma();
      prisma.payComponent.findFirst.mockResolvedValue({ id: 'existing' });
      const service = new PayComponentsService(prisma as never);

      await expect(service.create(ctx, createInput)).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.payComponent.create).not.toHaveBeenCalled();
    });

    it('writes an audit row on create', async () => {
      const prisma = makePrisma();
      prisma.payComponent.findFirst.mockResolvedValue(null);
      prisma.payComponent.create.mockResolvedValue({ ...createInput, id: 'c1', isSystem: false });
      const service = new PayComponentsService(prisma as never);

      await service.create(ctx, createInput);

      expect(prisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            action: 'payroll.component.create',
            entity: 'PayComponent',
            entityId: 'c1',
          }),
        }),
      );
    });
  });

  describe('update', () => {
    function existingRow(over: Partial<Record<string, unknown>> = {}) {
      return {
        id: 'c1',
        code: 'HRA',
        name: 'House Rent Allowance',
        kind: 'EARNING',
        taxable: true,
        isStatutory: false,
        isSystem: true,
        order: 1,
        active: true,
        ...over,
      };
    }

    it('silently ignores a code in the payload rather than 400ing — the field is disabled in the UI', async () => {
      const prisma = makePrisma();
      const existing = existingRow();
      prisma.payComponent.findFirst.mockResolvedValue(existing);
      prisma.payComponent.update.mockResolvedValue({ ...existing, name: 'House Rent' });
      const service = new PayComponentsService(prisma as never);

      // A stale client shape carrying `code` at runtime, despite the update
      // type not having the field.
      await service.update(ctx, 'c1', { name: 'House Rent', code: 'RENAMED' } as never);

      expect(prisma.payComponent.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.not.objectContaining({ code: expect.anything() }),
        }),
      );
    });

    it('rejects a kind change on a protected component', async () => {
      const prisma = makePrisma();
      prisma.payComponent.findFirst.mockResolvedValue(existingRow({ code: 'BASIC' }));
      const service = new PayComponentsService(prisma as never);

      await expect(service.update(ctx, 'c1', { kind: 'DEDUCTION' })).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(prisma.payComponent.update).not.toHaveBeenCalled();
    });

    it('rejects a taxable change on TDS specifically — the case an isStatutory guard would miss', async () => {
      const prisma = makePrisma();
      prisma.payComponent.findFirst.mockResolvedValue(
        existingRow({ code: 'TDS', kind: 'DEDUCTION', taxable: false, isStatutory: false }),
      );
      const service = new PayComponentsService(prisma as never);

      await expect(service.update(ctx, 'c1', { taxable: true })).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(prisma.payComponent.update).not.toHaveBeenCalled();
    });

    it('allows a name change on a protected component', async () => {
      const prisma = makePrisma();
      const existing = existingRow({ code: 'BASIC' });
      prisma.payComponent.findFirst.mockResolvedValue(existing);
      prisma.payComponent.update.mockResolvedValue({ ...existing, name: 'Base Pay' });
      const service = new PayComponentsService(prisma as never);

      await service.update(ctx, 'c1', { name: 'Base Pay' });

      expect(prisma.payComponent.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ name: 'Base Pay' }) }),
      );
    });

    it('404s another organization row', async () => {
      const prisma = makePrisma();
      prisma.payComponent.findFirst.mockResolvedValue(null);
      const service = new PayComponentsService(prisma as never);

      await expect(service.update(ctx, 'someone-elses', { name: 'x' })).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(prisma.payComponent.update).not.toHaveBeenCalled();
    });

    it('writes an audit row on update', async () => {
      const prisma = makePrisma();
      const existing = existingRow();
      prisma.payComponent.findFirst.mockResolvedValue(existing);
      prisma.payComponent.update.mockResolvedValue({ ...existing, name: 'House Rent' });
      const service = new PayComponentsService(prisma as never);

      await service.update(ctx, 'c1', { name: 'House Rent' });

      expect(prisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            action: 'payroll.component.update',
            entity: 'PayComponent',
            entityId: 'c1',
          }),
        }),
      );
    });
  });

  describe('remove', () => {
    function row(
      counts: Partial<{
        structureLines: number;
        adjustments: number;
        expenseCategories: number;
      }> = {},
    ) {
      return {
        id: 'c1',
        code: 'SHIFT_ALLOWANCE',
        _count: { structureLines: 0, adjustments: 0, expenseCategories: 0, ...counts },
      };
    }

    it('404s another organization row before any count runs', async () => {
      const prisma = makePrisma();
      prisma.payComponent.findFirst.mockResolvedValue(null);
      const service = new PayComponentsService(prisma as never);

      await expect(service.remove(ctx, 'someone-elses')).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.payComponent.delete).not.toHaveBeenCalled();
    });

    it('never deletes a protected component, regardless of references', async () => {
      const prisma = makePrisma();
      prisma.payComponent.findFirst.mockResolvedValue({ ...row(), code: 'BASIC' });
      const service = new PayComponentsService(prisma as never);

      await expect(service.remove(ctx, 'c1')).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.payComponent.delete).not.toHaveBeenCalled();
    });

    it('refuses with a readable count when a user-created component is referenced', async () => {
      const prisma = makePrisma();
      prisma.payComponent.findFirst.mockResolvedValue(
        row({ structureLines: 2, expenseCategories: 1 }),
      );
      const service = new PayComponentsService(prisma as never);

      await expect(service.remove(ctx, 'c1')).rejects.toThrow(
        /2 salary structures and 1 expense categor/,
      );
      expect(prisma.payComponent.delete).not.toHaveBeenCalled();
    });

    it('deletes an unreferenced user-created component', async () => {
      const prisma = makePrisma();
      prisma.payComponent.findFirst.mockResolvedValue(row());
      prisma.payComponent.delete.mockResolvedValue({ id: 'c1' });
      const service = new PayComponentsService(prisma as never);

      await service.remove(ctx, 'c1');

      expect(prisma.payComponent.delete).toHaveBeenCalledWith({ where: { id: 'c1' } });
    });

    it('writes an audit row on delete', async () => {
      const prisma = makePrisma();
      prisma.payComponent.findFirst.mockResolvedValue(row());
      prisma.payComponent.delete.mockResolvedValue({ id: 'c1' });
      const service = new PayComponentsService(prisma as never);

      await service.remove(ctx, 'c1');

      expect(prisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            action: 'payroll.component.delete',
            entity: 'PayComponent',
            entityId: 'c1',
          }),
        }),
      );
    });
  });
});
