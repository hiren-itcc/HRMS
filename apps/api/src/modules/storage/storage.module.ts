import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env';
import { LocalDiskStorage } from './local-disk.storage';
import { STORAGE_ADAPTER, type StorageAdapter } from './storage.adapter';
import { StorageService } from './storage.service';
import { SupabaseStorage } from './supabase.storage';

/**
 * Picks the backing store from configuration.
 *
 * Supabase when both credentials are present, local disk otherwise — the same
 * bargain the mail transport strikes, and for the same reason: a developer or
 * a CI run with no credentials and no network must still be able to exercise
 * the whole upload path.
 */
export function storageAdapterProvider() {
  return {
    provide: STORAGE_ADAPTER,
    inject: [ConfigService],
    useFactory: (config: ConfigService<Env, true>): StorageAdapter => {
      const url = config.get('SUPABASE_URL', { infer: true });
      const key = config.get('SUPABASE_SERVICE_ROLE_KEY', { infer: true });
      if (url && key) {
        return new SupabaseStorage(
          url,
          key,
          config.get('SUPABASE_STORAGE_BUCKET', { infer: true }),
        );
      }
      return new LocalDiskStorage(config.get('UPLOAD_DIR', { infer: true }));
    },
  };
}

/**
 * Global because two modules need it and both used to declare their own copy,
 * which meant Nest built two. Harmless while the class held a path string;
 * two Supabase clients is not what anyone intended.
 */
@Global()
@Module({
  providers: [storageAdapterProvider(), StorageService],
  exports: [StorageService, STORAGE_ADAPTER],
})
export class StorageModule {}
