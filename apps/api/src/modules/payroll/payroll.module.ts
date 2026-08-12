import { Module } from '@nestjs/common';
import { SettingsModule } from '../settings/settings.module';
import { EmployeeSalariesService } from './employee-salaries.service';
import { PayComponentsController } from './pay-components.controller';
import { PayComponentsService } from './pay-components.service';
import { PayrollController } from './payroll.controller';
import { PayrollAdjustmentsService } from './payroll-adjustments.service';
import { PayrollReportsService } from './payroll-reports.service';
import { PayrollRunsService } from './payroll-runs.service';
import { PayslipsService } from './payslips.service';
import { SalaryStructuresService } from './salary-structures.service';
import { StatutoryFilingsService } from './statutory-filings.service';
import { TdsController } from './tds.controller';
import { TdsChallansService } from './tds-challans.service';
import { TdsReturnsService } from './tds-returns.service';

/** Payroll (docs/03-api-structure.md §payroll). */
@Module({
  // Settings supplies the statutory rules and the working week the
  // calculation prorates against.
  imports: [SettingsModule],
  controllers: [PayrollController, TdsController, PayComponentsController],
  providers: [
    SalaryStructuresService,
    EmployeeSalariesService,
    PayrollAdjustmentsService,
    PayrollRunsService,
    PayslipsService,
    PayrollReportsService,
    StatutoryFilingsService,
    TdsChallansService,
    TdsReturnsService,
    PayComponentsService,
  ],
  /*
   * Expenses turns an approved claim into a payslip line through this service
   * rather than writing `PayrollAdjustment` itself. A second `create` in
   * another module would be a second copy of the statutory-component refusal
   * and the locked-month check, and one of the two would drift. Same seam
   * recruitment uses for `OnboardingService`.
   */
  exports: [PayrollAdjustmentsService],
})
export class PayrollModule {}
