import { Global, Module } from '@nestjs/common';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';

/**
 * Global, for the reason SettingsModule is: resignations, offboarding,
 * lifecycle and leave all need to tell somebody something, and importing this
 * into each would be four copies of the same wiring (docs/08).
 *
 * It also has to sit at the bottom of the graph. Anything that notifies is
 * something this could not depend on without closing a cycle — and it depends
 * on nothing but Prisma.
 */
@Global()
@Module({
  controllers: [NotificationsController],
  providers: [NotificationsService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
