import type { Readable } from 'node:stream';

/**
 * Where file bytes actually live (ADR A3).
 *
 * `StorageService` owns *what* is stored — the key layout, the guards. An
 * adapter owns only *where*, so moving from a local disk to an object store is
 * one class and nothing that uploads a document.
 */
export interface StorageAdapter {
  /** Persists the bytes under `fileKey`. The key is chosen by the service. */
  put(fileKey: string, buffer: Buffer, contentType: string): Promise<void>;
  /**
   * Async, unlike the local-disk original — an object store is a network call.
   * The two callers already sit in async methods, and the controllers only
   * pass the result to `StreamableFile`, so nothing above this notices.
   */
  stream(fileKey: string): Promise<Readable>;
  /** Missing is not an error: removal is idempotent. */
  remove(fileKey: string): Promise<void>;
}

export const STORAGE_ADAPTER = Symbol('STORAGE_ADAPTER');
