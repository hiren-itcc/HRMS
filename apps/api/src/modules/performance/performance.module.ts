import { Module } from '@nestjs/common';
import { GoalsService } from './goals.service';
import { PerformanceController } from './performance.controller';
import { ReviewCyclesService } from './review-cycles.service';
import { ReviewsService } from './reviews.service';

/**
 * Goals, review cycles and reviews.
 *
 * `imports` is empty, and that is worth noticing rather than glossing over: no
 * shipped module here has managed it before. Expenses needed PayrollModule,
 * WFH needed SettingsModule, Recruitment needed OnboardingModule. This one
 * needs nothing but Prisma and notifications, and NotificationsModule is
 * global — so the roadmap's "new infra: none" holds in the strongest sense
 * available.
 */
@Module({
  controllers: [PerformanceController],
  providers: [ReviewCyclesService, GoalsService, ReviewsService],
})
export class PerformanceModule {}
