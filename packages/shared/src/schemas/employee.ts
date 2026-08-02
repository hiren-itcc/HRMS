import { z } from 'zod';
import { dateOnlySchema, paginationQuerySchema } from './common';

const trimmed = (max: number) => z.string().trim().max(max);

/**
 * The five seeded system roles (docs/04-rbac.md). Shared by the create form's
 * `loginRole` and by the role-change action so the two can never drift apart.
 */
export const roleCodeSchema = z.enum(['EMPLOYEE', 'MANAGER', 'HR', 'FINANCE', 'ADMIN']);
export type RoleCodeInput = z.infer<typeof roleCodeSchema>;

/*
 * An HTML form sends "" for an untouched field, not `undefined`. These map
 * that to absent.
 *
 * The empty-string branch has to come FIRST. Written the other way round —
 * `trimmed(max).optional().or(z.literal('')...)` — the union never reaches
 * the second branch, because `z.string().optional()` considers "" a perfectly
 * good string and matches it. The transform was dead code, and an omitted
 * employee code reached the database as "" instead of being auto-generated.
 */
const optionalStr = (max: number) =>
  z
    .literal('')
    .transform(() => undefined)
    .or(trimmed(max))
    .optional();

const optionalEmail = z
  .literal('')
  .transform(() => undefined)
  .or(z.email('Enter a valid email').trim().toLowerCase())
  .optional();

const nullableId = z
  .literal('')
  .transform(() => null)
  .or(z.string())
  .nullish();

/**
 * A relation the employee must actually have.
 *
 * Same empty-string handling as `nullableId` — a form still posts "" for an
 * unanswered select — but "" and null both fail instead of being stored. The
 * message names the field, because a select that simply turns red says nothing
 * about which of six it was.
 */
const requiredId = (label: string) =>
  z
    .string({ error: `${label} is required` })
    .trim()
    .min(1, `${label} is required`);

export const employeeStatusSchema = z.enum(['ACTIVE', 'ON_NOTICE', 'EXITED']);
export const genderSchema = z.enum(['MALE', 'FEMALE', 'OTHER', 'PREFER_NOT_TO_SAY']);

export const employeeCreateSchema = z.object({
  employeeCode: optionalStr(20),
  firstName: trimmed(60).min(1, 'First name is required'),
  lastName: trimmed(60).min(1, 'Last name is required'),
  workEmail: z.email('Enter a valid email').trim().toLowerCase(),
  personalEmail: optionalEmail,
  phone: optionalStr(20),
  dateOfBirth: z
    .literal('')
    .transform(() => undefined)
    .or(dateOnlySchema)
    .optional(),
  gender: genderSchema.optional(),
  addressLine: optionalStr(200),
  city: optionalStr(80),
  country: optionalStr(80),
  // Job details: where this person sits in the organization. All required —
  // an employee with no department or no shift cannot be scheduled, reported
  // on, or paid correctly, and the gap is only ever noticed downstream.
  departmentId: requiredId('Department'),
  designationId: requiredId('Designation'),
  locationId: requiredId('Location'),
  shiftId: requiredId('Shift'),
  employmentTypeId: requiredId('Employment type'),
  /*
   * The exception, deliberately. Somebody has to be at the top of the org
   * chart, and in a new organization the first employee has nobody to point
   * at — requiring this would make the first hire impossible to record.
   */
  managerId: nullableId,
  status: employeeStatusSchema.default('ACTIVE'),
  joinDate: dateOnlySchema,

  /**
   * Create a sign-in for this person, using their work email.
   *
   * On by default: an employee record with no login is a row in a table, not
   * somebody who can use the product, and forgetting the second step was the
   * whole problem.
   */
  createLogin: z.boolean().default(true),
  /** Role the new login gets. Anything beyond self-service is a decision. */
  loginRole: roleCodeSchema.default('EMPLOYEE'),
});
/*
 * Login fields are create-only. A sign-in is not an employee attribute you
 * edit — changing a role or resetting a password are their own actions with
 * their own permissions, and leaving these in would let an edit spread
 * unknown columns into the employee update.
 *
 * The role half of that is `employeeRoleChangeSchema` below, behind
 * `role.manage` — see PATCH /employees/:id/role.
 */
export const employeeUpdateSchema = employeeCreateSchema
  .omit({ createLogin: true, loginRole: true })
  .partial();
export type EmployeeCreateInput = z.infer<typeof employeeCreateSchema>;
export type EmployeeUpdateInput = z.infer<typeof employeeUpdateSchema>;

/** Body of PATCH /employees/:id/role — the role a person's login should hold. */
export const employeeRoleChangeSchema = z.object({ roleCode: roleCodeSchema });
export type EmployeeRoleChangeInput = z.infer<typeof employeeRoleChangeSchema>;

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
  personalEmail: optionalEmail,
  addressLine: optionalStr(200),
  city: optionalStr(80),
  country: optionalStr(80),
});
export type SelfProfileUpdateInput = z.infer<typeof selfProfileUpdateSchema>;
