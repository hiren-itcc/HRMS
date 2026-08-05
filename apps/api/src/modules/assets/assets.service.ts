import type {
  AssetCreateInput,
  AssetIssueInput,
  AssetQuery,
  AssetReturnInput,
  AssetStatusChangeInput,
  AssetUpdateInput,
} from '@hrms/shared';
import type { AccessTokenClaims } from '@hrms/types';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { auditMutation } from '../../common/utils/audit';
import { dateKeyOf, toDate } from '../../common/utils/calendar';
import { buildListArgs, toPaginated } from '../../common/utils/list-query';
import { PrismaService } from '../../database/prisma.service';
import type { Prisma } from '../../generated/prisma/client';
import { AuditService } from '../audit/audit.service';
import {
  canIssue,
  canReturn,
  canSetStatus,
  issueError,
  returnError,
  statusChangeError,
} from './asset.status';
import { AssetClearanceService } from './asset-clearance.service';

const SORTABLE = ['assetTag', 'name', 'status', 'purchaseDate', 'createdAt'] as const;

const HOLDER = {
  where: { returnedOn: null },
  take: 1,
  include: {
    employee: {
      select: { id: true, firstName: true, lastName: true, employeeCode: true, avatarUrl: true },
    },
  },
} as const;

const LIST_INCLUDE = {
  category: { select: { id: true, name: true } },
  location: { select: { id: true, name: true } },
  assignments: HOLDER,
} as const;

interface Ctx {
  orgId: string;
  userId: string | null;
}

/**
 * The asset register.
 *
 * One row per physical thing. The invariant the whole module rests on — that
 * an asset is in at most one person's hands — is a partial unique index rather
 * than a check in here, so two simultaneous issues cannot both win.
 */
@Injectable()
export class AssetsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clearance: AssetClearanceService,
    private readonly audit: AuditService,
  ) {}

  // ── register ──────────────────────────────────────────────────────────

  async create(claims: AccessTokenClaims, input: AssetCreateInput) {
    const ctx: Ctx = { orgId: claims.orgId, userId: claims.sub };
    await this.requireCategory(ctx.orgId, input.categoryId);

    const created = await this.prisma.asset
      .create({
        data: {
          organizationId: ctx.orgId,
          ...this.writable(input),
          assetTag: input.assetTag,
          name: input.name,
          categoryId: input.categoryId,
        },
        include: LIST_INCLUDE,
      })
      .catch(this.rethrowDuplicateTag);

    await auditMutation(this.prisma, ctx, 'asset.create', 'Asset', created.id, {
      after: { assetTag: created.assetTag, name: created.name },
    });
    return created;
  }

  async update(claims: AccessTokenClaims, id: string, input: AssetUpdateInput) {
    const ctx: Ctx = { orgId: claims.orgId, userId: claims.sub };
    const before = await this.require(ctx.orgId, id);
    if (input.categoryId) await this.requireCategory(ctx.orgId, input.categoryId);

    const updated = await this.prisma.asset
      .update({
        where: { id },
        data: {
          ...this.writable(input),
          ...(input.assetTag !== undefined ? { assetTag: input.assetTag } : {}),
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.categoryId !== undefined ? { categoryId: input.categoryId } : {}),
        },
        include: LIST_INCLUDE,
      })
      .catch(this.rethrowDuplicateTag);

    await auditMutation(this.prisma, ctx, 'asset.update', 'Asset', id, {
      before: { assetTag: before.assetTag, name: before.name },
      after: { assetTag: updated.assetTag, name: updated.name },
    });
    return updated;
  }

  /**
   * Deletable only while it has no history.
   *
   * Once somebody has held it, deleting the row would erase the answer to "who
   * had this in March" — which is the question a register exists to answer.
   * Retiring is the honest way to stop using something.
   */
  async remove(claims: AccessTokenClaims, id: string) {
    const ctx: Ctx = { orgId: claims.orgId, userId: claims.sub };
    const asset = await this.require(ctx.orgId, id);

    const history = await this.prisma.assetAssignment.count({ where: { assetId: id } });
    if (history > 0) {
      throw new BadRequestException(
        'This has been issued before, so deleting it would erase who had it. Retire it instead',
      );
    }

    await this.prisma.asset.delete({ where: { id } });
    await auditMutation(this.prisma, ctx, 'asset.delete', 'Asset', id, {
      before: { assetTag: asset.assetTag, name: asset.name },
    });
    return { id };
  }

  // ── issue and return ──────────────────────────────────────────────────

  async issue(claims: AccessTokenClaims, id: string, input: AssetIssueInput) {
    const ctx: Ctx = { orgId: claims.orgId, userId: claims.sub };
    const asset = await this.require(ctx.orgId, id);
    if (!canIssue(asset.status)) throw new BadRequestException(issueError(asset.status));

    const employee = await this.prisma.employee.findFirst({
      where: { id: input.employeeId, organizationId: ctx.orgId },
      select: { id: true, firstName: true, lastName: true, status: true },
    });
    if (!employee) throw new NotFoundException('Employee not found');
    // The one data-entry slip that creates an asset nobody will ever chase.
    if (employee.status === 'EXITED') {
      throw new BadRequestException(`${employee.firstName} has already left`);
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.assetAssignment.create({
        data: {
          assetId: id,
          employeeId: input.employeeId,
          issuedOn: toDate(input.issuedOn),
          issuedById: ctx.userId,
          conditionOut: input.conditionOut,
          notes: input.notes ?? null,
        },
      });
      return tx.asset.update({
        where: { id },
        data: { status: 'ASSIGNED', condition: input.conditionOut },
        include: LIST_INCLUDE,
      });
    });

    await auditMutation(this.prisma, ctx, 'asset.issue', 'Asset', id, {
      after: {
        employee: `${employee.firstName} ${employee.lastName}`,
        issuedOn: input.issuedOn,
        condition: input.conditionOut,
      },
      note: input.notes ?? null,
    });

    // A leaver who is handed something new has it outstanding again.
    await this.clearance.sync(ctx.orgId, input.employeeId);
    return updated;
  }

  async return(claims: AccessTokenClaims, id: string, input: AssetReturnInput) {
    const ctx: Ctx = { orgId: claims.orgId, userId: claims.sub };
    const asset = await this.require(ctx.orgId, id);
    if (!canReturn(asset.status)) throw new BadRequestException(returnError(asset.status));

    const open = await this.openAssignment(id);
    if (input.returnedOn < dateKeyOf(open.issuedOn)) {
      throw new BadRequestException('It cannot come back before it went out');
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.assetAssignment.update({
        where: { id: open.id },
        data: {
          returnedOn: toDate(input.returnedOn),
          returnedById: ctx.userId,
          conditionIn: input.conditionIn,
          // Appended rather than replaced: the note written when it went out
          // is what the note coming back is being compared against.
          notes: [open.notes, input.notes].filter(Boolean).join(' · ') || null,
        },
      });
      return tx.asset.update({
        where: { id },
        data: { status: 'IN_STOCK', condition: input.conditionIn },
        include: LIST_INCLUDE,
      });
    });

    await auditMutation(this.prisma, ctx, 'asset.return', 'Asset', id, {
      before: { condition: open.conditionOut },
      after: { returnedOn: input.returnedOn, condition: input.conditionIn },
      note: input.notes ?? null,
    });

    await this.clearance.sync(ctx.orgId, open.employeeId);
    return updated;
  }

  /**
   * The three statuses a person sets by hand.
   *
   * `LOST` is the only one allowed while somebody still holds it, and it closes
   * their assignment — "it is gone" is precisely the case where the thing
   * cannot be handed back. Nothing is recorded as a condition, because nothing
   * came back to have one.
   */
  async setStatus(claims: AccessTokenClaims, id: string, input: AssetStatusChangeInput) {
    const ctx: Ctx = { orgId: claims.orgId, userId: claims.sub };
    const asset = await this.require(ctx.orgId, id);
    if (!canSetStatus(asset.status, input.status)) {
      throw new BadRequestException(statusChangeError(asset.status, input.status));
    }

    const open = asset.status === 'ASSIGNED' ? await this.openAssignment(id) : null;

    const updated = await this.prisma.$transaction(async (tx) => {
      if (open) {
        await tx.assetAssignment.update({
          where: { id: open.id },
          data: {
            returnedOn: new Date(),
            returnedById: ctx.userId,
            notes: [open.notes, `Written off: ${input.reason}`].filter(Boolean).join(' · '),
          },
        });
      }
      return tx.asset.update({
        where: { id },
        data: { status: input.status },
        include: LIST_INCLUDE,
      });
    });

    await auditMutation(this.prisma, ctx, 'asset.status', 'Asset', id, {
      before: { status: asset.status },
      after: { status: input.status },
      note: input.reason,
    });

    if (open) await this.clearance.sync(ctx.orgId, open.employeeId);
    return updated;
  }

  // ── reads ─────────────────────────────────────────────────────────────

  async list(claims: AccessTokenClaims, query: AssetQuery) {
    const where: Prisma.AssetWhereInput = {
      organizationId: claims.orgId,
      ...(query.status ? { status: query.status } : {}),
      ...(query.categoryId ? { categoryId: query.categoryId } : {}),
      ...(query.employeeId
        ? { assignments: { some: { employeeId: query.employeeId, returnedOn: null } } }
        : {}),
      // The three things somebody reads off a sticker while holding the thing.
      ...(query.search
        ? {
            OR: [
              { assetTag: { contains: query.search, mode: 'insensitive' as const } },
              { serialNumber: { contains: query.search, mode: 'insensitive' as const } },
              { name: { contains: query.search, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    };

    const [data, total] = await this.prisma.$transaction([
      this.prisma.asset.findMany({
        where,
        include: LIST_INCLUDE,
        ...buildListArgs(query, SORTABLE, 'assetTag'),
      }),
      this.prisma.asset.count({ where }),
    ]);
    return toPaginated(data, total, query);
  }

  async detail(claims: AccessTokenClaims, id: string) {
    const asset = await this.prisma.asset.findFirst({
      where: { id, organizationId: claims.orgId },
      include: {
        ...LIST_INCLUDE,
        assignments: {
          orderBy: { issuedOn: 'desc' },
          include: {
            employee: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                employeeCode: true,
                avatarUrl: true,
              },
            },
          },
        },
      },
    });
    if (!asset) throw new NotFoundException('Asset not found');
    return asset;
  }

  /**
   * What one person is holding right now.
   *
   * Open assignments only — this answers "what do they still have", which is
   * the question the exit clearance and the employee's own page both ask.
   */
  heldBy(orgId: string, employeeId: string) {
    return this.prisma.assetAssignment.findMany({
      where: { employeeId, returnedOn: null, asset: { organizationId: orgId } },
      orderBy: { issuedOn: 'asc' },
      include: {
        asset: {
          include: { category: { select: { id: true, name: true } } },
        },
      },
    });
  }

  async activity(claims: AccessTokenClaims, id: string) {
    await this.detail(claims, id);
    return this.audit.forEntity(claims.orgId, 'Asset', id);
  }

  // ── guards ────────────────────────────────────────────────────────────

  private async require(orgId: string, id: string) {
    const asset = await this.prisma.asset.findFirst({ where: { id, organizationId: orgId } });
    if (!asset) throw new NotFoundException('Asset not found');
    return asset;
  }

  private async requireCategory(orgId: string, categoryId: string) {
    const found = await this.prisma.assetCategory.count({
      where: { id: categoryId, organizationId: orgId },
    });
    if (found === 0) throw new NotFoundException('Asset category not found');
  }

  /**
   * The open assignment for an asset the register says is out.
   *
   * A 500 rather than a 400 if it is missing, deliberately: `status` and the
   * assignments are written in one transaction, so an ASSIGNED asset with no
   * open row is corruption, not a user mistake.
   */
  private async openAssignment(assetId: string) {
    const open = await this.prisma.assetAssignment.findFirst({
      where: { assetId, returnedOn: null },
    });
    if (!open) {
      throw new Error(`Asset ${assetId} is ASSIGNED with no open assignment`);
    }
    return open;
  }

  /** The fields a general edit may touch. Status is not among them. */
  private writable(input: AssetUpdateInput) {
    return {
      ...(input.serialNumber !== undefined ? { serialNumber: input.serialNumber } : {}),
      ...(input.make !== undefined ? { make: input.make } : {}),
      ...(input.model !== undefined ? { model: input.model } : {}),
      ...(input.condition !== undefined ? { condition: input.condition } : {}),
      ...(input.purchaseDate !== undefined
        ? { purchaseDate: input.purchaseDate ? toDate(input.purchaseDate) : null }
        : {}),
      ...(input.purchaseCost !== undefined ? { purchaseCost: input.purchaseCost } : {}),
      ...(input.warrantyEnd !== undefined
        ? { warrantyEnd: input.warrantyEnd ? toDate(input.warrantyEnd) : null }
        : {}),
      ...(input.vendor !== undefined ? { vendor: input.vendor } : {}),
      ...(input.locationId !== undefined ? { locationId: input.locationId } : {}),
      ...(input.notes !== undefined ? { notes: input.notes } : {}),
    };
  }

  private rethrowDuplicateTag = (err: unknown): never => {
    if ((err as { code?: string }).code === 'P2002') {
      throw new ConflictException('Another asset already has that tag');
    }
    throw err;
  };
}
