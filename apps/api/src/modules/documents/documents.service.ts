import type { DocumentAdminQuery } from '@hrms/shared';
import type { AccessTokenClaims } from '@hrms/types';
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { auditMutation } from '../../common/utils/audit';
import { toPaginated } from '../../common/utils/list-query';
import type { Env } from '../../config/env';
import { PrismaService } from '../../database/prisma.service';
import type { Prisma } from '../../generated/prisma/client';
import { StorageService } from '../storage/storage.service';
import { DocumentCategoriesService } from './document-categories.service';

/** Whitelist per the module spec: PDF, DOCX, images. */
export const ALLOWED_MIME: Record<string, string> = {
  'application/pdf': 'PDF',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'DOCX',
  'image/png': 'Image',
  'image/jpeg': 'Image',
  'image/webp': 'Image',
};

const LIST_SELECT = {
  id: true,
  name: true,
  mimeType: true,
  sizeBytes: true,
  uploadedById: true,
  createdAt: true,
  categoryId: true,
  category: { select: { id: true, name: true } },
} as const;

/** The org-wide list needs the owner too — that is the column it is read by. */
const ADMIN_SELECT = {
  employeeId: true,
  employee: {
    select: { id: true, firstName: true, lastName: true, employeeCode: true },
  },
} as const;

@Injectable()
export class DocumentsService {
  private readonly maxBytes: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly categories: DocumentCategoriesService,
    config: ConfigService<Env, true>,
  ) {
    this.maxBytes = config.get('MAX_UPLOAD_MB', { infer: true }) * 1024 * 1024;
  }

  async listForEmployee(
    claims: AccessTokenClaims,
    employeeId: string,
    query: { categoryId?: string; search?: string } = {},
  ) {
    await this.ensureEmployeeAccess(claims, employeeId, 'read');
    return this.prisma.document.findMany({
      where: {
        employeeId,
        organizationId: claims.orgId,
        deletedAt: null,
        ...(query.categoryId ? { categoryId: query.categoryId } : {}),
        ...(query.search ? { name: { contains: query.search, mode: 'insensitive' as const } } : {}),
      },
      select: LIST_SELECT,
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * The org-wide list behind `document.read` — the one document query whose
   * scope the guard can settle on its own, because it is not asked about a
   * particular employee. `.own` and `.team` holders are refused by the guard
   * rather than silently narrowed: a team-scoped answer to "show me every
   * document" would be a different question wearing the same name.
   */
  async listAll(claims: AccessTokenClaims, query: DocumentAdminQuery) {
    const where: Prisma.DocumentWhereInput = {
      organizationId: claims.orgId,
      deletedAt: null,
      // Generated letters and company files have no employee; this list is
      // about personnel files, and the employee column would be empty.
      employeeId: query.employeeId ?? { not: null },
      ...(query.categoryId ? { categoryId: query.categoryId } : {}),
      ...(query.search ? { name: { contains: query.search, mode: 'insensitive' as const } } : {}),
    };
    const [data, total] = await this.prisma.$transaction([
      this.prisma.document.findMany({
        where,
        select: { ...LIST_SELECT, ...ADMIN_SELECT },
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      this.prisma.document.count({ where }),
    ]);
    return toPaginated(data, total, query);
  }

  async upload(
    claims: AccessTokenClaims,
    employeeId: string,
    file: { originalname: string; mimetype: string; size: number; buffer: Buffer },
    categoryId?: string,
  ) {
    await this.ensureEmployeeAccess(claims, employeeId, 'upload');
    if (categoryId) await this.categories.assertBelongs(claims.orgId, categoryId);

    if (!ALLOWED_MIME[file.mimetype]) {
      throw new BadRequestException('Only PDF, DOCX and PNG/JPEG/WebP images are allowed');
    }
    if (file.size > this.maxBytes) {
      throw new BadRequestException(
        `File is too large — the limit is ${Math.round(this.maxBytes / 1024 / 1024)} MB`,
      );
    }

    const fileKey = await this.storage.put(
      claims.orgId,
      file.originalname,
      file.buffer,
      file.mimetype,
    );
    const doc = await this.prisma.document.create({
      data: {
        organizationId: claims.orgId,
        employeeId,
        name: file.originalname,
        fileKey,
        mimeType: file.mimetype,
        sizeBytes: file.size,
        uploadedById: claims.sub,
        categoryId: categoryId ?? null,
      },
      select: LIST_SELECT,
    });
    await auditMutation(
      this.prisma,
      { orgId: claims.orgId, userId: claims.sub },
      'document.upload',
      'Document',
      doc.id,
    );
    return doc;
  }

  /** Returns the row + a stream for the file content (auth already applied). */
  async openFile(claims: AccessTokenClaims, id: string) {
    const doc = await this.prisma.document.findFirst({
      where: { id, organizationId: claims.orgId, deletedAt: null },
    });
    if (!doc?.employeeId) throw new NotFoundException('Document not found');
    if (!(await this.readableAsReceipt(claims, id))) {
      await this.ensureEmployeeAccess(claims, doc.employeeId, 'read');
    }
    // Awaited now that reading may be a network call; the controller still
    // just hands this to StreamableFile.
    return { doc, stream: await this.storage.stream(doc.fileKey) };
  }

  /**
   * A receipt is part of the claim it evidences, so whoever may read the claim
   * may open the file. The rule is `ExpensesService.readable`'s, mirrored:
   * the claimant, `expense.read`, or a team scope over the claimant.
   *
   * Without this, Finance — who approves every claim in the organization but
   * holds only `document.read.own` — got a 403 on the very receipt it was
   * being asked to approve, because the file belongs to the claimant and the
   * employee-record gate below knows nothing about claims. Widening Finance to
   * `document.read` instead would have opened the whole HR record (ID proofs,
   * bank details) to a role whose question is only "was this spent".
   */
  private async readableAsReceipt(claims: AccessTokenClaims, documentId: string) {
    const item = await this.prisma.expenseItem.findFirst({
      where: { receiptId: documentId, claim: { organizationId: claims.orgId } },
      select: { claim: { select: { employeeId: true } } },
    });
    if (!item) return false;

    const perms = new Set(claims.perms);
    if (item.claim.employeeId === claims.employeeId) return true;
    if (perms.has('expense.read')) return true;

    if (perms.has('expense.read.team') || perms.has('expense.approve.team')) {
      const managed = await this.prisma.employee.findFirst({
        where: { id: item.claim.employeeId, managerId: claims.employeeId ?? '__none__' },
        select: { id: true },
      });
      if (managed) return true;
    }
    return false;
  }

  /** Refiles a document into another folder (or out of all folders). */
  async move(claims: AccessTokenClaims, id: string, categoryId: string | null) {
    const doc = await this.prisma.document.findFirst({
      where: { id, organizationId: claims.orgId, deletedAt: null },
    });
    if (!doc?.employeeId) throw new NotFoundException('Document not found');
    await this.ensureEmployeeAccess(claims, doc.employeeId, 'upload');
    if (categoryId) await this.categories.assertBelongs(claims.orgId, categoryId);

    const updated = await this.prisma.document.update({
      where: { id },
      data: { categoryId },
      select: LIST_SELECT,
    });
    await auditMutation(
      this.prisma,
      { orgId: claims.orgId, userId: claims.sub },
      'document.move',
      'Document',
      id,
    );
    return updated;
  }

  /** Soft delete; file bytes stay for the audit trail (schema principle 3). */
  async remove(claims: AccessTokenClaims, id: string) {
    const doc = await this.prisma.document.findFirst({
      where: { id, organizationId: claims.orgId, deletedAt: null },
    });
    if (!doc) throw new NotFoundException('Document not found');

    const perms = new Set(claims.perms);
    const isOwnUpload = doc.employeeId === claims.employeeId && doc.uploadedById === claims.sub;
    if (!perms.has('document.manage') && !isOwnUpload) {
      throw new ForbiddenException('You cannot delete this document');
    }

    await this.prisma.document.update({ where: { id }, data: { deletedAt: new Date() } });
    await auditMutation(
      this.prisma,
      { orgId: claims.orgId, userId: claims.sub },
      'document.delete',
      'Document',
      id,
    );
  }

  /** Public wrapper so sibling endpoints (folders) enforce the same rule. */
  async assertCanReadEmployeeDocuments(claims: AccessTokenClaims, employeeId: string) {
    await this.ensureEmployeeAccess(claims, employeeId, 'read');
  }

  /**
   * Access matrix (docs/04-rbac.md): org-wide document.read/upload;
   * .team for the employee's direct manager; .own for the employee.
   */
  private async ensureEmployeeAccess(
    claims: AccessTokenClaims,
    employeeId: string,
    action: 'read' | 'upload',
  ) {
    const employee = await this.prisma.employee.findFirst({
      where: { id: employeeId, organizationId: claims.orgId, deletedAt: null },
      select: { managerId: true },
    });
    if (!employee) throw new NotFoundException('Employee not found');

    const perms = new Set(claims.perms);
    const isSelf = claims.employeeId === employeeId;
    const isTeam = employee.managerId != null && employee.managerId === claims.employeeId;

    const allowed =
      perms.has(`document.${action}`) ||
      (isSelf && perms.has(`document.${action}.own`)) ||
      (action === 'read' && isTeam && perms.has('document.read.team'));
    if (!allowed) throw new ForbiddenException('You cannot access these documents');
  }
}
