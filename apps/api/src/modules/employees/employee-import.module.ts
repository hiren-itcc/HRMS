import { Module } from '@nestjs/common';
import { OnboardingModule } from '../onboarding/onboarding.module';
import { EmployeeImportController } from './employee-import.controller';
import { EmployeeImportService } from './employee-import.service';
import { EmployeesModule } from './employees.module';

/**
 * Its own module, and not because import is grand enough to deserve one.
 *
 * It needs both `EmployeesService` and `OnboardingService`, and
 * `OnboardingModule` already imports `EmployeesModule` — so putting these
 * providers in `EmployeesModule` closes a cycle, and Nest says so immediately:
 * "the module at index [2] of the OnboardingModule imports array is undefined".
 *
 * `forwardRef()` on both sides would also work and would leave two modules
 * permanently entangled for one feature's benefit. A third module that imports
 * both and is imported by neither has no cycle to break.
 */
@Module({
  imports: [EmployeesModule, OnboardingModule],
  controllers: [EmployeeImportController],
  providers: [EmployeeImportService],
})
export class EmployeeImportModule {}
