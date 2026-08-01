import { Module } from '@nestjs/common';
import { AuditController } from './audit.controller';
import { AuditService } from './audit.service';

/** Read-only view over the AuditLog rows every other module writes. */
@Module({
  controllers: [AuditController],
  providers: [AuditService],
})
export class AuditModule {}
