import { Module } from '@nestjs/common';
import { WfhController } from './wfh.controller';
import { WfhService } from './wfh.service';

/**
 * Exported because attendance asks it one question — which employee-days were
 * agreed in advance — to flag a remote day nobody approved.
 *
 * The dependency runs `Attendance → WFH` only. Nothing here reads attendance:
 * whether somebody actually worked from home is not this module's business,
 * and never checking means no write path is coupled to a permission.
 */
@Module({
  controllers: [WfhController],
  providers: [WfhService],
  exports: [WfhService],
})
export class WfhModule {}
