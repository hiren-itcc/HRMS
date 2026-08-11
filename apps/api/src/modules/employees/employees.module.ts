import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { LifecycleModule } from '../lifecycle/lifecycle.module';
import { DirectoryController } from './directory.controller';
import { DirectoryService } from './directory.service';
import { EmployeeAvatarService } from './employee-avatar.service';
import { EmployeeExportService } from './employee-export.service';
import { EmployeesController, MeController } from './employees.controller';
import { EmployeesService } from './employees.service';

/**
 * Employee management and the company directory (docs/03 §employees).
 *
 * `StorageService` is not imported: `StorageModule` is `@Global`, so profile
 * photos reach it without this module declaring a second copy of the adapter.
 */
@Module({
  imports: [AuditModule, LifecycleModule],
  controllers: [EmployeesController, MeController, DirectoryController],
  providers: [EmployeesService, DirectoryService, EmployeeAvatarService, EmployeeExportService],
  exports: [EmployeesService],
})
export class EmployeesModule {}
