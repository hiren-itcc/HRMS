import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { EmployeesModule } from '../employees/employees.module';
import { LifecycleModule } from '../lifecycle/lifecycle.module';
import { MailModule } from '../mail/mail.module';
import { MyOnboardingController, OnboardingController } from './onboarding.controller';
import { OnboardingService } from './onboarding.service';

@Module({
  imports: [AuthModule, MailModule, EmployeesModule, LifecycleModule],
  controllers: [OnboardingController, MyOnboardingController],
  providers: [OnboardingService],
})
export class OnboardingModule {}
