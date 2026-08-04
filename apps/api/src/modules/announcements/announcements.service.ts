import type {
  AnnouncementCreateInput,
  AnnouncementQuery,
  AnnouncementUpdateInput,
} from '@hrms/shared';
import type { AccessTokenClaims } from '@hrms/types';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { auditMutation } from '../../common/utils/audit';
import { toPaginated } from '../../common/utils/list-query';
import type { Env } from '../../config/env';
import { PrismaService } from '../../database/prisma.service';
import type { Prisma } from '../../generated/prisma/client';
import { ALLOWED_MIME } from '../documents/documents.service';
import { StorageService } from '../storage/storage.service';
import { isVisibleTo } from './announcements.util';

const INCLUDE = {
  attachments: {
    select: { id: true, name: true, mimeType: true, sizeBytes: true },
    orderBy: { createdAt: 'asc' },
  },
  _count: { select: { reads: true } },
} as const;

/*
 * What `toDto` reads, rather than one specific Prisma include — list and
 * detail queries pass different shapes, which is what `any` was hiding. The
 * optional members are the ones only some queries include.
 */
interface AnnouncementRow {
  id: string;
  title: string;
  body: string;
  category: string;
  priority: string;
  audience: string;
  departmentId: string | null;
  locationId: string | null;
  isPinned: boolean;
  publishAt: Date;
  expiresAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  authorId: string;
  attachments?: unknown[];
  reads?: unknown[];
  _count?: { reads: number };
}

interface AuthorRow {
  email: string;
  employee: { firstName: string; lastName: string; avatarUrl: string | null } | null;
}

@Injectable()
export class AnnouncementsService {
  private readonly maxBytes: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    config: ConfigService<Env, true>,
  ) {
    this.maxBytes = config.get('MAX_UPLOAD_MB', { infer: true }) * 1024 * 1024;
  }

  /** Where the viewer sits in the org — drives audience targeting. */
  private async viewerContext(claims: AccessTokenClaims) {
    if (!claims.employeeId) return { departmentId: null, locationId: null };
    const employee = await this.prisma.employee.findFirst({
      where: { id: claims.employeeId },
      select: { departmentId: true, locationId: true },
    });
    return {
      departmentId: employee?.departmentId ?? null,
      locationId: employee?.locationId ?? null,
    };
  }

  /**
   * Audience targeting and the publish window are enforced in the query,
   * not just the UI — an off-target post never reaches the client.
   */
  private audienceWhere(
    viewer: { departmentId: string | null; locationId: string | null },
    now: Date,
  ): Prisma.AnnouncementWhereInput {
    return {
      publishAt: { lte: now },
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      AND: [
        {
          OR: [
            { audience: 'ALL' },
            ...(viewer.departmentId
              ? [{ audience: 'DEPARTMENT' as const, departmentId: viewer.departmentId }]
              : []),
            ...(viewer.locationId
              ? [{ audience: 'LOCATION' as const, locationId: viewer.locationId }]
              : []),
          ],
        },
      ],
    };
  }

  async list(claims: AccessTokenClaims, query: AnnouncementQuery) {
    const canManage = new Set(claims.perms).has('announcement.manage');
    const viewer = await this.viewerContext(claims);
    const now = new Date();

    const where: Prisma.AnnouncementWhereInput = {
      organizationId: claims.orgId,
      // Managers see drafts and every audience so they can review their own work
      ...(canManage ? {} : this.audienceWhere(viewer, now)),
      ...(query.category ? { category: query.category } : {}),
      ...(query.priority ? { priority: query.priority } : {}),
      ...(query.filter === 'pinned' ? { isPinned: true } : {}),
      ...(query.filter === 'mine' ? { authorId: claims.sub } : {}),
      ...(query.filter === 'unread' ? { reads: { none: { userId: claims.sub } } } : {}),
      ...(query.search
        ? {
            OR: [
              { title: { contains: query.search, mode: 'insensitive' as const } },
              { body: { contains: query.search, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    };

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.announcement.findMany({
        where,
        include: {
          ...INCLUDE,
          reads: { where: { userId: claims.sub }, select: { readAt: true } },
        },
        orderBy: [{ isPinned: 'desc' }, { publishAt: 'desc' }],
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      this.prisma.announcement.count({ where }),
    ]);

    const authors = await this.authorNames(rows.map((r) => r.authorId));
    return toPaginated(
      rows.map((r) => this.toDto(r, authors, now)),
      total,
      query,
    );
  }

  /** Badge count for the header/dashboard. */
  async unreadCount(claims: AccessTokenClaims) {
    const viewer = await this.viewerContext(claims);
    const count = await this.prisma.announcement.count({
      where: {
        organizationId: claims.orgId,
        ...this.audienceWhere(viewer, new Date()),
        reads: { none: { userId: claims.sub } },
      },
    });
    return { unread: count };
  }

  async detail(claims: AccessTokenClaims, id: string) {
    const canManage = new Set(claims.perms).has('announcement.manage');
    const row = await this.prisma.announcement.findFirst({
      where: { id, organizationId: claims.orgId },
      include: { ...INCLUDE, reads: { where: { userId: claims.sub }, select: { readAt: true } } },
    });
    if (!row) throw new NotFoundException('Announcement not found');

    const viewer = await this.viewerContext(claims);
    if (!isVisibleTo(row, viewer, new Date(), canManage)) {
      throw new NotFoundException('Announcement not found');
    }
    const authors = await this.authorNames([row.authorId]);
    return this.toDto(row, authors, new Date());
  }

  async create(claims: AccessTokenClaims, input: AnnouncementCreateInput) {
    await this.validateTargets(claims.orgId, input);
    const row = await this.prisma.announcement.create({
      data: {
        organizationId: claims.orgId,
        authorId: claims.sub,
        title: input.title,
        body: input.body,
        category: input.category,
        priority: input.priority,
        audience: input.audience,
        departmentId: input.audience === 'DEPARTMENT' ? (input.departmentId ?? null) : null,
        locationId: input.audience === 'LOCATION' ? (input.locationId ?? null) : null,
        isPinned: input.isPinned,
        publishAt: input.publishAt ? new Date(input.publishAt) : new Date(),
        expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
      },
      include: { ...INCLUDE, reads: true },
    });
    await auditMutation(
      this.prisma,
      { orgId: claims.orgId, userId: claims.sub },
      'announcement.create',
      'Announcement',
      row.id,
    );
    return this.toDto(row, await this.authorNames([row.authorId]), new Date());
  }

  async update(claims: AccessTokenClaims, id: string, input: AnnouncementUpdateInput) {
    const existing = await this.ensureExists(claims.orgId, id);
    const audience = input.audience ?? existing.audience;
    const departmentId = input.departmentId ?? existing.departmentId;
    const locationId = input.locationId ?? existing.locationId;

    // Re-check the cross-field rules the create schema enforces
    if (audience === 'DEPARTMENT' && !departmentId) {
      throw new BadRequestException('Choose the department this is for');
    }
    if (audience === 'LOCATION' && !locationId) {
      throw new BadRequestException('Choose the location this is for');
    }
    await this.validateTargets(claims.orgId, { departmentId, locationId });

    const row = await this.prisma.announcement.update({
      where: { id },
      data: {
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.body !== undefined ? { body: input.body } : {}),
        ...(input.category !== undefined ? { category: input.category } : {}),
        ...(input.priority !== undefined ? { priority: input.priority } : {}),
        ...(input.isPinned !== undefined ? { isPinned: input.isPinned } : {}),
        ...(input.publishAt ? { publishAt: new Date(input.publishAt) } : {}),
        ...(input.expiresAt !== undefined
          ? { expiresAt: input.expiresAt ? new Date(input.expiresAt) : null }
          : {}),
        audience,
        departmentId: audience === 'DEPARTMENT' ? departmentId : null,
        locationId: audience === 'LOCATION' ? locationId : null,
      },
      include: { ...INCLUDE, reads: { where: { userId: claims.sub }, select: { readAt: true } } },
    });
    await auditMutation(
      this.prisma,
      { orgId: claims.orgId, userId: claims.sub },
      'announcement.update',
      'Announcement',
      id,
    );
    return this.toDto(row, await this.authorNames([row.authorId]), new Date());
  }

  /** Hard delete — attachments cascade, and stored files are cleaned up. */
  async remove(claims: AccessTokenClaims, id: string) {
    await this.ensureExists(claims.orgId, id);
    const attachments = await this.prisma.announcementAttachment.findMany({
      where: { announcementId: id },
      select: { fileKey: true },
    });
    await this.prisma.announcement.delete({ where: { id } });
    await Promise.all(attachments.map((a) => this.storage.remove(a.fileKey)));
    await auditMutation(
      this.prisma,
      { orgId: claims.orgId, userId: claims.sub },
      'announcement.delete',
      'Announcement',
      id,
    );
  }

  async markRead(claims: AccessTokenClaims, id: string) {
    await this.detail(claims, id); // enforces visibility before recording a read
    await this.prisma.announcementRead.upsert({
      where: { announcementId_userId: { announcementId: id, userId: claims.sub } },
      update: {},
      create: { announcementId: id, userId: claims.sub },
    });
  }

  async markAllRead(claims: AccessTokenClaims) {
    const viewer = await this.viewerContext(claims);
    const visible = await this.prisma.announcement.findMany({
      where: {
        organizationId: claims.orgId,
        ...this.audienceWhere(viewer, new Date()),
        reads: { none: { userId: claims.sub } },
      },
      select: { id: true },
    });
    if (visible.length === 0) return { marked: 0 };
    await this.prisma.announcementRead.createMany({
      data: visible.map((a) => ({ announcementId: a.id, userId: claims.sub })),
      skipDuplicates: true,
    });
    return { marked: visible.length };
  }

  /** Read receipts for the author — who has seen this post. */
  async reads(claims: AccessTokenClaims, id: string) {
    await this.ensureExists(claims.orgId, id);
    const reads = await this.prisma.announcementRead.findMany({
      where: { announcementId: id },
      orderBy: { readAt: 'desc' },
    });
    const users = await this.prisma.user.findMany({
      where: { id: { in: reads.map((r) => r.userId) } },
      select: {
        id: true,
        email: true,
        employee: { select: { firstName: true, lastName: true } },
      },
    });
    const byId = new Map(users.map((u) => [u.id, u]));
    return reads.map((r) => {
      const user = byId.get(r.userId);
      return {
        userId: r.userId,
        readAt: r.readAt,
        name: user?.employee
          ? `${user.employee.firstName} ${user.employee.lastName}`
          : (user?.email ?? 'Unknown'),
        email: user?.email ?? null,
      };
    });
  }

  // ── attachments ───────────────────────────────────────────────────────

  async addAttachment(
    claims: AccessTokenClaims,
    id: string,
    file: { originalname: string; mimetype: string; size: number; buffer: Buffer },
  ) {
    await this.ensureExists(claims.orgId, id);
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
    const row = await this.prisma.announcementAttachment.create({
      data: {
        announcementId: id,
        name: file.originalname,
        fileKey,
        mimeType: file.mimetype,
        sizeBytes: file.size,
      },
      select: { id: true, name: true, mimeType: true, sizeBytes: true },
    });
    await auditMutation(
      this.prisma,
      { orgId: claims.orgId, userId: claims.sub },
      'announcement.attachment.add',
      'AnnouncementAttachment',
      row.id,
    );
    return row;
  }

  async removeAttachment(claims: AccessTokenClaims, attachmentId: string) {
    const attachment = await this.prisma.announcementAttachment.findFirst({
      where: { id: attachmentId, announcement: { organizationId: claims.orgId } },
    });
    if (!attachment) throw new NotFoundException('Attachment not found');
    await this.prisma.announcementAttachment.delete({ where: { id: attachmentId } });
    await this.storage.remove(attachment.fileKey);
    await auditMutation(
      this.prisma,
      { orgId: claims.orgId, userId: claims.sub },
      'announcement.attachment.remove',
      'AnnouncementAttachment',
      attachmentId,
    );
  }

  /** Anyone who can see the announcement can fetch its attachments. */
  async openAttachment(claims: AccessTokenClaims, attachmentId: string) {
    const attachment = await this.prisma.announcementAttachment.findFirst({
      where: { id: attachmentId, announcement: { organizationId: claims.orgId } },
    });
    if (!attachment) throw new NotFoundException('Attachment not found');
    await this.detail(claims, attachment.announcementId);
    return { attachment, stream: await this.storage.stream(attachment.fileKey) };
  }

  // ── helpers ───────────────────────────────────────────────────────────

  private async ensureExists(orgId: string, id: string) {
    const found = await this.prisma.announcement.findFirst({
      where: { id, organizationId: orgId },
    });
    if (!found) throw new NotFoundException('Announcement not found');
    return found;
  }

  private async validateTargets(
    orgId: string,
    input: { departmentId?: string | null; locationId?: string | null },
  ) {
    if (input.departmentId) {
      const dept = await this.prisma.department.findFirst({
        where: { id: input.departmentId, organizationId: orgId },
      });
      if (!dept) throw new NotFoundException('Department not found');
    }
    if (input.locationId) {
      const loc = await this.prisma.location.findFirst({
        where: { id: input.locationId, organizationId: orgId },
      });
      if (!loc) throw new NotFoundException('Location not found');
    }
  }

  private async authorNames(ids: string[]) {
    const users = await this.prisma.user.findMany({
      where: { id: { in: [...new Set(ids)] } },
      select: {
        id: true,
        email: true,
        employee: { select: { firstName: true, lastName: true, avatarUrl: true } },
      },
    });
    return new Map(users.map((u) => [u.id, u]));
  }

  private toDto(row: AnnouncementRow, authors: Map<string, AuthorRow>, now: Date) {
    const author = authors.get(row.authorId);
    return {
      id: row.id,
      title: row.title,
      body: row.body,
      category: row.category,
      priority: row.priority,
      audience: row.audience,
      departmentId: row.departmentId,
      locationId: row.locationId,
      isPinned: row.isPinned,
      publishAt: row.publishAt,
      expiresAt: row.expiresAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      attachments: row.attachments ?? [],
      readCount: row._count?.reads ?? 0,
      isRead: Array.isArray(row.reads) ? row.reads.length > 0 : false,
      /** Not yet published — only managers ever see these. */
      isScheduled: row.publishAt > now,
      isExpired: row.expiresAt !== null && row.expiresAt <= now,
      author: {
        id: row.authorId,
        name: author?.employee
          ? `${author.employee.firstName} ${author.employee.lastName}`
          : (author?.email ?? 'Unknown'),
        avatarUrl: author?.employee?.avatarUrl ?? null,
      },
    };
  }
}
