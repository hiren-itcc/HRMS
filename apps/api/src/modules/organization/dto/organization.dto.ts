import {
  companyUpdateSchema,
  departmentCreateSchema,
  departmentUpdateSchema,
  designationCreateSchema,
  designationUpdateSchema,
  employmentTypeCreateSchema,
  employmentTypeUpdateSchema,
  holidayCreateSchema,
  holidayQuerySchema,
  holidayUpdateSchema,
  locationCreateSchema,
  locationQuerySchema,
  locationUpdateSchema,
  paginationQuerySchema,
  shiftCreateSchema,
  shiftUpdateSchema,
} from '@hrms/shared';
import { createZodDto } from 'nestjs-zod';

export class ListQueryDto extends createZodDto(paginationQuerySchema) {}

export class CompanyUpdateDto extends createZodDto(companyUpdateSchema) {}

export class DepartmentCreateDto extends createZodDto(departmentCreateSchema) {}
export class DepartmentUpdateDto extends createZodDto(departmentUpdateSchema) {}

export class DesignationCreateDto extends createZodDto(designationCreateSchema) {}
export class DesignationUpdateDto extends createZodDto(designationUpdateSchema) {}

export class EmploymentTypeCreateDto extends createZodDto(employmentTypeCreateSchema) {}
export class EmploymentTypeUpdateDto extends createZodDto(employmentTypeUpdateSchema) {}

export class LocationCreateDto extends createZodDto(locationCreateSchema) {}
export class LocationUpdateDto extends createZodDto(locationUpdateSchema) {}
export class LocationQueryDto extends createZodDto(locationQuerySchema) {}

export class ShiftCreateDto extends createZodDto(shiftCreateSchema) {}
export class ShiftUpdateDto extends createZodDto(shiftUpdateSchema) {}

export class HolidayCreateDto extends createZodDto(holidayCreateSchema) {}
export class HolidayUpdateDto extends createZodDto(holidayUpdateSchema) {}
export class HolidayQueryDto extends createZodDto(holidayQuerySchema) {}
