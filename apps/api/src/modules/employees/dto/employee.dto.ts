import {
  bankDetailSchema,
  employeeCreateSchema,
  employeeQuerySchema,
  employeeUpdateSchema,
  selfProfileUpdateSchema,
} from '@hrms/shared';
import { createZodDto } from 'nestjs-zod';

export class EmployeeCreateDto extends createZodDto(employeeCreateSchema) {}
export class EmployeeUpdateDto extends createZodDto(employeeUpdateSchema) {}
export class EmployeeQueryDto extends createZodDto(employeeQuerySchema) {}
export class BankDetailDto extends createZodDto(bankDetailSchema) {}
export class SelfProfileUpdateDto extends createZodDto(selfProfileUpdateSchema) {}
