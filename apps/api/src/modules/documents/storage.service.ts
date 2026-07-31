import { randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import { dirname, extname, join, resolve } from 'node:path';
import type { Readable } from 'node:stream';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env';

/**
 * Storage port (ADR A3). This local-disk adapter serves dev and
 * single-server deployments; an S3/MinIO adapter replaces it behind the
 * same three methods without touching callers.
 */
@Injectable()
export class StorageService {
  private readonly root: string;

  constructor(config: ConfigService<Env, true>) {
    this.root = resolve(config.get('UPLOAD_DIR', { infer: true }));
  }

  /** Persists a buffer and returns the opaque fileKey to store on the row. */
  async put(orgId: string, originalName: string, buffer: Buffer): Promise<string> {
    const key = join(orgId, `${randomUUID()}${extname(originalName).toLowerCase()}`);
    const path = join(this.root, key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, buffer);
    return key;
  }

  stream(fileKey: string): Readable {
    return createReadStream(this.resolveSafe(fileKey));
  }

  async remove(fileKey: string): Promise<void> {
    await unlink(this.resolveSafe(fileKey)).catch(() => undefined);
  }

  /** fileKey is server-generated, but never trust a path outside the root. */
  private resolveSafe(fileKey: string): string {
    const path = resolve(this.root, fileKey);
    if (!path.startsWith(this.root)) throw new Error('Invalid file key');
    return path;
  }
}
