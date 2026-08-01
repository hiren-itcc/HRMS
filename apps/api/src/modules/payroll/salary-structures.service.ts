import type {
  SalaryStructureCreateInput,
  SalaryStructureQuery,
  SalaryStructureUpdateInput,
} from '@hrms/shared';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { auditMutation } from '../../common/utils/audit';
import { buildListArgs, searchWhere, toPaginated } from '../../common/utils/list-query';
import { PrismaService } from '../../database/prisma.service';
import { toMoney } from './payroll.mapper';

const SORTABLE = ['name', 'code', 'createdAt'] as const;

type StructureRow = {
  id: string;
  name: string;
  code: string;
  description: string | null;
  isActive: boolean;
  createdAt: Date;
  lines?: {
    id: string;
    componentId: string;
    calcType: string;
    value: unknown;
    order: number;
    component: { code: string; name: string; kind: string; isStatutory: boolean };
  }[];
  _count?: { assignments: number };
};

function mapStructure(row: StructureRow) {
  return {
    id: row.id,
    name: row.name,
    code: row.code,
    description: row.description,
    isActive: row.isActive,
    createdAt: row.createdAt.toISOString(),
    assignedCount: row._count?.assignments ?? 0,
    lines: (row.lines ?? []).map((line) => ({
      id: line.id,
      componentId: line.componentId,
      componentCode: line.component.code,
      componentName: line.component.name,
      kind: line.component.kind,
      isStatutory: line.component.isStatutory,
      calcType: line.calcType,
      value: toMoney(line.value),
      order: line.order,
    })),
  };
}

const LINE_INCLUDE = {
  lines: { include: { component: true }, orderBy: { order: 'asc' as const } },
  _count: { select: { assignments: true } },
};

@Injectable()
export class SalaryStructuresService {
  constructor(private readonly prisma: PrismaService) {}

  async list(orgId: string, query: SalaryStructureQuery) {
    const where = {
      organizationId: orgId,
      ...(query.isActive === undefined ? {} : { isActive: query.isActive }),
      ...searchWhere(query.search, ['name', 'code']),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.salaryStructure.findMany({
        where,
        include: LINE_INCLUDE,
        ...buildListArgs(query, SORTABLE, 'name'),
      }),
      this.prisma.salaryStructure.count({ where }),
    ]);
    return toPaginated(rows.map(mapStructure), total, query);
  }

  /** Flat list for the assignment form — active structures only. */
  async options(orgId: string) {
    const rows = await this.prisma.salaryStructure.findMany({
      where: { organizationId: orgId, isActive: true },
      include: LINE_INCLUDE,
      orderBy: { name: 'asc' },
    });
    return rows.map(mapStructure);
  }

  async components(orgId: string) {
    const rows = await this.prisma.payComponent.findMany({
      where: { organizationId: orgId, active: true },
      orderBy: { order: 'asc' },
    });
    return rows.map((row) => ({
      id: row.id,
      code: row.code,
      name: row.name,
      kind: row.kind,
      taxable: row.taxable,
      isStatutory: row.isStatutory,
      isSystem: row.isSystem,
    }));
  }

  async get(orgId: string, id: string) {
    const row = await this.prisma.salaryStructure.findFirst({
      where: { id, organizationId: orgId },
      include: LINE_INCLUDE,
    });
    if (!row) throw new NotFoundException('Salary structure not found');
    return mapStructure(row);
  }

  async create(ctx: { orgId: string; userId: string }, input: SalaryStructureCreateInput) {
    await this.assertComponentsBelong(
      ctx.orgId,
      input.lines.map((l) => l.componentId),
    );
    await this.assertCodeFree(ctx.orgId, input.code);

    const row = await this.prisma.salaryStructure.create({
      data: {
        organizationId: ctx.orgId,
        name: input.name,
        code: input.code,
        description: input.description ?? null,
        isActive: input.isActive,
        lines: { create: input.lines },
      },
      include: LINE_INCLUDE,
    });
    await auditMutation(this.prisma, ctx, 'payroll.structure.create', 'SalaryStructure', row.id, {
      after: { name: row.name, code: row.code, lines: input.lines.length },
    });
    return mapStructure(row);
  }

  async update(
    ctx: { orgId: string; userId: string },
    id: string,
    input: SalaryStructureUpdateInput,
  ) {
    const before = await this.get(ctx.orgId, id);
    if (input.code && input.code !== before.code) await this.assertCodeFree(ctx.orgId, input.code);
    if (input.lines) {
      await this.assertComponentsBelong(
        ctx.orgId,
        input.lines.map((l) => l.componentId),
      );
    }

    const row = await this.prisma.$transaction(async (tx) => {
      if (input.lines) {
        // Replace wholesale rather than diff: a structure is small, and a
        // partial update would leave orphaned lines behind.
        await tx.structureLine.deleteMany({ where: { structureId: id } });
        await tx.structureLine.createMany({
          data: input.lines.map((line) => ({ ...line, structureId: id })),
        });
      }
      return tx.salaryStructure.update({
        where: { id },
        data: {
          ...(input.name === undefined ? {} : { name: input.name }),
          ...(input.code === undefined ? {} : { code: input.code }),
          ...(input.description === undefined ? {} : { description: input.description }),
          ...(input.isActive === undefined ? {} : { isActive: input.isActive }),
        },
        include: LINE_INCLUDE,
      });
    });

    const after = mapStructure(row);
    await auditMutation(this.prisma, ctx, 'payroll.structure.update', 'SalaryStructure', id, {
      before: { name: before.name, isActive: before.isActive, lines: before.lines.length },
      after: { name: after.name, isActive: after.isActive, lines: after.lines.length },
    });
    return after;
  }

  /** Copy a structure and its lines — the fastest way to make a variant. */
  async clone(ctx: { orgId: string; userId: string }, id: string) {
    const source = await this.get(ctx.orgId, id);
    const code = await this.nextFreeCode(ctx.orgId, source.code);
    const row = await this.prisma.salaryStructure.create({
      data: {
        organizationId: ctx.orgId,
        name: `${source.name} (copy)`.slice(0, 100),
        code,
        description: source.description,
        // A clone starts inactive: it is a draft until someone has looked at it.
        isActive: false,
        lines: {
          create: source.lines.map((line) => ({
            componentId: line.componentId,
            calcType: line.calcType as never,
            value: line.value,
            order: line.order,
          })),
        },
      },
      include: LINE_INCLUDE,
    });
    await auditMutation(this.prisma, ctx, 'payroll.structure.clone', 'SalaryStructure', row.id, {
      after: { clonedFrom: id, code },
    });
    return mapStructure(row);
  }

  async remove(ctx: { orgId: string; userId: string }, id: string) {
    const row = await this.prisma.salaryStructure.findFirst({
      where: { id, organizationId: ctx.orgId },
      include: { _count: { select: { assignments: true } } },
    });
    if (!row) throw new NotFoundException('Salary structure not found');
    if (row._count.assignments > 0) {
      // Deleting would orphan salary history. Deactivating keeps every past
      // payslip explicable.
      throw new BadRequestException(
        `${row._count.assignments} salary record(s) use this structure — deactivate it instead of deleting`,
      );
    }
    await this.prisma.salaryStructure.delete({ where: { id } });
    await auditMutation(this.prisma, ctx, 'payroll.structure.delete', 'SalaryStructure', id, {
      before: { name: row.name, code: row.code },
    });
    return { id };
  }

  private async assertCodeFree(orgId: string, code: string) {
    const clash = await this.prisma.salaryStructure.findFirst({
      where: { organizationId: orgId, code },
      select: { id: true },
    });
    if (clash) throw new BadRequestException(`A structure with code ${code} already exists`);
  }

  /** Components are org-scoped; a structure must not reference another tenant's. */
  private async assertComponentsBelong(orgId: string, componentIds: string[]) {
    const count = await this.prisma.payComponent.count({
      where: { organizationId: orgId, id: { in: componentIds } },
    });
    if (count !== new Set(componentIds).size) {
      throw new BadRequestException('One or more pay components do not exist');
    }
  }

  private async nextFreeCode(orgId: string, base: string): Promise<string> {
    for (let n = 2; n < 100; n++) {
      const candidate = `${base}_${n}`.slice(0, 20);
      const taken = await this.prisma.salaryStructure.findFirst({
        where: { organizationId: orgId, code: candidate },
        select: { id: true },
      });
      if (!taken) return candidate;
    }
    throw new BadRequestException('Could not derive a free code for the copy');
  }
}
