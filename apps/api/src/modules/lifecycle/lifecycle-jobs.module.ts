import { Module } from '@nestjs/common';
import { OffboardingModule } from '../offboarding/offboarding.module';
import { LifecycleController } from './lifecycle.controller';
import { LifecycleModule } from './lifecycle.module';
import { LifecycleService } from './lifecycle.service';

/**
 * Separate from `LifecycleModule` on purpose.
 *
 * That one is policy and has no feature dependencies, which is what lets
 * Employees, Resignations and Offboarding all import it. This one *acts* on
 * the policy, so it depends on Offboarding — and if the two lived together,
 * Employees importing policy would drag the whole exit half of the app in
 * behind it and close a cycle.
 */
@Module({
  imports: [LifecycleModule, OffboardingModule],
  controllers: [LifecycleController],
  providers: [LifecycleService],
  exports: [LifecycleService],
})
export class LifecycleJobsModule {}
