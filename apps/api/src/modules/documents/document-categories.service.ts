import type { DocumentCategoryCreateInput } from '@hrms/shared';
import type { AccessTokenClaims } from '@hrms/types';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { auditMutation } from '../../common/utils/audit';
import { PrismaService } from '../../database/prisma.service';

/** Document folders — an org-wide taxonomy shared by every employee. */
@Injectable()
export class DocumentCategoriesService {
  constructor(private readonly prisma: PrismaService) {}

  /** Folders with how many live documents each holds, for the caller's scope. */
  async list(claims: AccessTokenClaims, employeeId?: string) {
    const categories = await this.prisma.documentCategory.findMany({
      where: { organizationId: claims.orgId },
      orderBy: { name: 'asc' },
    });

    const counts = await this.prisma.document.groupBy({
      by: ['categoryId'],
      where: {
        organizationId: claims.orgId,
        deletedAt: null,
        ...(employeeId ? { employeeId } : {}),
      },
      _count: { _all: true },
    });
    const byId = new Map(counts.map((c) => [c.categoryId, c._count._all]));

    return categories.map((c) => ({ ...c, documentCount: byId.get(c.id) ?? 0 }));
  }

  async create(claims: AccessTokenClaims, input: DocumentCategoryCreateInput) {
    const row = await this.prisma.documentCategory.create({
      data: { organizationId: claims.orgId, name: input.name },
    });
    await auditMutation(
      this.prisma,
      { orgId: claims.orgId, userId: claims.sub },
      'document.category.create',
      'DocumentCategory',
      row.id,
    );
    return { ...row, documentCount: 0 };
  }

  async update(claims: AccessTokenClaims, id: string, input: DocumentCategoryCreateInput) {
    await this.ensureExists(claims.orgId, id);
    const row = await this.prisma.documentCategory.update({
      where: { id },
      data: { name: input.name },
    });
    await auditMutation(
      this.prisma,
      { orgId: claims.orgId, userId: claims.sub },
      'document.category.update',
      'DocumentCategory',
      id,
    );
    return row;
  }

  /** Refuses while documents are filed here — never orphan files silently. */
  async remove(claims: AccessTokenClaims, id: string) {
    await this.ensureExists(claims.orgId, id);
    const inUse = await this.prisma.document.count({ where: { categoryId: id, deletedAt: null } });
    if (inUse > 0) {
      throw new BadRequestException(
        `${inUse} document(s) are filed in this folder — move them first`,
      );
    }
    await this.prisma.documentCategory.delete({ where: { id } });
    await auditMutation(
      this.prisma,
      { orgId: claims.orgId, userId: claims.sub },
      'document.category.delete',
      'DocumentCategory',
      id,
    );
  }

  /** Validates a folder belongs to the caller's org before filing into it. */
  async assertBelongs(orgId: string, categoryId: string) {
    await this.ensureExists(orgId, categoryId);
  }

  private async ensureExists(orgId: string, id: string) {
    const found = await this.prisma.documentCategory.findFirst({
      where: { id, organizationId: orgId },
    });
    if (!found) throw new NotFoundException('Folder not found');
  }
}
