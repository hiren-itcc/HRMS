import { Module } from '@nestjs/common';
import { LeaveController } from './leave.controller';
import { LeaveBalancesService } from './leave-balances.service';
import { LeaveRequestsService } from './leave-requests.service';
import { LeaveTypesService } from './leave-types.service';

/** Leave management (docs/03-api-structure.md §leave). */
@Module({
  controllers: [LeaveController],
  providers: [LeaveTypesService, LeaveBalancesService, LeaveRequestsService],
  exports: [LeaveRequestsService],
})
export class LeaveModule {}
