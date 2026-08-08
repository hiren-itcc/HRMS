import { Module } from '@nestjs/common';
import { PayrollModule } from '../payroll/payroll.module';
import { ExpenseCategoriesService } from './expense-categories.service';
import { ExpensesController } from './expenses.controller';
import { ExpensesService } from './expenses.service';

/**
 * Expenses (docs/03-api-structure.md §expenses).
 *
 * `PayrollModule` is imported for `PayrollAdjustmentsService`, which is how an
 * approved claim becomes a payslip line. Nothing inside payroll changed to
 * allow it beyond one `exports` entry — the same seam recruitment used for
 * `OnboardingService`.
 *
 * `NotificationsModule` is not imported: it is `@Global`.
 */
@Module({
  imports: [PayrollModule],
  controllers: [ExpensesController],
  providers: [ExpensesService, ExpenseCategoriesService],
})
export class ExpensesModule {}
