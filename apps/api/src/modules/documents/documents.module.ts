import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MulterModule } from '@nestjs/platform-express';
import type { Env } from '../../config/env';
import { DocumentCategoriesService } from './document-categories.service';
import { DocumentsController } from './documents.controller';
import { DocumentsService } from './documents.service';
import { StorageService } from './storage.service';

/** Employee documents (docs/03-api-structure.md §documents) — local-disk storage adapter. */
@Module({
  imports: [
    // Hard cap at the multer layer so an oversized upload is rejected
    // while streaming, not after it has been buffered in memory.
    MulterModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        limits: { fileSize: config.get('MAX_UPLOAD_MB', { infer: true }) * 1024 * 1024 },
      }),
    }),
  ],
  controllers: [DocumentsController],
  providers: [DocumentsService, DocumentCategoriesService, StorageService],
})
export class DocumentsModule {}
