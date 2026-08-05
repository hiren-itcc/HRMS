import { Module } from '@nestjs/common';
import { LifecycleModule } from '../lifecycle/lifecycle.module';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';

/**
 * The landing page's backend.
 *
 * Imports `LifecycleModule` for one thing only — `contextFor`, which resolves
 * what today is in the organization's timezone. Everything else it counts, it
 * counts through Prisma directly rather than importing five services to ask
 * each for a number, which is the same call `SettlementsService` makes when it
 * reads `Offboarding`.
 */
@Module({
  imports: [LifecycleModule],
  controllers: [DashboardController],
  providers: [DashboardService],
})
export class DashboardModule {}
