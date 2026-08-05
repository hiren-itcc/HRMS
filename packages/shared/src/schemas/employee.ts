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
 * An optional whole-number override where blank means "inherit the default".
 *
 * The empty-string branch is the same problem `nullableId` solves and matters
 * more here: a number input posts "" when cleared, `z.coerce.number()` reads
 * that as 0, and a cleared notice-period field would silently save "no notice"
 * rather than "use the company default".
 */
const nullableInt = (min: number, max: number) =>
  z
    .literal('')
    .transform(() => null)
    .or(z.coerce.number().int().min(min).max(max))
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

/**
 * The statuses a human may *set* on an employee.
 *
 * ONBOARDING is deliberately absent. It is reached by inviting somebody and
 * left by approving them — both audited, permissioned actions. If it were
 * settable here it would flow into `employeeUpdateSchema`, and
 * `PATCH /employees/:id { status: 'ONBOARDING' }` would become an unguarded
 * way to shove an active employee back into the wizard, where their own
 * bank details become self-editable again.
 */
export const employeeStatusSchema = z.enum(['ACTIVE', 'ON_NOTICE', 'EXITED']);

/** The statuses a list may be *filtered* by — settable ones plus ONBOARDING. */
export const employeeStatusFilterSchema = z.enum(['ONBOARDING', 'ACTIVE', 'ON_NOTICE', 'EXITED']);
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

  /*
   * Both null for "use the company default from Settings → Preferences",
   * which is what almost every record will carry. They are here rather than on
   * EmploymentType because two full-time hires routinely differ: a senior
   * joiner on three months' notice and a graduate on one is the normal case.
   *
   * `probationMonths` is read once, when the end date is first computed. After
   * that `probationEndDate` on the row is what was agreed, and editing it is
   * an explicit extension rather than a side effect of changing a default.
   */
  noticePeriodDays: nullableInt(0, 365),
  probationMonths: nullableInt(0, 24),
  /**
   * Remote days a week. Null is the company default; **zero is a real
   * allowance** — "never works remotely" — and not the same thing.
   */
  remoteDaysPerWeek: nullableInt(0, 7),

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

/**
 * Body of POST /employees/:id/offboard — somebody leaving, or unleaving.
 *
 * Three destinations, and the difference is what happens to their sign-in:
 *
 * - `ON_NOTICE` — resigned, still working the notice period. `exitDate` is the
 *   planned last day. The login is untouched: they still clock in, book leave
 *   and get paid, because they are still an employee.
 * - `EXITED` — gone. The login is suspended and every session revoked. The
 *   record stays: their payslips and attendance are last year's accounts.
 * - `ACTIVE` — a resignation withdrawn. Clears `exitDate` and restores the
 *   sign-in if offboarding is what suspended it.
 *
 * `exitDate` is required for the first two and refused for the third, because
 * "active with a leaving date" is the state that quietly excludes somebody from
 * next month's payroll.
 */
export const employeeOffboardSchema = z
  .object({
    status: employeeStatusSchema,
    exitDate: dateOnlySchema.optional().nullable(),
    /** Recorded on the audit row; not shown to the employee. */
    reason: z.string().trim().max(300).optional().nullable(),
  })
  .refine((v) => v.status === 'ACTIVE' || Boolean(v.exitDate), {
    message: 'An exit date is required',
    path: ['exitDate'],
  })
  .refine((v) => v.status !== 'ACTIVE' || !v.exitDate, {
    message: 'Reinstating someone clears their exit date',
    path: ['exitDate'],
  });
export type EmployeeOffboardInput = z.infer<typeof employeeOffboardSchema>;

/**
 * Body of POST /employees/:id/confirm — off probation for good.
 *
 * `confirmedOn` is optional and defaults to today. It exists because
 * confirmation is routinely recorded after the fact — the review happened on
 * the 1st and somebody enters it on the 9th — and back-dating it is the honest
 * record. It cannot be in the future: a confirmation that has not happened yet
 * is a reminder, not a fact.
 */
export const employeeConfirmSchema = z.object({
  confirmedOn: dateOnlySchema.optional().nullable(),
  note: z.string().trim().max(500).optional().nullable(),
});
export type EmployeeConfirmInput = z.infer<typeof employeeConfirmSchema>;

/**
 * Body of POST /employees/:id/extend-probation.
 *
 * The new end date is given outright rather than as "add N months", because
 * what gets agreed in a probation review is a date. The original end date is
 * kept on the row, so the extension is visible as an extension rather than as
 * a probation that always ran that long.
 */
export const employeeExtendProbationSchema = z.object({
  extendedTo: dateOnlySchema,
  reason: z.string().trim().min(1, 'Say why it is being extended').max(500),
});
export type EmployeeExtendProbationInput = z.infer<typeof employeeExtendProbationSchema>;

export const employeeQuerySchema = paginationQuerySchema.extend({
  departmentId: z.string().optional(),
  designationId: z.string().optional(),
  locationId: z.string().optional(),
  employmentTypeId: z.string().optional(),
  // Filter, not setter — HR has to be able to find people mid-onboarding.
  status: employeeStatusFilterSchema.optional(),
});
export type EmployeeQuery = z.infer<typeof employeeQuerySchema>;

/**
 * GET /directory — the company people list. Deliberately narrower than the
 * employee query: no status filter, because the directory only ever lists
 * current colleagues.
 */
export const directoryQuerySchema = paginationQuerySchema.extend({
  departmentId: z.string().optional(),
  locationId: z.string().optional(),
});
export type DirectoryQuery = z.infer<typeof directoryQuerySchema>;

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

/**
 * Who to call if something happens to this person at work.
 *
 * Deliberately three loose fields. "Relation" is free text rather than an enum
 * because the list that covers everybody is not a list — partner, neighbour,
 * the friend with the spare key — and an enum here would force somebody to
 * misfile the person they actually want called.
 */
export const emergencyContactSchema = z.object({
  name: trimmed(80).min(1, 'Name is required'),
  relation: trimmed(40).min(1, 'Relation is required'),
  phone: trimmed(20).min(1, 'Phone is required'),
});
export type EmergencyContactInput = z.infer<typeof emergencyContactSchema>;

/** Subset an employee may edit about themselves (docs/03 — /me/profile). */
export const selfProfileUpdateSchema = z.object({
  phone: optionalStr(20),
  personalEmail: optionalEmail,
  addressLine: optionalStr(200),
  city: optionalStr(80),
  country: optionalStr(80),
  /**
   * Replace-all, and omitting the key leaves the existing contacts alone.
   *
   * A list this short (two or three rows, edited once a year) is not worth
   * three more endpoints and a per-row id the client has to track. Sending the
   * whole set makes "I removed my ex-partner" a single atomic write rather than
   * a delete that can half-succeed.
   */
  emergencyContacts: z.array(emergencyContactSchema).max(5).optional(),
});
export type SelfProfileUpdateInput = z.infer<typeof selfProfileUpdateSchema>;
