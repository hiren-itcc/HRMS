import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { LifecycleModule } from '../lifecycle/lifecycle.module';
import { DirectoryController } from './directory.controller';
import { DirectoryService } from './directory.service';
import { EmployeesController, MeController } from './employees.controller';
import { EmployeesService } from './employees.service';

/** Employee management and the company directory (docs/03 §employees). */
@Module({
  imports: [AuditModule, LifecycleModule],
  controllers: [EmployeesController, MeController, DirectoryController],
  providers: [EmployeesService, DirectoryService],
  exports: [EmployeesService],
})
export class EmployeesModule {}
