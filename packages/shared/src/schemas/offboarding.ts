import { z } from 'zod';
import { dateOnlySchema, paginationQuerySchema } from './common';

/**
 * Why the offboarding was started.
 *
 * `RESIGNATION` is set automatically when one is approved; the rest are what
 * HR picks when starting an exit directly. Keeping terminations in the same
 * table as resignations is deliberate — the operational work of somebody
 * leaving is identical whichever way it began, and splitting them would mean
 * two lists, two notice calculations and two ways to reach EXITED.
 */
export const OFFBOARDING_REASONS = [
  'RESIGNATION',
  'TERMINATION',
  'CONTRACT_END',
  'RETIREMENT',
  'ABSCONDING',
  'OTHER',
] as const;

export const offboardingReasonSchema = z.enum(OFFBOARDING_REASONS);
export type OffboardingReasonCode = (typeof OFFBOARDING_REASONS)[number];

export const OFFBOARDING_REASON_LABELS: Record<OffboardingReasonCode, string> = {
  RESIGNATION: 'Resignation',
  TERMINATION: 'Termination',
  CONTRACT_END: 'Contract ended',
  RETIREMENT: 'Retirement',
  ABSCONDING: 'Absconding',
  OTHER: 'Other',
};

export const OFFBOARDING_STATUSES = ['IN_PROGRESS', 'COMPLETED', 'CANCELLED'] as const;
export const offboardingStatusSchema = z.enum(OFFBOARDING_STATUSES);
export type OffboardingStatusCode = (typeof OFFBOARDING_STATUSES)[number];

export const OFFBOARDING_STATUS_LABELS: Record<OffboardingStatusCode, string> = {
  IN_PROGRESS: 'Serving notice',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
};

const note = z.string().trim().max(1000);

/**
 * HR starting an exit directly — a termination, a contract ending, somebody
 * retiring. The resignation path never uses this: approving a resignation
 * builds the row from the resignation itself.
 *
 * `RESIGNATION` is refused as a reason here on purpose. An offboarding with
 * that reason and no resignation behind it would be a resignation nobody can
 * find, which is exactly the kind of record that makes an attrition report
 * disagree with the approvals inbox.
 */
export const offboardingCreateSchema = z
  .object({
    employeeId: z.string().trim().min(1),
    reason: offboardingReasonSchema,
    reasonNote: note.optional().nullable(),
    lastWorkingDate: dateOnlySchema,
  })
  .refine((v) => v.reason !== 'RESIGNATION', {
    message: 'Record a resignation instead — that path creates the offboarding itself',
    path: ['reason'],
  })
  .refine((v) => v.reason !== 'OTHER' || Boolean(v.reasonNote?.trim()), {
    message: 'Say what the reason is',
    path: ['reasonNote'],
  });
export type OffboardingCreateInput = z.infer<typeof offboardingCreateSchema>;

/** Notice gets extended and shortened all the time; this is that. */
export const offboardingUpdateSchema = z.object({
  lastWorkingDate: dateOnlySchema,
  reasonNote: note.optional().nullable(),
});
export type OffboardingUpdateInput = z.infer<typeof offboardingUpdateSchema>;

export const offboardingCompleteSchema = z.object({
  /**
   * Defaults to the recorded last working day. Present because the exit that
   * actually happens is not always the one that was planned, and the date is
   * what payroll and attendance read — the status is only the label.
   */
  lastWorkingDate: dateOnlySchema.optional().nullable(),
  note: note.optional().nullable(),
});
export type OffboardingCompleteInput = z.infer<typeof offboardingCompleteSchema>;

export const offboardingCancelSchema = z.object({
  reason: note.min(1, 'Say why the exit is being called off'),
});
export type OffboardingCancelInput = z.infer<typeof offboardingCancelSchema>;

// ── Clearance ─────────────────────────────────────────────────────────

export const OFFBOARDING_TASK_STATUSES = ['PENDING', 'DONE', 'NOT_APPLICABLE'] as const;
export const offboardingTaskStatusSchema = z.enum(OFFBOARDING_TASK_STATUSES);
export type OffboardingTaskStatusCode = (typeof OFFBOARDING_TASK_STATUSES)[number];

export const OFFBOARDING_TASK_STATUS_LABELS: Record<OffboardingTaskStatusCode, string> = {
  PENDING: 'Outstanding',
  DONE: 'Cleared',
  NOT_APPLICABLE: 'Not applicable',
};

/**
 * Signing one line off, or waiving it.
 *
 * A waiver requires a note and a completion does not: "cleared" is the
 * expected outcome and needs no explanation, whereas "this one did not apply"
 * is a judgement somebody will ask about later. Setting it back to PENDING is
 * allowed — a laptop that turned out not to have come back has not come back.
 */
export const offboardingTaskUpdateSchema = z
  .object({
    status: offboardingTaskStatusSchema,
    note: z.string().trim().max(500).optional().nullable(),
  })
  .refine((v) => v.status !== 'NOT_APPLICABLE' || Boolean(v.note?.trim()), {
    message: 'Say why it does not apply',
    path: ['note'],
  });
export type OffboardingTaskUpdateInput = z.infer<typeof offboardingTaskUpdateSchema>;

export const offboardingQuerySchema = paginationQuerySchema.extend({
  status: offboardingStatusSchema.optional(),
  reason: offboardingReasonSchema.optional(),
  departmentId: z.string().trim().max(40).optional(),
});
export type OffboardingQuery = z.infer<typeof offboardingQuerySchema>;
