import { Module } from '@nestjs/common';
import { HelpdeskController } from './helpdesk.controller';
import { TicketCategoriesService } from './ticket-categories.service';
import { TicketsService } from './tickets.service';

/**
 * `imports: []`, like the performance module beside it.
 *
 * Nothing is needed here: `NotificationsModule` and `StorageModule` are both
 * `@Global`, and the notifications module's own header explains why it has to
 * be — it sits at the bottom of the graph, because anything that notifies is
 * something it could not depend on without closing a cycle. The helpdesk
 * notifies, so the helpdesk is above it.
 *
 * `MailModule` is deliberately not imported either. Mail goes out through
 * `notify()`, which already respects the recipient's preference and the
 * organization's template switch; reaching for the transport directly would
 * skip both.
 */
@Module({
  controllers: [HelpdeskController],
  providers: [TicketsService, TicketCategoriesService],
  exports: [TicketsService],
})
export class HelpdeskModule {}
