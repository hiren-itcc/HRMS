import { TICKET_STATUS_LABELS, type TicketCommentKind, type TicketStatusCode } from '@hrms/shared';
import {
  canAssign,
  canCancelTicket,
  canClose,
  canCommentAsAgent,
  canCommentAsRequester,
  canRecategorise,
  canReopen,
  canResolve,
  canSetPriority,
  canStart,
  canWaitOnRequester,
  ticketAgeDays,
  visibleComments,
} from './helpdesk.rules';

/**
 * Rows to payloads.
 *
 * The usual job of a mapper in this codebase is turning `Decimal` into
 * `number`, and this module has none to turn — nothing here is money. The only
 * number it produces is a day count, computed from two date keys, so no field
 * here can repeat the mistake that put `NaN` on a recruitment screen.
 *
 * What it does instead is decide what the caller is allowed to see and do. The
 * `can*` flags exist so the screens never re-implement the state machine: a
 * button is rendered because the API said so, not because the web side happened
 * to agree about what `RESOLVED` means.
 */

interface PersonRow {
  id: string;
  firstName: string;
  lastName: string;
  employeeCode: string;
}

const person = (row: PersonRow | null | undefined) =>
  row
    ? {
        id: row.id,
        name: `${row.firstName} ${row.lastName}`,
        employeeCode: row.employeeCode,
      }
    : null;

interface CommentRow {
  id: string;
  kind: TicketCommentKind;
  body: string;
  createdAt: Date;
  author: { id: string; email: string; employee: PersonRow | null } | null;
}

interface TicketRow {
  id: string;
  subject: string;
  description: string;
  status: TicketStatusCode;
  priority: string;
  resolution: string | null;
  createdAt: Date;
  updatedAt: Date;
  assignedAt: Date | null;
  resolvedAt: Date | null;
  closedAt: Date | null;
  requesterId: string;
  assigneeId: string | null;
  category: { id: string; name: string } | null;
  requester?: PersonRow | null;
  assignee?: PersonRow | null;
  comments?: CommentRow[];
}

/**
 * Who the caller is *to this ticket* — which is not the same question as what
 * permissions they hold. Somebody with `helpdesk.respond` reading their own
 * ticket is the requester on it, and must not be offered the agent's buttons on
 * their own complaint.
 */
export interface TicketViewer {
  employeeId: string | null;
  /** Holds `helpdesk.respond`, and is not the person who raised this one. */
  isAgent: boolean;
}

export function mapComment(row: CommentRow) {
  return {
    id: row.id,
    kind: row.kind,
    body: row.body,
    createdAt: row.createdAt.toISOString(),
    /*
     * A name, never an email. The thread is read by the requester, and an
     * agent's address is not something raising a ticket should hand out.
     */
    author: row.author?.employee ? person(row.author.employee) : null,
  };
}

export function mapTicket(row: TicketRow, viewer: TicketViewer, todayKey: string) {
  const status = row.status;
  const isRequester = viewer.employeeId != null && viewer.employeeId === row.requesterId;
  const { isAgent } = viewer;

  return {
    id: row.id,
    subject: row.subject,
    description: row.description,
    status,
    statusLabel: TICKET_STATUS_LABELS[status],
    priority: row.priority,
    resolution: row.resolution,
    category: row.category,
    requester: person(row.requester),
    assignee: person(row.assignee),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    assignedAt: row.assignedAt?.toISOString() ?? null,
    resolvedAt: row.resolvedAt?.toISOString() ?? null,
    closedAt: row.closedAt?.toISOString() ?? null,
    /* Derived, never stored — see the note in helpdesk.rules.ts. */
    ageDays: ticketAgeDays(row.createdAt.toISOString().slice(0, 10), todayKey),

    ...(row.comments ? { comments: visibleComments(row.comments, isAgent).map(mapComment) } : {}),

    /*
     * Both sides of every flag: a status that permits the action, *and* an
     * actor allowed to take it. Keeping the two together here is what stops a
     * requester being shown a Resolve button that the service would refuse.
     */
    canComment:
      (isRequester && canCommentAsRequester(status)) || (isAgent && canCommentAsAgent(status)),
    canAddInternalNote: isAgent && canCommentAsAgent(status),
    canAssign: isAgent && canAssign(status),
    canStart: isAgent && canStart(status),
    canWaitOnRequester: isAgent && canWaitOnRequester(status),
    canResolve: isAgent && canResolve(status),
    canSetPriority: isAgent && canSetPriority(status),
    canRecategorise: isAgent && canRecategorise(status),
    canClose: (isRequester || isAgent) && canClose(status),
    canReopen: (isRequester || isAgent) && canReopen(status),
    canCancel: (isRequester || isAgent) && canCancelTicket(status),
  };
}

export function mapCategory(row: {
  id: string;
  name: string;
  description: string | null;
  active: boolean;
  defaultAssignee?: PersonRow | null;
  _count?: { tickets: number };
}) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    active: row.active,
    defaultAssignee: person(row.defaultAssignee),
    ...(row._count ? { ticketCount: row._count.tickets } : {}),
  };
}
