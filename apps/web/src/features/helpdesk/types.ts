import type { TicketCommentKind, TicketPriorityCode, TicketStatusCode } from '@hrms/shared';

/**
 * The shapes the helpdesk API returns.
 *
 * There is no number here at all except `ageDays`, and that one is derived on
 * the server from two date keys rather than read out of a column — so this
 * feature has no `Decimal`-as-string to trip over, and `Number.parseFloat`
 * appears nowhere in it. If somebody later adds a figure to a ticket, this note
 * is the warning that they have just moved this feature into the class of bug
 * recruitment shipped.
 */

export interface PersonRef {
  id: string;
  name: string;
  employeeCode: string;
}

export interface TicketCategory {
  id: string;
  name: string;
  description: string | null;
  active: boolean;
  defaultAssignee: PersonRef | null;
  ticketCount?: number;
}

export interface TicketComment {
  id: string;
  kind: TicketCommentKind;
  body: string;
  createdAt: string;
  /** Null for a system entry, and for a reply from an account with no employee record. */
  author: PersonRef | null;
}

/**
 * The `can*` flags are the server's answer, not the client's guess.
 *
 * Every one of them folds two questions together — whether the status permits
 * the action, and whether *this reader* is allowed to take it — so a screen
 * that renders a button because the flag is true can never offer something the
 * service would then refuse. Re-deriving them here from `status` would be
 * reimplementing the state machine in a second place, which is exactly what
 * `helpdesk.rules.ts` exists to prevent.
 */
export interface Ticket {
  id: string;
  subject: string;
  description: string;
  status: TicketStatusCode;
  statusLabel: string;
  priority: TicketPriorityCode;
  resolution: string | null;
  category: { id: string; name: string } | null;
  requester: PersonRef | null;
  assignee: PersonRef | null;
  createdAt: string;
  updatedAt: string;
  assignedAt: string | null;
  resolvedAt: string | null;
  closedAt: string | null;
  ageDays: number;
  /** Present only on the detail read, and already filtered for this reader. */
  comments?: TicketComment[];

  canComment: boolean;
  canAddInternalNote: boolean;
  canAssign: boolean;
  canStart: boolean;
  canWaitOnRequester: boolean;
  canResolve: boolean;
  canSetPriority: boolean;
  canRecategorise: boolean;
  canClose: boolean;
  canReopen: boolean;
  canCancel: boolean;
}

export interface TicketSummary {
  mine: number;
  queue: number;
  unassigned: number;
}
