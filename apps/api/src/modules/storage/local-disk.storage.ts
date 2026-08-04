import { createReadStream } from 'node:fs';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import type { Readable } from 'node:stream';
import type { StorageAdapter } from './storage.adapter';

/**
 * The original local-disk implementation, moved here unchanged in behaviour.
 *
 * Still the default when no object store is configured: `pnpm dev` and CI need
 * neither credentials nor a network, and a developer who has not set anything
 * up should still be able to upload a file.
 *
 * Not suitable for a container whose filesystem is replaced on deploy — which
 * is precisely why the Supabase adapter exists.
 */
export class LocalDiskStorage implements StorageAdapter {
  private readonly root: string;

  constructor(uploadDir: string) {
    this.root = resolve(uploadDir);
  }

  async put(fileKey: string, buffer: Buffer, _contentType: string): Promise<void> {
    const path = join(this.root, fileKey);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, buffer);
  }

  async stream(fileKey: string): Promise<Readable> {
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
