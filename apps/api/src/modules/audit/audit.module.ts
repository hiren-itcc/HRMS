import { Module } from '@nestjs/common';
import { AuditController } from './audit.controller';
import { AuditService } from './audit.service';

/**
 * Read-only view over the AuditLog rows every other module writes.
 *
 * Exported so a module can serve the trail for one of *its* records to
 * somebody who does not hold `audit.read`. Writes still go through
 * `auditMutation`; nothing here can create a row.
 */
@Module({
  controllers: [AuditController],
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditModule {}
