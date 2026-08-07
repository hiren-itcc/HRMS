import {
  employeeSalarySchema,
  paginationQuerySchema,
  paymentUpdateSchema,
  payrollAdjustmentQuerySchema,
  payrollAdjustmentSchema,
  payrollReportQuerySchema,
  payrollRunActionSchema,
  payrollRunCreateSchema,
  payrollRunQuerySchema,
  payslipQuerySchema,
  salaryQuerySchema,
  salaryStructureCreateSchema,
  salaryStructureQuerySchema,
  salaryStructureUpdateSchema,
} from '@hrms/shared';
import { createZodDto } from 'nestjs-zod';

export class PayrollListQueryDto extends createZodDto(paginationQuerySchema) {}
export class SalaryStructureCreateDto extends createZodDto(salaryStructureCreateSchema) {}
export class SalaryStructureUpdateDto extends createZodDto(salaryStructureUpdateSchema) {}
export class SalaryStructureQueryDto extends createZodDto(salaryStructureQuerySchema) {}
export class EmployeeSalaryDto extends createZodDto(employeeSalarySchema) {}
export class SalaryQueryDto extends createZodDto(salaryQuerySchema) {}
export class PayrollRunCreateDto extends createZodDto(payrollRunCreateSchema) {}
export class PayrollRunActionDto extends createZodDto(payrollRunActionSchema) {}
export class PayrollRunQueryDto extends createZodDto(payrollRunQuerySchema) {}
export class PayslipQueryDto extends createZodDto(payslipQuerySchema) {}
export class PaymentUpdateDto extends createZodDto(paymentUpdateSchema) {}
export class PayrollAdjustmentDto extends createZodDto(payrollAdjustmentSchema) {}
export class PayrollAdjustmentQueryDto extends createZodDto(payrollAdjustmentQuerySchema) {}
export class PayrollReportQueryDto extends createZodDto(payrollReportQuerySchema) {}
