import { z } from 'zod';
import { dateOnlySchema, paginationQuerySchema } from './common';

const trimmed = (max: number) => z.string().trim().max(max);
const optionalStr = (max: number) =>
  trimmed(max)
    .optional()
    .or(z.literal('').transform(() => undefined));
const nullableId = z
  .string()
  .nullish()
  .or(z.literal('').transform(() => null));

export const employeeStatusSchema = z.enum(['ACTIVE', 'ON_NOTICE', 'EXITED']);
export const genderSchema = z.enum(['MALE', 'FEMALE', 'OTHER', 'PREFER_NOT_TO_SAY']);

export const employeeCreateSchema = z.object({
  employeeCode: optionalStr(20),
  firstName: trimmed(60).min(1, 'First name is required'),
  lastName: trimmed(60).min(1, 'Last name is required'),
  workEmail: z.email('Enter a valid email').trim().toLowerCase(),
  personalEmail: z
    .email('Enter a valid email')
    .trim()
    .toLowerCase()
    .optional()
    .or(z.literal('').transform(() => undefined)),
  phone: optionalStr(20),
  dateOfBirth: dateOnlySchema.optional().or(z.literal('').transform(() => undefined)),
  gender: genderSchema.optional(),
  addressLine: optionalStr(200),
  city: optionalStr(80),
  country: optionalStr(80),
  departmentId: nullableId,
  designationId: nullableId,
  locationId: nullableId,
  managerId: nullableId,
  shiftId: nullableId,
  employmentTypeId: nullableId,
  status: employeeStatusSchema.default('ACTIVE'),
  joinDate: dateOnlySchema,
});
export const employeeUpdateSchema = employeeCreateSchema.partial();
export type EmployeeCreateInput = z.infer<typeof employeeCreateSchema>;
export type EmployeeUpdateInput = z.infer<typeof employeeUpdateSchema>;

export const employeeQuerySchema = paginationQuerySchema.extend({
  departmentId: z.string().optional(),
  designationId: z.string().optional(),
  locationId: z.string().optional(),
  employmentTypeId: z.string().optional(),
  status: employeeStatusSchema.optional(),
});
export type EmployeeQuery = z.infer<typeof employeeQuerySchema>;

export const bankDetailSchema = z.object({
  accountHolderName: trimmed(100).min(1, 'Account holder is required'),
  bankName: trimmed(100).min(1, 'Bank name is required'),
  accountNumber: z
    .string()
    .trim()
    .regex(/^[0-9]{6,20}$/, 'Account number must be 6–20 digits'),
  ifscCode: optionalStr(20),
  branch: optionalStr(100),
});
export type BankDetailInput = z.infer<typeof bankDetailSchema>;

/** Subset an employee may edit about themselves (docs/03 — /me/profile). */
export const selfProfileUpdateSchema = z.object({
  phone: optionalStr(20),
  personalEmail: z
    .email('Enter a valid email')
    .trim()
    .toLowerCase()
    .optional()
    .or(z.literal('').transform(() => undefined)),
  addressLine: optionalStr(200),
  city: optionalStr(80),
  country: optionalStr(80),
});
export type SelfProfileUpdateInput = z.infer<typeof selfProfileUpdateSchema>;
