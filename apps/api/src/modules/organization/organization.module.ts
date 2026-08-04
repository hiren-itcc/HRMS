import { Module } from '@nestjs/common';
import { CompanyController } from './controllers/company.controller';
import { DepartmentsController } from './controllers/departments.controller';
import { DesignationsController } from './controllers/designations.controller';
import { EmploymentTypesController } from './controllers/employment-types.controller';
import { HolidaysController } from './controllers/holidays.controller';
import { LocationsController } from './controllers/locations.controller';
import { ShiftsController } from './controllers/shifts.controller';
import { CompanyService } from './services/company.service';
import { DepartmentsService } from './services/departments.service';
import { DesignationsService } from './services/designations.service';
import { EmploymentTypesService } from './services/employment-types.service';
import { HolidaysService } from './services/holidays.service';
import { LocationsService } from './services/locations.service';
import { OrgChartService } from './services/org-chart.service';
import { ShiftsService } from './services/shifts.service';

/**
 * Organization module (docs/03-api-structure.md §organization):
 * company profile, departments, designations, employment types,
 * locations/branches, shifts, holiday calendar.
 */
@Module({
  controllers: [
    CompanyController,
    DepartmentsController,
    DesignationsController,
    EmploymentTypesController,
    LocationsController,
    ShiftsController,
    HolidaysController,
  ],
  providers: [
    CompanyService,
    OrgChartService,
    DepartmentsService,
    DesignationsService,
    EmploymentTypesService,
    LocationsService,
    ShiftsService,
    HolidaysService,
  ],
  exports: [LocationsService, DepartmentsService],
})
export class OrganizationModule {}
