import { Module } from '@nestjs/common';
import { MailModule } from '../mail/mail.module';
import { LeaveController } from './leave.controller';
import { LeaveBalancesService } from './leave-balances.service';
import { LeaveRequestsService } from './leave-requests.service';
import { LeaveTypesService } from './leave-types.service';

/**
 * Leave management (docs/03-api-structure.md §leave).
 *
 * `MailModule` is imported for the leave-specific approve/decline templates.
 * `NotificationsModule` is not — it is `@Global`.
 */
@Module({
  imports: [MailModule],
  controllers: [LeaveController],
  providers: [LeaveTypesService, LeaveBalancesService, LeaveRequestsService],
  exports: [LeaveRequestsService],
})
export class LeaveModule {}
