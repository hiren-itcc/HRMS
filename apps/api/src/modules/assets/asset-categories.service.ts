import type { AssetCategoryInput } from '@hrms/shared';
import type { AccessTokenClaims } from '@hrms/types';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { auditMutation } from '../../common/utils/audit';
import { PrismaService } from '../../database/prisma.service';

/**
 * Asset categories, modelled on `DocumentCategory` — a per-organization table
 * rather than a settings list, because assets are filtered and counted by
 * category and free text would make both unreliable.
 */
@Injectable()
export class AssetCategoriesService {
  constructor(private readonly prisma: PrismaService) {}

  list(claims: AccessTokenClaims) {
    return this.prisma.assetCategory.findMany({
      where: { organizationId: claims.orgId },
      orderBy: { name: 'asc' },
      include: { _count: { select: { assets: true } } },
    });
  }

  async create(claims: AccessTokenClaims, input: AssetCategoryInput) {
    const ctx = { orgId: claims.orgId, userId: claims.sub };
    const created = await this.prisma.assetCategory
      .create({ data: { organizationId: ctx.orgId, name: input.name } })
      .catch(this.rethrowDuplicate);

    await auditMutation(this.prisma, ctx, 'asset.category.create', 'AssetCategory', created.id, {
      after: { name: created.name },
    });
    return created;
  }

  async update(claims: AccessTokenClaims, id: string, input: AssetCategoryInput) {
    const ctx = { orgId: claims.orgId, userId: claims.sub };
    const before = await this.require(ctx.orgId, id);

    const updated = await this.prisma.assetCategory
      .update({ where: { id }, data: { name: input.name } })
      .catch(this.rethrowDuplicate);

    await auditMutation(this.prisma, ctx, 'asset.category.update', 'AssetCategory', id, {
      before: { name: before.name },
      after: { name: updated.name },
    });
    return updated;
  }

  /** Refused while assets are filed under it — the same rule a document folder
   *  follows, and for the same reason: the alternative is orphaned rows. */
  async remove(claims: AccessTokenClaims, id: string) {
    const ctx = { orgId: claims.orgId, userId: claims.sub };
    const category = await this.require(ctx.orgId, id);

    const inUse = await this.prisma.asset.count({ where: { categoryId: id } });
    if (inUse > 0) {
      throw new BadRequestException(
        `${inUse} asset${inUse === 1 ? '' : 's'} are filed under this. Move them first`,
      );
    }

    await this.prisma.assetCategory.delete({ where: { id } });
    await auditMutation(this.prisma, ctx, 'asset.category.delete', 'AssetCategory', id, {
      before: { name: category.name },
    });
    return { id };
  }

  private async require(orgId: string, id: string) {
    const category = await this.prisma.assetCategory.findFirst({
      where: { id, organizationId: orgId },
    });
    if (!category) throw new NotFoundException('Asset category not found');
    return category;
  }

  private rethrowDuplicate = (err: unknown): never => {
    if ((err as { code?: string }).code === 'P2002') {
      throw new ConflictException('A category with that name already exists');
    }
    throw err;
  };
}
