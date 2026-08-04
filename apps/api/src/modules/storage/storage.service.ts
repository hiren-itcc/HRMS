import { randomUUID } from 'node:crypto';
import { extname } from 'node:path';
import type { Readable } from 'node:stream';
import { Inject, Injectable } from '@nestjs/common';
import { STORAGE_ADAPTER, type StorageAdapter } from './storage.adapter';

/**
 * Storage port (ADR A3).
 *
 * This owns the key layout — every caller treats `fileKey` as opaque — and
 * delegates the bytes to whichever adapter is configured. Keeping the key here
 * rather than in the adapter is what lets a document uploaded to local disk
 * still be found after the deployment moves to an object store: the key
 * written on the row means the same thing to both.
 */
@Injectable()
export class StorageService {
  constructor(@Inject(STORAGE_ADAPTER) private readonly adapter: StorageAdapter) {}

  /** Persists a buffer and returns the opaque fileKey to store on the row. */
  async put(
    orgId: string,
    originalName: string,
    buffer: Buffer,
    contentType = 'application/octet-stream',
  ): Promise<string> {
    // `orgId/<uuid><ext>` — the org prefix is a per-tenant folder in either
    // backend, and the uuid means an uploaded name can never collide or
    // smuggle a path.
    const key = `${orgId}/${randomUUID()}${extname(originalName).toLowerCase()}`;
    await this.adapter.put(key, buffer, contentType);
    return key;
  }

  stream(fileKey: string): Promise<Readable> {
    return this.adapter.stream(fileKey);
  }

  remove(fileKey: string): Promise<void> {
    return this.adapter.remove(fileKey);
  }
}
