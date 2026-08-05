import { Module } from '@nestjs/common';
import { EmploymentTransitionService } from './employment-transition.service';
import { LifecyclePolicyService } from './lifecycle-policy.service';

/**
 * Policy, and nothing that acts on it.
 *
 * Employees, resignations and offboarding all import this; it imports none of
 * them. Keeping it at the bottom of the graph is what lets the daily tick —
 * which does need all three — exist without a `forwardRef` anywhere.
 * SettingsModule is `@Global`, so there is nothing to import here.
 */
@Module({
  providers: [LifecyclePolicyService, EmploymentTransitionService],
  exports: [LifecyclePolicyService, EmploymentTransitionService],
})
export class LifecycleModule {}
