import { z } from 'zod';
import { paginationQuerySchema } from './common';

/**
 * The helpdesk: somebody asks the company a question, and somebody at a desk
 * answers it.
 *
 * There is no `Decimal` anywhere in this module and nothing here is money. The
 * only number the API returns is a day count, derived in the mapper from
 * `createdAt` against the caller's today — so nothing here can repeat the
 * mistake that put `NaN` on a recruitment screen, where a `Decimal` serialized
 * to JSON as a string and the web side declared it a number.
 *
 * There is no due date either, for the reason the performance module gives:
 * there is no scheduler in this product, so a stored deadline is a field that
 * goes stale overnight and stays wrong until something happens to touch it. Age
 * is derived, and "oldest first" is what a queue actually sorts on.
 */

// ── Status ────────────────────────────────────────────────────────────

export const TICKET_STATUSES = [
  'OPEN',
  'IN_PROGRESS',
  'WAITING_ON_REQUESTER',
  'RESOLVED',
  'CLOSED',
  'CANCELLED',
] as const;
export const ticketStatusSchema = z.enum(TICKET_STATUSES);
export type TicketStatusCode = (typeof TICKET_STATUSES)[number];

export const TICKET_STATUS_LABELS: Record<TicketStatusCode, string> = {
  OPEN: 'Open',
  IN_PROGRESS: 'In progress',
  WAITING_ON_REQUESTER: 'Waiting on you',
  RESOLVED: 'Resolved',
  CLOSED: 'Closed',
  CANCELLED: 'Cancelled',
};

/**
 * `WAITING_ON_REQUESTER` reads "Waiting on you" because the requester is who
 * sees it most, and it is the one status that asks the reader for something.
 * The queue renders its own wording for the other side.
 */
export const TICKET_STATUS_LABELS_AGENT: Record<TicketStatusCode, string> = {
  ...TICKET_STATUS_LABELS,
  WAITING_ON_REQUESTER: 'Waiting on requester',
};

// ── Priority ──────────────────────────────────────────────────────────

/**
 * Set by whoever works the desk, never by the person asking. A priority field
 * the requester controls is a field that is always URGENT, which is the same as
 * having no priority field at all. Urgency goes in the description, and the
 * person who picks the ticket up translates it.
 */
export const TICKET_PRIORITIES = ['LOW', 'NORMAL', 'HIGH', 'URGENT'] as const;
export const ticketPrioritySchema = z.enum(TICKET_PRIORITIES);
export type TicketPriorityCode = (typeof TICKET_PRIORITIES)[number];

export const TICKET_PRIORITY_LABELS: Record<TicketPriorityCode, string> = {
  LOW: 'Low',
  NORMAL: 'Normal',
  HIGH: 'High',
  URGENT: 'Urgent',
};

// ── Comments ──────────────────────────────────────────────────────────

/**
 * One enum rather than two booleans, because `internal && system` is not a
 * thing and a shape that can represent it will eventually be asked to.
 *
 * `SYSTEM` is why this module has no status-history table. Transitions write a
 * terse entry onto the thread the requester is already reading — "Assigned to
 * Priya Nair", "Moved to In progress" — while `auditMutation` still records the
 * same change as the tamper-evident copy. The alternative was a third
 * representation of what happened, alongside the audit row and the thread, and
 * three things that can disagree.
 *
 * System entries are deliberately always visible and deliberately terse: they
 * carry a status or an assignee and never the content of a note.
 */
export const TICKET_COMMENT_KINDS = ['PUBLIC', 'INTERNAL', 'SYSTEM'] as const;
export const ticketCommentKindSchema = z.enum(TICKET_COMMENT_KINDS);
export type TicketCommentKind = (typeof TICKET_COMMENT_KINDS)[number];

// ── Categories ────────────────────────────────────────────────────────

export const ticketCategoryCreateSchema = z.object({
  name: z.string().trim().min(1, 'Give the category a name').max(60),
  description: z.string().trim().max(300).nullish(),
  /**
   * Who picks these up by default. Validated at save time to actually hold
   * `helpdesk.respond` — a category routing to somebody who cannot act on it
   * produces a queue of silently dead tickets that nobody notices for a week.
   */
  defaultAssigneeId: z.string().nullish(),
  active: z.boolean().default(true),
});
export type TicketCategoryCreateInput = z.infer<typeof ticketCategoryCreateSchema>;

export const ticketCategoryUpdateSchema = ticketCategoryCreateSchema.partial();
export type TicketCategoryUpdateInput = z.infer<typeof ticketCategoryUpdateSchema>;

// ── Tickets ───────────────────────────────────────────────────────────

export const ticketCreateSchema = z.object({
  categoryId: z.string().min(1, 'Pick a category'),
  subject: z.string().trim().min(3, 'Give the ticket a subject').max(200),
  description: z.string().trim().min(1, 'Describe what you need').max(10_000),
});
export type TicketCreateInput = z.infer<typeof ticketCreateSchema>;

/**
 * `internal` is accepted from the client but not trusted: the service refuses
 * it without `helpdesk.respond` rather than quietly downgrading it to a public
 * comment, because a note the author believed was private appearing on the
 * requester's thread is the worst failure this module has.
 */
export const ticketCommentCreateSchema = z.object({
  body: z.string().trim().min(1, 'Write something').max(10_000),
  internal: z.boolean().default(false),
});
export type TicketCommentCreateInput = z.infer<typeof ticketCommentCreateSchema>;

export const ticketAssignSchema = z.object({
  /** `null` returns it to the unassigned queue. */
  assigneeId: z.string().nullable(),
});
export type TicketAssignInput = z.infer<typeof ticketAssignSchema>;

/** Required: "resolved" without saying what was done is not a resolution. */
export const ticketResolveSchema = z.object({
  resolution: z.string().trim().min(1, 'Say what was done').max(5_000),
});
export type TicketResolveInput = z.infer<typeof ticketResolveSchema>;

/**
 * Required, and posted to the thread as a public comment: moving a ticket to
 * "waiting on requester" without saying what is being waited for leaves
 * somebody looking at a status they cannot act on.
 */
export const ticketWaitSchema = z.object({
  note: z.string().trim().min(1, 'Say what you need from them').max(5_000),
});
export type TicketWaitInput = z.infer<typeof ticketWaitSchema>;

export const ticketPrioritySetSchema = z.object({ priority: ticketPrioritySchema });
export type TicketPrioritySetInput = z.infer<typeof ticketPrioritySetSchema>;

export const ticketCategorySetSchema = z.object({ categoryId: z.string().min(1) });
export type TicketCategorySetInput = z.infer<typeof ticketCategorySetSchema>;

export const ticketCancelSchema = z.object({
  reason: z.string().trim().max(300).nullish(),
});
export type TicketCancelInput = z.infer<typeof ticketCancelSchema>;

// ── Queries ───────────────────────────────────────────────────────────

/**
 * `own` is every caller's; `queue` needs `helpdesk.respond` and means assigned
 * to me or unassigned; `all` needs `helpdesk.read`. The service narrows rather
 * than trusting this — asking for a wider scope than you hold is refused, not
 * silently answered with a narrower one, because a narrower answer to a wider
 * question is a different question wearing the same name.
 */
export const TICKET_SCOPES = ['own', 'queue', 'all'] as const;
export const ticketScopeSchema = z.enum(TICKET_SCOPES);
export type TicketScope = (typeof TICKET_SCOPES)[number];

export const ticketQuerySchema = paginationQuerySchema.extend({
  scope: ticketScopeSchema.default('own'),
  status: ticketStatusSchema.optional(),
  priority: ticketPrioritySchema.optional(),
  categoryId: z.string().optional(),
  assigneeId: z.string().optional(),
  search: z.string().trim().max(200).optional(),
});
export type TicketQuery = z.infer<typeof ticketQuerySchema>;

export const ticketCategoryQuerySchema = z.object({
  active: z.coerce.boolean().optional(),
});
export type TicketCategoryQuery = z.infer<typeof ticketCategoryQuerySchema>;
