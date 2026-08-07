import { Module } from '@nestjs/common';
import { LifecycleModule } from '../lifecycle/lifecycle.module';
import { OnboardingModule } from '../onboarding/onboarding.module';
import { CareersController } from './careers.controller';
import { CareersService } from './careers.service';
import { RecruitmentController } from './recruitment.controller';
import { RecruitmentService } from './recruitment.service';

/**
 * `OnboardingModule` is imported for one reason: a hire is not a second way to
 * create an employee, it is the existing one. `OnboardingService.onboard`
 * already generates the employee code, writes the INVITED user with an
 * unusable password, creates the onboarding record and mails the invite to the
 * personal address. Reaching for it means none of that is duplicated here, and
 * nothing can drift out of step with the *Onboard a hire* screen.
 */
@Module({
  imports: [OnboardingModule, LifecycleModule],
  /*
   * `CareersController` is the public half and shares this module only because
   * it reads the same tables. It carries no `@ApiBearerAuth`, returns its own
   * mapped shape, and never touches `RecruitmentService`.
   */
  controllers: [RecruitmentController, CareersController],
  providers: [RecruitmentService, CareersService],
})
export class RecruitmentModule {}
