import { z } from 'zod';
import { dateOnlySchema, paginationQuerySchema } from './common';

/**
 * Recruitment — the front of the lifecycle.
 *
 * A candidate is a person the organization is talking to, not a member of
 * staff. The only place the two meet is a hire, which converts an accepted
 * offer through the existing onboarding invite rather than creating an
 * employee a second way.
 */

const trimmed = (max: number) => z.string().trim().max(max);
const optionalStr = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    // An empty select posts "", which is not an id and must not be stored as one.
    .transform((v) => (v ? v : undefined));

/**
 * An optional figure where blank means "not stated".
 *
 * A number input posts `""` when cleared and `z.coerce.number()` reads that as
 * 0 — so a cleared salary band would advertise a role paying nothing, and a
 * cleared notice period would claim they can start tomorrow. Both are worse
 * than saying nothing. The same trap `employee.ts`'s `nullableInt` sidesteps,
 * and the reason it is worth a helper rather than a `.optional()`.
 */
const optionalMoney = () =>
  z
    .literal('')
    .transform(() => null)
    .or(z.coerce.number().min(0))
    .nullish();

const optionalInt = (min: number, max: number) =>
  z
    .literal('')
    .transform(() => null)
    .or(z.coerce.number().int().min(min).max(max))
    .nullish();

export const OPENING_STATUSES = ['DRAFT', 'OPEN', 'ON_HOLD', 'CLOSED', 'FILLED'] as const;
export const openingStatusSchema = z.enum(OPENING_STATUSES);
export type OpeningStatusCode = (typeof OPENING_STATUSES)[number];

export const OPENING_STATUS_LABELS: Record<OpeningStatusCode, string> = {
  DRAFT: 'Draft',
  OPEN: 'Open',
  ON_HOLD: 'On hold',
  CLOSED: 'Closed',
  FILLED: 'Filled',
};

export const APPLICATION_STAGES = [
  'APPLIED',
  'SCREENING',
  'INTERVIEW',
  'OFFER',
  'HIRED',
  'REJECTED',
  'WITHDRAWN',
] as const;
export const applicationStageSchema = z.enum(APPLICATION_STAGES);
export type ApplicationStageCode = (typeof APPLICATION_STAGES)[number];

export const APPLICATION_STAGE_LABELS: Record<ApplicationStageCode, string> = {
  APPLIED: 'Applied',
  SCREENING: 'Screening',
  INTERVIEW: 'Interview',
  OFFER: 'Offer',
  HIRED: 'Hired',
  REJECTED: 'Rejected',
  WITHDRAWN: 'Withdrawn',
};

/** The columns a board draws. The endings are not columns; they are exits. */
export const PIPELINE_STAGES = ['APPLIED', 'SCREENING', 'INTERVIEW', 'OFFER'] as const;

export const REJECTION_REASONS = [
  'SKILLS',
  'EXPERIENCE',
  'COMPENSATION',
  'LOCATION',
  'NOTICE_PERIOD',
  'CULTURE_FIT',
  'POSITION_CLOSED',
  'CANDIDATE_WITHDREW',
  'OTHER',
] as const;
export const rejectionReasonSchema = z.enum(REJECTION_REASONS);
export type RejectionReasonCode = (typeof REJECTION_REASONS)[number];

export const REJECTION_REASON_LABELS: Record<RejectionReasonCode, string> = {
  SKILLS: 'Skills did not match',
  EXPERIENCE: 'Not enough experience',
  COMPENSATION: 'Could not agree on pay',
  LOCATION: 'Location did not work',
  NOTICE_PERIOD: 'Notice period too long',
  CULTURE_FIT: 'Not the right fit',
  POSITION_CLOSED: 'The role closed',
  CANDIDATE_WITHDREW: 'They withdrew',
  OTHER: 'Something else',
};

export const INTERVIEW_MODES = ['IN_PERSON', 'VIDEO', 'PHONE'] as const;
export const interviewModeSchema = z.enum(INTERVIEW_MODES);
export type InterviewModeCode = (typeof INTERVIEW_MODES)[number];

export const INTERVIEW_MODE_LABELS: Record<InterviewModeCode, string> = {
  IN_PERSON: 'In person',
  VIDEO: 'Video call',
  PHONE: 'Phone',
};

export const INTERVIEW_RECOMMENDATIONS = ['STRONG_YES', 'YES', 'NO', 'STRONG_NO'] as const;
export const interviewRecommendationSchema = z.enum(INTERVIEW_RECOMMENDATIONS);
export type InterviewRecommendationCode = (typeof INTERVIEW_RECOMMENDATIONS)[number];

export const INTERVIEW_RECOMMENDATION_LABELS: Record<InterviewRecommendationCode, string> = {
  STRONG_YES: 'Strong yes',
  YES: 'Yes',
  NO: 'No',
  STRONG_NO: 'Strong no',
};

export const OFFER_STATUSES = [
  'DRAFT',
  'SENT',
  'ACCEPTED',
  'DECLINED',
  'WITHDRAWN',
  'EXPIRED',
] as const;
export const offerStatusSchema = z.enum(OFFER_STATUSES);
export type OfferStatusCode = (typeof OFFER_STATUSES)[number];

export const OFFER_STATUS_LABELS: Record<OfferStatusCode, string> = {
  DRAFT: 'Draft',
  SENT: 'Sent',
  ACCEPTED: 'Accepted',
  DECLINED: 'Declined',
  WITHDRAWN: 'Withdrawn',
  EXPIRED: 'Expired',
};

// ── Openings ──────────────────────────────────────────────────────────

export const openingCreateSchema = z
  .object({
    title: trimmed(120).min(1, 'What is the job called?'),
    departmentId: optionalStr(40),
    designationId: optionalStr(40),
    locationId: optionalStr(40),
    employmentTypeId: optionalStr(40),
    hiringManagerId: optionalStr(40),
    headcount: z.coerce.number().int().min(1, 'At least one').max(999).default(1),
    description: optionalStr(5000),
    minMonthlyCtc: optionalMoney(),
    maxMonthlyCtc: optionalMoney(),
  })
  .refine((d) => !d.minMonthlyCtc || !d.maxMonthlyCtc || d.maxMonthlyCtc >= d.minMonthlyCtc, {
    path: ['maxMonthlyCtc'],
    message: 'The top of the band cannot be below the bottom',
  });
export type OpeningCreateInput = z.infer<typeof openingCreateSchema>;

export const openingUpdateSchema = openingCreateSchema;
export type OpeningUpdateInput = z.infer<typeof openingUpdateSchema>;

/**
 * Status is its own route rather than a field on update, for the reason every
 * other workflow here separates them: publishing and closing have rules —
 * an opening with live applications cannot close — and folding them into a
 * general edit hides that behind a form nobody reads.
 */
export const openingStatusChangeSchema = z.object({ status: openingStatusSchema });
export type OpeningStatusChangeInput = z.infer<typeof openingStatusChangeSchema>;

export const openingQuerySchema = paginationQuerySchema.extend({
  status: openingStatusSchema.optional(),
  departmentId: z.string().optional(),
  search: z.string().trim().max(120).optional(),
});

// ── Candidates ────────────────────────────────────────────────────────

export const candidateCreateSchema = z.object({
  firstName: trimmed(60).min(1, 'First name is required'),
  lastName: trimmed(60).min(1, 'Last name is required'),
  email: z.email().trim().toLowerCase(),
  phone: optionalStr(30),
  currentEmployer: optionalStr(120),
  currentTitle: optionalStr(120),
  noticePeriodDays: optionalInt(0, 365),
  expectedMonthlyCtc: optionalMoney(),
  source: optionalStr(80),
  referrerId: optionalStr(40),
  notes: optionalStr(4000),
});
export type CandidateCreateInput = z.infer<typeof candidateCreateSchema>;

export const candidateUpdateSchema = candidateCreateSchema.partial();
export type CandidateUpdateInput = z.infer<typeof candidateUpdateSchema>;

export const candidateQuerySchema = paginationQuerySchema.extend({
  search: z.string().trim().max(120).optional(),
});

// ── Applications ──────────────────────────────────────────────────────

export const applicationCreateSchema = z.object({
  candidateId: z.string().trim().min(1, 'Choose a candidate'),
  openingId: z.string().trim().min(1, 'Choose an opening'),
});
export type ApplicationCreateInput = z.infer<typeof applicationCreateSchema>;

/**
 * Moving somebody along, or ending it.
 *
 * The reason is required when the stage is REJECTED — "rejected" on its own
 * answers nothing three months later, and it is the only thing that tells a
 * bad advert from a bad interview loop.
 */
export const applicationStageChangeSchema = z
  .object({
    stage: applicationStageSchema,
    rejectionReason: rejectionReasonSchema.optional(),
    rejectionNote: optionalStr(2000),
  })
  .refine((d) => d.stage !== 'REJECTED' || Boolean(d.rejectionReason), {
    path: ['rejectionReason'],
    message: 'Why are they not going forward?',
  })
  .refine((d) => d.rejectionReason !== 'OTHER' || Boolean(d.rejectionNote), {
    path: ['rejectionNote'],
    message: 'Say what "something else" was',
  });
export type ApplicationStageChangeInput = z.infer<typeof applicationStageChangeSchema>;

export const applicationQuerySchema = paginationQuerySchema.extend({
  openingId: z.string().optional(),
  candidateId: z.string().optional(),
  stage: applicationStageSchema.optional(),
});

// ── Interviews ────────────────────────────────────────────────────────

export const interviewCreateSchema = z.object({
  applicationId: z.string().trim().min(1),
  interviewerId: optionalStr(40),
  /** An ISO instant — the time is real, not a date. */
  scheduledFor: z.string().trim().min(1, 'When is it?'),
  durationMinutes: z.coerce.number().int().min(5).max(600).default(45),
  mode: interviewModeSchema.default('VIDEO'),
  round: optionalStr(80),
});
export type InterviewCreateInput = z.infer<typeof interviewCreateSchema>;

/**
 * What the interviewer writes afterwards. Submitting freezes it — see the
 * model comment; a recommendation that can be rewritten after the decision is
 * evidence of nothing.
 */
export const interviewFeedbackSchema = z.object({
  recommendation: interviewRecommendationSchema,
  notes: trimmed(8000).min(1, 'What did you make of them?'),
});
export type InterviewFeedbackInput = z.infer<typeof interviewFeedbackSchema>;

// ── Offers ────────────────────────────────────────────────────────────

export const offerCreateSchema = z.object({
  applicationId: z.string().trim().min(1),
  designationId: optionalStr(40),
  departmentId: optionalStr(40),
  locationId: optionalStr(40),
  employmentTypeId: optionalStr(40),
  monthlyCtc: z.coerce.number().min(1, 'What are they being offered?'),
  joinDate: dateOnlySchema,
  expiresOn: dateOnlySchema.optional(),
  notes: optionalStr(4000),
});
export type OfferCreateInput = z.infer<typeof offerCreateSchema>;

export const offerRespondSchema = z.object({
  status: z.enum(['ACCEPTED', 'DECLINED', 'WITHDRAWN']),
  notes: optionalStr(2000),
});
export type OfferRespondInput = z.infer<typeof offerRespondSchema>;

/**
 * Converting an accepted offer into staff.
 *
 * Only two fields, and that is the point: everything else — the name, the
 * personal email, the job, the join date — is on the offer and the candidate
 * already. A work email is asked for because a candidate does not have one,
 * and the employee code because an organization may run its own numbering.
 */
export const hireSchema = z.object({
  workEmail: z.email().trim().toLowerCase(),
  employeeCode: optionalStr(20),
});
export type HireInput = z.infer<typeof hireSchema>;
