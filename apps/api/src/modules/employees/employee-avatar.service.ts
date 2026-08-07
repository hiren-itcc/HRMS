import { createHash } from 'node:crypto';
import type { Readable } from 'node:stream';
import type { AccessTokenClaims } from '@hrms/types';
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { auditMutation } from '../../common/utils/audit';
import { PrismaService } from '../../database/prisma.service';
import { StorageService } from '../storage/storage.service';

/**
 * Profile photos.
 *
 * **The bytes go through the API, like every other file.** `supabase.storage.ts`
 * says the bucket is private and stays that way, because handing the browser a
 * public or signed URL routes around the one check that makes personnel files
 * private. A photo is the least private thing in here — the directory already
 * shows everyone's face to everyone — but that is a reason to make the *read*
 * gate wide, not a reason to open the bucket. So `avatarUrl` holds a path this
 * API serves rather than somewhere a CDN does.
 *
 * Its own file rather than four more methods on `EmployeesService`, which is
 * already seven hundred lines and has nothing to do with storage.
 */

/** Images only — a narrower list than documents accept, and the extension we store under. */
const AVATAR_MIME: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
};

/** Read back off the stored key, so the response declares what it actually holds. */
const MIME_BY_EXT: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  webp: 'image/webp',
};

/**
 * A photo is small even before the browser resizes it, and the picker sends a
 * ~40 KB WebP. Two megabytes is a generous ceiling for anything that got past
 * that path, and much tighter than the 10 MB documents allow — a limit that
 * exists for scans of contracts, not for faces.
 */
const MAX_AVATAR_BYTES = 2 * 1024 * 1024;

export interface UploadedImage {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

@Injectable()
export class EmployeeAvatarService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  /** The path the browser fetches, with a token that changes when the photo does. */
  private pathFor(employeeId: string, key: string): string {
    const version = createHash('sha256').update(key).digest('hex').slice(0, 8);
    return `/employees/${employeeId}/avatar?v=${version}`;
  }

  private async ensureExists(orgId: string, id: string) {
    const employee = await this.prisma.employee.findFirst({
      where: { id, organizationId: orgId, deletedAt: null },
      select: { id: true, avatarKey: true, firstName: true, lastName: true },
    });
    if (!employee) throw new NotFoundException('Employee not found');
    return employee;
  }

  /**
   * Whose record this is decides which permission is spent.
   *
   * Setting your own photo is `employee.update.own`, which every role holds;
   * setting somebody else's is `employee.update`, which is HR's. Deciding it
   * here rather than on the route means `/me/avatar` and
   * `/employees/:id/avatar` cannot drift apart — and that somebody holding only
   * the self permission cannot reach a colleague by knowing their id.
   */
  private assertMayWrite(claims: AccessTokenClaims, employeeId: string): void {
    const perms = new Set(claims.perms);
    const isSelf = claims.employeeId === employeeId;
    if (isSelf && perms.has('employee.update.own')) return;
    if (perms.has('employee.update')) return;
    throw new ForbiddenException(
      isSelf ? 'You cannot change your own photo' : "You cannot change somebody else's photo",
    );
  }

  private selfId(claims: AccessTokenClaims): string {
    if (!claims.employeeId) {
      throw new NotFoundException('No employee record linked to this account');
    }
    return claims.employeeId;
  }

  async setForSelf(claims: AccessTokenClaims, file: UploadedImage) {
    return this.set(claims, this.selfId(claims), file);
  }

  async removeForSelf(claims: AccessTokenClaims) {
    return this.remove(claims, this.selfId(claims));
  }

  async set(claims: AccessTokenClaims, employeeId: string, file: UploadedImage) {
    this.assertMayWrite(claims, employeeId);
    const employee = await this.ensureExists(claims.orgId, employeeId);

    const ext = AVATAR_MIME[file.mimetype];
    if (!ext) throw new BadRequestException('A photo has to be a PNG, JPEG or WebP image');
    if (file.size > MAX_AVATAR_BYTES) {
      throw new BadRequestException(
        `That image is too large — the limit is ${MAX_AVATAR_BYTES / 1024 / 1024} MB`,
      );
    }
    if (file.size === 0) throw new BadRequestException('That file is empty');

    /*
     * The name handed to storage is synthesized from the *validated* mimetype
     * rather than taken from the upload. The key's extension is what the read
     * route declares as the content type, so letting the client name the file
     * would let it choose that header.
     */
    const key = await this.storage.put(claims.orgId, `avatar.${ext}`, file.buffer, file.mimetype);

    const updated = await this.prisma.employee.update({
      where: { id: employeeId },
      data: { avatarKey: key, avatarUrl: this.pathFor(employeeId, key) },
      select: { id: true, avatarUrl: true },
    });

    // After the row is written, never before: an orphaned object costs a few
    // kilobytes, whereas deleting the old one first and then failing to write
    // the new key leaves a row pointing at bytes that are gone.
    await this.discard(employee.avatarKey);

    await auditMutation(
      this.prisma,
      { orgId: claims.orgId, userId: claims.sub },
      'employee.avatar.set',
      'Employee',
      employeeId,
    );
    return updated;
  }

  async remove(claims: AccessTokenClaims, employeeId: string) {
    this.assertMayWrite(claims, employeeId);
    const employee = await this.ensureExists(claims.orgId, employeeId);
    if (!employee.avatarKey) return { id: employeeId, avatarUrl: null };

    const updated = await this.prisma.employee.update({
      where: { id: employeeId },
      data: { avatarKey: null, avatarUrl: null },
      select: { id: true, avatarUrl: true },
    });
    await this.discard(employee.avatarKey);

    await auditMutation(
      this.prisma,
      { orgId: claims.orgId, userId: claims.sub },
      'employee.avatar.remove',
      'Employee',
      employeeId,
    );
    return updated;
  }

  /**
   * The bytes.
   *
   * Gated on `directory.read`, which every role holds, and that is the right
   * width: the directory and the org chart already show every colleague's face
   * to everybody. Gating on `employee.read` would leave photo-shaped holes in
   * both for ordinary staff.
   */
  async open(
    claims: AccessTokenClaims,
    employeeId: string,
  ): Promise<{ stream: Readable; mimeType: string }> {
    if (!new Set(claims.perms).has('directory.read')) {
      throw new ForbiddenException('You cannot see the directory');
    }
    const employee = await this.ensureExists(claims.orgId, employeeId);
    if (!employee.avatarKey) throw new NotFoundException('No photo');

    const ext = employee.avatarKey.split('.').pop() ?? '';
    return {
      stream: await this.storage.stream(employee.avatarKey),
      // Only ever one of three values, because the key's extension was
      // synthesized from a validated mimetype on the way in.
      mimeType: MIME_BY_EXT[ext] ?? 'application/octet-stream',
    };
  }

  /**
   * Removal is best-effort on purpose, matching the storage adapters' own
   * stance: a photo that has already gone from the bucket must not make
   * replacing it fail.
   */
  private async discard(key: string | null): Promise<void> {
    if (!key) return;
    try {
      await this.storage.remove(key);
    } catch {
      // Nothing to do about it and nothing depending on it.
    }
  }
}
