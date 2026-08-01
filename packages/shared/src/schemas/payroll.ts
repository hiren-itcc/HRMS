import { z } from 'zod';
import { paginationQuerySchema } from './common';

/** "YYYY-MM" — the same month key attendance uses. */
export const monthKeySchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Month must be YYYY-MM');

const dateKeySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD');

const money = z.number().min(0, 'Cannot be negative').max(99_999_999);

export const CALC_TYPES = [
  'FLAT',
  'PERCENT_OF_BASIC',
  'PERCENT_OF_CTC',
  'STATUTORY',
  'BALANCE',
] as const;

// ── Salary structures ─────────────────────────────────────────────────

export const structureLineSchema = z.object({
  componentId: z.string().min(1),
  calcType: z.enum(CALC_TYPES),
  value: z.number().min(0).max(99_999_999).default(0),
  order: z.number().int().min(0).default(0),
});

export const salaryStructureCreateSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(100),
  code: z
    .string()
    .trim()
    .min(1, 'Code is required')
    .max(20)
    .regex(/^[A-Z0-9_]+$/, 'Use capitals, digits and underscores'),
  description: z.string().trim().max(500).optional().nullable(),
  isActive: z.boolean().default(true),
  lines: z
    .array(structureLineSchema)
    .min(1, 'A structure needs at least one component')
    /*
     * At most one BALANCE line. Two would each try to absorb the remainder and
     * the second would always resolve to zero — a silent misconfiguration
     * rather than an error, which is worse.
     */
    .refine(
      (lines) => lines.filter((l) => l.calcType === 'BALANCE').length <= 1,
      'Only one component can absorb the balance',
    )
    .refine(
      (lines) => new Set(lines.map((l) => l.componentId)).size === lines.length,
      'A component can only appear once',
    ),
});

export const salaryStructureUpdateSchema = salaryStructureCreateSchema.partial().extend({
  lines: salaryStructureCreateSchema.shape.lines.optional(),
});

export const salaryStructureQuerySchema = paginationQuerySchema.extend({
  isActive: z.coerce.boolean().optional(),
});

// ── Employee salary ───────────────────────────────────────────────────

export const REVISION_TYPES = [
  'JOINING',
  'INCREMENT',
  'PROMOTION',
  'TRANSFER',
  'ADJUSTMENT',
] as const;

export const PAYMENT_METHODS = ['BANK_TRANSFER', 'CASH', 'CHEQUE'] as const;

export const employeeSalarySchema = z.object({
  employeeId: z.string().min(1, 'Employee is required'),
  structureId: z.string().min(1, 'Salary structure is required'),
  effectiveFrom: dateKeySchema,
  monthlyCtc: money.refine((n) => n > 0, 'Monthly CTC must be greater than zero'),
  monthlyTds: money.default(0),
  revisionType: z.enum(REVISION_TYPES).default('JOINING'),
  reason: z.string().trim().max(500).optional().nullable(),
  paymentMethod: z.enum(PAYMENT_METHODS).default('BANK_TRANSFER'),
});

export const salaryQuerySchema = paginationQuerySchema.extend({
  departmentId: z.string().optional(),
  structureId: z.string().optional(),
  /** Only employees who have no salary assignment yet. */
  unassigned: z.coerce.boolean().optional(),
});

// ── Payroll runs ──────────────────────────────────────────────────────

export const RUN_STATUSES = [
  'DRAFT',
  'IN_REVIEW',
  'APPROVED',
  'LOCKED',
  'PUBLISHED',
  'CANCELLED',
] as const;

export const RUN_ACTIONS = ['calculate', 'approve', 'reopen', 'lock', 'publish', 'cancel'] as const;

export const payrollRunCreateSchema = z.object({
  month: monthKeySchema,
  payDate: dateKeySchema.optional().nullable(),
  notes: z.string().trim().max(500).optional().nullable(),
});

export const payrollRunActionSchema = z.object({
  action: z.enum(RUN_ACTIONS),
  /** Recorded on the audit row — why a run was reopened or cancelled. */
  note: z.string().trim().max(500).optional().nullable(),
});

export const payrollRunQuerySchema = paginationQuerySchema.extend({
  status: z.enum(RUN_STATUSES).optional(),
  year: z.coerce.number().int().min(2000).max(2100).optional(),
});

// ── Payslips ──────────────────────────────────────────────────────────

export const PAYMENT_STATUSES = ['PENDING', 'PROCESSING', 'PAID', 'FAILED', 'CANCELLED'] as const;

export const payslipQuerySchema = paginationQuerySchema.extend({
  runId: z.string().optional(),
  employeeId: z.string().optional(),
  departmentId: z.string().optional(),
  month: monthKeySchema.optional(),
  paymentStatus: z.enum(PAYMENT_STATUSES).optional(),
});

export const paymentUpdateSchema = z.object({
  payslipIds: z.array(z.string().min(1)).min(1, 'Select at least one payslip').max(1000),
  status: z.enum(PAYMENT_STATUSES),
  paymentRef: z.string().trim().max(100).optional().nullable(),
  /** Required when marking failed, so the reason is never a mystery later. */
  failureReason: z.string().trim().max(300).optional().nullable(),
});

// ── Adjustments (bonus, incentive, loan recovery) ─────────────────────

export const ADJUSTMENT_KINDS = ['EARNING', 'DEDUCTION'] as const;

export const payrollAdjustmentSchema = z.object({
  employeeId: z.string().min(1),
  componentId: z.string().min(1),
  amount: money.refine((n) => n > 0, 'Amount must be greater than zero'),
  note: z.string().trim().max(300).optional().nullable(),
});

// ── Reports ───────────────────────────────────────────────────────────

export const PAYROLL_REPORTS = [
  'register',
  'bank-transfer',
  'pf',
  'esi',
  'tax',
  'department',
] as const;

export const payrollReportQuerySchema = z.object({
  month: monthKeySchema,
  departmentId: z.string().optional(),
  format: z.enum(['json', 'csv', 'excel']).default('json'),
});

export type StructureLineInput = z.infer<typeof structureLineSchema>;
export type SalaryStructureCreateInput = z.infer<typeof salaryStructureCreateSchema>;
export type SalaryStructureUpdateInput = z.infer<typeof salaryStructureUpdateSchema>;
export type EmployeeSalaryInput = z.infer<typeof employeeSalarySchema>;
export type PayrollRunCreateInput = z.infer<typeof payrollRunCreateSchema>;
export type PayrollRunActionInput = z.infer<typeof payrollRunActionSchema>;
export type PayrollRunQuery = z.infer<typeof payrollRunQuerySchema>;
export type PayslipQuery = z.infer<typeof payslipQuerySchema>;
export type PaymentUpdateInput = z.infer<typeof paymentUpdateSchema>;
export type SalaryQuery = z.infer<typeof salaryQuerySchema>;
export type SalaryStructureQuery = z.infer<typeof salaryStructureQuerySchema>;
export type PayrollReportQuery = z.infer<typeof payrollReportQuerySchema>;
export type PayrollReportKind = (typeof PAYROLL_REPORTS)[number];
