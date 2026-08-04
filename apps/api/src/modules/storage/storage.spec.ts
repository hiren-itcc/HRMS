import { LocalDiskStorage } from './local-disk.storage';
import type { StorageAdapter } from './storage.adapter';
import { storageAdapterProvider } from './storage.module';
import { StorageService } from './storage.service';
import { SupabaseStorage } from './supabase.storage';

function pick(env: Record<string, string | undefined>) {
  const config = {
    get: jest.fn((key: string) => env[key] ?? defaults[key]),
  };
  // biome-ignore lint/suspicious/noExplicitAny: structural test double
  return storageAdapterProvider().useFactory(config as any);
}

const defaults: Record<string, string> = {
  UPLOAD_DIR: './uploads',
  SUPABASE_STORAGE_BUCKET: 'documents',
};

describe('choosing a backing store', () => {
  /*
   * The fallback is the point: a developer or a CI run with no credentials and
   * no network must still be able to exercise the whole upload path, which is
   * the same bargain the mail transport strikes.
   */
  it('uses local disk when Supabase is not configured', () => {
    expect(pick({})).toBeInstanceOf(LocalDiskStorage);
  });

  it('needs BOTH credentials — a url alone is not enough to try Supabase', () => {
    expect(pick({ SUPABASE_URL: 'https://x.supabase.co' })).toBeInstanceOf(LocalDiskStorage);
    expect(pick({ SUPABASE_SERVICE_ROLE_KEY: 'service-key' })).toBeInstanceOf(LocalDiskStorage);
  });

  it('uses Supabase once both are set', () => {
    const adapter = pick({
      SUPABASE_URL: 'https://x.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'service-key',
    });
    expect(adapter).toBeInstanceOf(SupabaseStorage);
  });
});

describe('StorageService key layout', () => {
  function make() {
    const adapter: StorageAdapter = {
      put: jest.fn().mockResolvedValue(undefined),
      stream: jest.fn(),
      remove: jest.fn().mockResolvedValue(undefined),
    };
    return { adapter, service: new StorageService(adapter) };
  }

  /*
   * The key lives in the service, not the adapter, so a document uploaded to
   * local disk is still found by the same key after the deployment moves to
   * an object store.
   */
  it('files under the org and keeps the extension', async () => {
    const { service, adapter } = make();
    const key = await service.put('org1', 'Aadhaar Card.PDF', Buffer.from('x'), 'application/pdf');

    expect(key).toMatch(/^org1\/[0-9a-f-]{36}\.pdf$/);
    expect(adapter.put).toHaveBeenCalledWith(key, expect.any(Buffer), 'application/pdf');
  });

  it('never reuses the uploaded filename, so two people can upload "pan.pdf"', async () => {
    const { service } = make();
    const a = await service.put('org1', 'pan.pdf', Buffer.from('a'), 'application/pdf');
    const b = await service.put('org1', 'pan.pdf', Buffer.from('b'), 'application/pdf');
    expect(a).not.toBe(b);
  });
});

describe('path traversal', () => {
  /*
   * Keys are server-generated, but they are read back out of the database
   * before being used, so both adapters check them on the way in.
   */
  it('local disk refuses a key that escapes the upload root', async () => {
    const local = new LocalDiskStorage('./uploads');
    await expect(local.stream('../../etc/passwd')).rejects.toThrow(/Invalid file key/);
    await expect(local.remove('../../etc/passwd')).rejects.toThrow(/Invalid file key/);
  });

  it('Supabase refuses the same', async () => {
    const supabase = new SupabaseStorage('https://x.supabase.co', 'service-key', 'documents');
    await expect(supabase.stream('../secrets')).rejects.toThrow(/Invalid file key/);
    await expect(supabase.remove('/absolute')).rejects.toThrow(/Invalid file key/);
  });
});
