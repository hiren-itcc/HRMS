import { Module } from '@nestjs/common';
import { SettingsModule } from '../settings/settings.module';
import { EmployeeSalariesService } from './employee-salaries.service';
import { PayrollController } from './payroll.controller';
import { PayrollAdjustmentsService } from './payroll-adjustments.service';
import { PayrollReportsService } from './payroll-reports.service';
import { PayrollRunsService } from './payroll-runs.service';
import { PayslipsService } from './payslips.service';
import { SalaryStructuresService } from './salary-structures.service';

/** Payroll (docs/03-api-structure.md §payroll). */
@Module({
  // Settings supplies the statutory rules and the working week the
  // calculation prorates against.
  imports: [SettingsModule],
  controllers: [PayrollController],
  providers: [
    SalaryStructuresService,
    EmployeeSalariesService,
    PayrollAdjustmentsService,
    PayrollRunsService,
    PayslipsService,
    PayrollReportsService,
  ],
})
export class PayrollModule {}
