import { z } from 'zod';
import { dateOnlySchema, paginationQuerySchema } from './common';
import { genderSchema } from './employee';

const trimmed = (max: number) => z.string().trim().max(max);
const optionalStr = (max: number) =>
  z
    .literal('')
    .transform(() => undefined)
    .or(trimmed(max))
    .optional();

/**
 * Starting an onboarding needs far less than creating an employee outright:
 * a name, where to reach them, and what their login will be.
 *
 * `joinDate` stays required — the column is NOT NULL, three modules compare
 * against it, and HR has it because it is on the offer. Department, shift and
 * the rest are optional here and validated at approval instead, so nothing
 * reaches ACTIVE half-specified.
 */
export const employeeOnboardSchema = z.object({
  firstName: trimmed(60).min(1, 'First name is required'),
  lastName: trimmed(60).min(1, 'Last name is required'),
  /** Where the invite is sent. They cannot read the work mailbox yet. */
  personalEmail: z.email().trim().toLowerCase(),
  /** Becomes their login. Must be free on User.email. */
  workEmail: z.email().trim().toLowerCase(),
  joinDate: dateOnlySchema,
  employeeCode: optionalStr(20),
  departmentId: optionalStr(40),
  designationId: optionalStr(40),
  locationId: optionalStr(40),
  shiftId: optionalStr(40),
  employmentTypeId: optionalStr(40),
  managerId: optionalStr(40),
});
export type EmployeeOnboardInput = z.infer<typeof employeeOnboardSchema>;

/**
 * What the hire may write about themselves *while onboarding*.
 *
 * Wider than `selfProfileUpdateSchema` on purpose, and deliberately a separate
 * schema rather than an extension of it: `PATCH /me/profile` carries no
 * permission decorator, so its schema is the whole authorization boundary.
 * Widening that one would let every employee rewrite their date of birth
 * forever. This one is only accepted while the record is IN_PROGRESS.
 */
export const onboardingProfileSchema = z.object({
  dateOfBirth: dateOnlySchema.optional(),
  gender: genderSchema.optional(),
  phone: optionalStr(20),
  addressLine: optionalStr(200),
  city: optionalStr(80),
  country: optionalStr(80),
  /**
   * Null until answered, which keeps the documents step incomplete — a
   * fresher cannot skip the requirement by leaving the folder empty.
   */
  hasPreviousEmployment: z.boolean().optional(),
});
export type OnboardingProfileInput = z.infer<typeof onboardingProfileSchema>;

/** Which uploaded document satisfies which checklist item. */
export const onboardingDocumentSchema = z.object({
  slot: z.enum(['idProof', 'bankProof', 'education', 'prevEmployment']),
  documentId: z.string().min(1),
});
export type OnboardingDocumentInput = z.infer<typeof onboardingDocumentSchema>;

export const onboardingReviewSchema = z.object({
  note: z.string().trim().max(500).optional(),
});
export type OnboardingReviewInput = z.infer<typeof onboardingReviewSchema>;

export const onboardingRequestChangesSchema = z.object({
  note: z.string().trim().min(1, 'Say what needs changing').max(500),
});
export type OnboardingRequestChangesInput = z.infer<typeof onboardingRequestChangesSchema>;

export const onboardingQuerySchema = paginationQuerySchema.extend({
  status: z.enum(['IN_PROGRESS', 'SUBMITTED', 'APPROVED']).optional(),
});
export type OnboardingQuery = z.infer<typeof onboardingQuerySchema>;

// Accepting an invite reuses `acceptInviteSchema` from ./auth, which was
// already written against the flow docs/07 specified. It uses the shared
// `passwordSchema`, so an invited hire faces the same password rules as
// everyone else — which is the point of not defining a second one here.

/**
 * The checklist. Each item names the seeded folder a file should land in, but
 * completeness is judged on the FK columns of the Onboarding row — folders are
 * renameable and deletable, so matching them by name would break the first
 * time HR renamed "Certificates".
 */
export const ONBOARDING_DOCUMENTS = [
  {
    slot: 'idProof',
    label: 'Photo ID proof',
    hint: 'Aadhaar, PAN or passport',
    folder: 'Aadhaar',
  },
  {
    slot: 'bankProof',
    label: 'Bank proof',
    hint: 'Cancelled cheque or passbook page showing the account number',
    folder: 'Bank Documents',
  },
  {
    slot: 'education',
    label: 'Education certificate',
    hint: 'Highest degree or diploma',
    folder: 'Certificates',
  },
  {
    slot: 'prevEmployment',
    label: 'Relieving letter',
    hint: 'From your previous employer — not needed if this is your first job',
    folder: 'Certificates',
    /** Only required when they say they have worked before. */
    conditional: true,
  },
] as const;

export type OnboardingDocumentSlot = (typeof ONBOARDING_DOCUMENTS)[number]['slot'];
