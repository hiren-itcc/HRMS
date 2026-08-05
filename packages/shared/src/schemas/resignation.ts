import { z } from 'zod';
import { dateOnlySchema, paginationQuerySchema } from './common';

/**
 * Why somebody is leaving.
 *
 * A closed list rather than free text because the whole value of recording it
 * is the attrition report six months later, and "better opportunity", "Better
 * Opportunity" and "got a better offer" are three rows in that report. The
 * employee's own words go in `remarks`, which is where nuance belongs.
 */
export const RESIGNATION_REASONS = [
  'BETTER_OPPORTUNITY',
  'COMPENSATION',
  'RELOCATION',
  'HIGHER_STUDIES',
  'HEALTH',
  'PERSONAL',
  'WORK_ENVIRONMENT',
  'CAREER_CHANGE',
  'OTHER',
] as const;

export const resignationReasonSchema = z.enum(RESIGNATION_REASONS);
export type ResignationReasonCode = (typeof RESIGNATION_REASONS)[number];

export const RESIGNATION_REASON_LABELS: Record<ResignationReasonCode, string> = {
  BETTER_OPPORTUNITY: 'Better opportunity',
  COMPENSATION: 'Compensation',
  RELOCATION: 'Relocation',
  HIGHER_STUDIES: 'Higher studies',
  HEALTH: 'Health',
  PERSONAL: 'Personal reasons',
  WORK_ENVIRONMENT: 'Work environment',
  CAREER_CHANGE: 'Career change',
  OTHER: 'Other',
};

export const RESIGNATION_STATUSES = [
  'SUBMITTED',
  'MANAGER_APPROVED',
  'CHANGES_REQUESTED',
  'APPROVED',
  'REJECTED',
  'WITHDRAWN',
  'COMPLETED',
] as const;

export const resignationStatusSchema = z.enum(RESIGNATION_STATUSES);
export type ResignationStatusCode = (typeof RESIGNATION_STATUSES)[number];

export const RESIGNATION_STATUS_LABELS: Record<ResignationStatusCode, string> = {
  SUBMITTED: 'Awaiting manager',
  MANAGER_APPROVED: 'Awaiting HR',
  CHANGES_REQUESTED: 'Changes requested',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
  WITHDRAWN: 'Withdrawn',
  COMPLETED: 'Completed',
};

/**
 * Statuses where the request is still moving. Used for "do you have one open",
 * for the approvals inbox, and — as the matching SQL predicate — by the partial
 * unique index that stops a second one being filed.
 */
export const ACTIVE_RESIGNATION_STATUSES = [
  'SUBMITTED',
  'MANAGER_APPROVED',
  'CHANGES_REQUESTED',
  'APPROVED',
] as const satisfies readonly ResignationStatusCode[];

const remarks = z.string().trim().max(1000);

/**
 * What an employee submits.
 *
 * `lastWorkingDate` is what they are *asking for*. It is not validated against
 * the notice period here — the notice period lives in organization settings,
 * which zod cannot see, and a shortfall is a negotiation rather than an error
 * (see `isShortNotice` on the response). The service checks it against today
 * in the organization's timezone, which zod also cannot see.
 */
export const resignationCreateSchema = z
  .object({
    lastWorkingDate: dateOnlySchema,
    reason: resignationReasonSchema,
    remarks: remarks.optional().nullable(),
  })
  .refine((v) => v.reason !== 'OTHER' || Boolean(v.remarks?.trim()), {
    message: 'Tell us a little more when the reason is Other',
    path: ['remarks'],
  });
export type ResignationCreateInput = z.infer<typeof resignationCreateSchema>;

/** The same fields, while it is still with the employee to change. */
export const resignationUpdateSchema = resignationCreateSchema;
export type ResignationUpdateInput = z.infer<typeof resignationUpdateSchema>;

export const resignationWithdrawSchema = z.object({
  remarks: remarks.optional().nullable(),
});
export type ResignationWithdrawInput = z.infer<typeof resignationWithdrawSchema>;

/**
 * A manager's or HR's decision.
 *
 * One endpoint for all three verbs rather than three, because the transition
 * table already decides what is legal from where — splitting them would mean
 * the same guard written three times. `lastWorkingDate` is HR's override and
 * is refused on anything but an approval, so a rejection cannot quietly move
 * somebody's leaving date.
 */
export const resignationDecisionSchema = z
  .object({
    action: z.enum(['approve', 'reject', 'request_changes']),
    remarks: remarks.optional().nullable(),
    /** HR only, and only on approve. Overrides what the employee asked for. */
    lastWorkingDate: dateOnlySchema.optional().nullable(),
  })
  .refine((v) => v.action === 'approve' || !v.lastWorkingDate, {
    message: 'A last working date can only be set when approving',
    path: ['lastWorkingDate'],
  })
  .refine((v) => v.action !== 'reject' || Boolean(v.remarks?.trim()), {
    message: 'Say why it is being rejected — the employee sees this',
    path: ['remarks'],
  })
  .refine((v) => v.action !== 'request_changes' || Boolean(v.remarks?.trim()), {
    message: 'Say what needs to change — the employee sees this',
    path: ['remarks'],
  });
export type ResignationDecisionInput = z.infer<typeof resignationDecisionSchema>;

export const resignationQuerySchema = paginationQuerySchema.extend({
  status: resignationStatusSchema.optional(),
  reason: resignationReasonSchema.optional(),
  departmentId: z.string().trim().max(40).optional(),
  /** Only what is waiting on the caller to act. Drives the approvals inbox. */
  awaitingMe: z.coerce.boolean().optional(),
});
export type ResignationQuery = z.infer<typeof resignationQuerySchema>;
