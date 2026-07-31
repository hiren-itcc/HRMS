import { Module } from '@nestjs/common';
import { EmployeesController, MeController } from './employees.controller';
import { EmployeesService } from './employees.service';

/** Employee management (docs/03-api-structure.md §employees). */
@Module({
  controllers: [EmployeesController, MeController],
  providers: [EmployeesService],
  exports: [EmployeesService],
})
export class EmployeesModule {}
