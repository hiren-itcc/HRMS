import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { SettlementsController } from './settlements.controller';
import { SettlementsService } from './settlements.service';

/**
 * No cycle here, unlike the resignation ↔ offboarding pair. A settlement reads
 * an offboarding through Prisma and never calls back into it: completion is
 * deliberately not gated on the settlement, because settlement routinely lands
 * weeks after the last working day and blocking the exit would mean somebody's
 * access stays open until Finance pays.
 */
@Module({
  imports: [AuditModule],
  controllers: [SettlementsController],
  providers: [SettlementsService],
  exports: [SettlementsService],
})
export class SettlementsModule {}
