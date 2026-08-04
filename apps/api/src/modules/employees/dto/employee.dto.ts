import {
  bankDetailSchema,
  directoryQuerySchema,
  employeeCreateSchema,
  employeeOffboardSchema,
  employeeQuerySchema,
  employeeRoleChangeSchema,
  employeeUpdateSchema,
  selfProfileUpdateSchema,
} from '@hrms/shared';
import { createZodDto } from 'nestjs-zod';

export class EmployeeCreateDto extends createZodDto(employeeCreateSchema) {}
export class EmployeeRoleChangeDto extends createZodDto(employeeRoleChangeSchema) {}
export class EmployeeUpdateDto extends createZodDto(employeeUpdateSchema) {}
export class EmployeeQueryDto extends createZodDto(employeeQuerySchema) {}
export class EmployeeOffboardDto extends createZodDto(employeeOffboardSchema) {}
export class DirectoryQueryDto extends createZodDto(directoryQuerySchema) {}
export class BankDetailDto extends createZodDto(bankDetailSchema) {}
export class SelfProfileUpdateDto extends createZodDto(selfProfileUpdateSchema) {}
