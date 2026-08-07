import { Readable } from 'node:stream';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { StorageAdapter } from './storage.adapter';

/**
 * Supabase Storage, on the same project that already holds Postgres.
 *
 * The bucket is private and stays that way. Every read goes through the API so
 * `ensureEmployeeAccess` still decides who may see a document; handing the
 * browser a public or signed URL would route around the one check that makes
 * personnel files private. That is also why this uses the `service_role` key,
 * which must never be shipped to the web app.
 */
export class SupabaseStorage implements StorageAdapter {
  private readonly client: SupabaseClient;

  constructor(
    url: string,
    serviceRoleKey: string,
    private readonly bucket: string,
  ) {
    this.client = createClient(url, serviceRoleKey, {
      // No session to persist or refresh: this is a server holding a static
      // service key, not a user agent.
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }

  async put(fileKey: string, buffer: Buffer, contentType: string): Promise<void> {
    const { error } = await this.client.storage
      .from(this.bucket)
      .upload(assertSafe(fileKey), buffer, { contentType, upsert: false });
    // The SDK resolves with { data, error } rather than throwing, so without
    // this check a failed upload would leave a Document row pointing at
    // nothing and report success.
    if (error) throw new Error(`Could not store the file: ${error.message}`);
  }

  async stream(fileKey: string): Promise<Readable> {
    const { data, error } = await this.client.storage
      .from(this.bucket)
      .download(assertSafe(fileKey));
    if (error || !data) throw new Error(`Could not read the file: ${error?.message ?? 'missing'}`);

    // `download` resolves a web Blob; the controllers hand a Node Readable to
    // StreamableFile. Converting from the Blob's stream keeps it streaming
    // rather than buffering the whole file to pass it on.
    return Readable.fromWeb(data.stream() as Parameters<typeof Readable.fromWeb>[0]);
  }

  async remove(fileKey: string): Promise<void> {
    // Deliberately not throwing: removal is idempotent here, matching the
    // local adapter, and an announcement delete must not fail because its
    // attachment was already gone.
    await this.client.storage.from(this.bucket).remove([assertSafe(fileKey)]);
  }
}

/**
 * The object-store equivalent of the local adapter's path-traversal guard.
 * Keys are server-generated, but they are read back out of the database before
 * being used, so they are checked on the way in either way.
 */
function assertSafe(fileKey: string): string {
  if (fileKey.includes('..') || fileKey.startsWith('/')) throw new Error('Invalid file key');
  return fileKey;
}
