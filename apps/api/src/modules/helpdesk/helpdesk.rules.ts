import type { TicketCommentKind, TicketStatusCode } from '@hrms/shared';

/**
 * What a ticket may do next, and who may do it.
 *
 * Pure — no Prisma, no clock — like `performance.rules.ts` and `expense.rules.ts`
 * beside it. Today arrives as a `todayKey` argument where it is needed at all,
 * so nothing here can disagree with the caller about what day it is.
 */

// ── The state machine ─────────────────────────────────────────────────

export type TicketAction =
  | 'commentAsRequester'
  | 'commentAsAgent'
  | 'assign'
  | 'start'
  | 'waitOnRequester'
  | 'resolve'
  | 'reopen'
  | 'close'
  | 'cancel'
  | 'setPriority'
  | 'recategorise';

/**
 * The whole state machine, in one lookup, and the only place a transition is
 * written down. `null` means refused.
 *
 * Every `can*` below is derived from this rather than repeating it, so a
 * transition cannot be legal in one place and illegal in another — the failure
 * mode a scattered set of boolean helpers eventually produces.
 *
 * Three entries worth reading twice.
 *
 * **A requester's reply on `WAITING_ON_REQUESTER` moves the ticket back to
 * `IN_PROGRESS` by itself.** It is the only automatic transition in the module,
 * and it is the reason commenting is two actions rather than one: "waiting on
 * them" becomes a lie the moment they answer, and nobody ever remembers to flip
 * it by hand. The queue would otherwise fill with tickets that look blocked on
 * somebody who replied a week ago.
 *
 * **A requester's reply on `RESOLVED` does not reopen it.** "Thanks, that
 * worked" must not put a ticket back on the desk. Reopening is a deliberate
 * button, which is why it is a separate action.
 *
 * **`CLOSED` can be reopened; `CANCELLED` cannot.** A reopened ticket beats the
 * duplicate somebody would otherwise raise — the same call the performance
 * module made for an acknowledged review. Cancelled means the question went
 * away, and reviving that is raising a new one.
 */
const TRANSITIONS: Record<TicketStatusCode, Partial<Record<TicketAction, TicketStatusCode>>> = {
  OPEN: {
    commentAsRequester: 'OPEN',
    commentAsAgent: 'OPEN',
    assign: 'OPEN',
    start: 'IN_PROGRESS',
    resolve: 'RESOLVED',
    cancel: 'CANCELLED',
    setPriority: 'OPEN',
    recategorise: 'OPEN',
  },
  IN_PROGRESS: {
    commentAsRequester: 'IN_PROGRESS',
    commentAsAgent: 'IN_PROGRESS',
    assign: 'IN_PROGRESS',
    waitOnRequester: 'WAITING_ON_REQUESTER',
    resolve: 'RESOLVED',
    cancel: 'CANCELLED',
    setPriority: 'IN_PROGRESS',
    recategorise: 'IN_PROGRESS',
  },
  WAITING_ON_REQUESTER: {
    commentAsRequester: 'IN_PROGRESS',
    commentAsAgent: 'WAITING_ON_REQUESTER',
    assign: 'WAITING_ON_REQUESTER',
    resolve: 'RESOLVED',
    cancel: 'CANCELLED',
    setPriority: 'WAITING_ON_REQUESTER',
    recategorise: 'WAITING_ON_REQUESTER',
  },
  RESOLVED: {
    commentAsRequester: 'RESOLVED',
    commentAsAgent: 'RESOLVED',
    close: 'CLOSED',
    reopen: 'IN_PROGRESS',
  },
  CLOSED: {
    reopen: 'IN_PROGRESS',
  },
  CANCELLED: {},
};

export function nextStatus(
  current: TicketStatusCode,
  action: TicketAction,
): TicketStatusCode | null {
  return TRANSITIONS[current][action] ?? null;
}

const allows = (status: TicketStatusCode, action: TicketAction) =>
  nextStatus(status, action) !== null;

export const canCommentAsRequester = (s: TicketStatusCode) => allows(s, 'commentAsRequester');
export const canCommentAsAgent = (s: TicketStatusCode) => allows(s, 'commentAsAgent');
export const canAssign = (s: TicketStatusCode) => allows(s, 'assign');
export const canStart = (s: TicketStatusCode) => allows(s, 'start');
export const canWaitOnRequester = (s: TicketStatusCode) => allows(s, 'waitOnRequester');
export const canResolve = (s: TicketStatusCode) => allows(s, 'resolve');
export const canReopen = (s: TicketStatusCode) => allows(s, 'reopen');
export const canClose = (s: TicketStatusCode) => allows(s, 'close');
export const canCancelTicket = (s: TicketStatusCode) => allows(s, 'cancel');
export const canSetPriority = (s: TicketStatusCode) => allows(s, 'setPriority');
export const canRecategorise = (s: TicketStatusCode) => allows(s, 'recategorise');

// ── Who may act ───────────────────────────────────────────────────────

export type TicketActor = 'REQUESTER' | 'AGENT';

/**
 * The second table, kept apart from the first for the same reason payroll keeps
 * `RUN_ACTION_PERMISSION` apart from its run states: *what may happen next* and
 * *who is allowed to make it happen* are different questions, and folding them
 * into one lookup makes both harder to read.
 *
 * `close`, `reopen` and `cancel` are the shared ones — the requester accepts a
 * resolution or withdraws their question; an agent closes one nobody came back
 * to, or drops a duplicate.
 */
const ACTION_ACTORS: Record<TicketAction, readonly TicketActor[]> = {
  commentAsRequester: ['REQUESTER'],
  commentAsAgent: ['AGENT'],
  assign: ['AGENT'],
  start: ['AGENT'],
  waitOnRequester: ['AGENT'],
  resolve: ['AGENT'],
  setPriority: ['AGENT'],
  recategorise: ['AGENT'],
  close: ['REQUESTER', 'AGENT'],
  reopen: ['REQUESTER', 'AGENT'],
  cancel: ['REQUESTER', 'AGENT'],
};

export const mayAct = (action: TicketAction, actor: TicketActor): boolean =>
  ACTION_ACTORS[action].includes(actor);

// ── Errors ────────────────────────────────────────────────────────────

const ACTION_NAMES: Record<TicketAction, string> = {
  commentAsRequester: 'reply to this ticket',
  commentAsAgent: 'reply to this ticket',
  assign: 'assign this ticket',
  start: 'pick this ticket up',
  waitOnRequester: 'put this ticket on hold',
  resolve: 'resolve this ticket',
  reopen: 'reopen this ticket',
  close: 'close this ticket',
  cancel: 'cancel this ticket',
  setPriority: 'change the priority',
  recategorise: 'move this ticket to another category',
};

const STATUS_REASONS: Record<TicketStatusCode, string> = {
  OPEN: 'it has not been picked up yet',
  IN_PROGRESS: 'somebody is working on it',
  WAITING_ON_REQUESTER: 'it is waiting on the person who raised it',
  RESOLVED: 'it has already been resolved',
  CLOSED: 'it is closed',
  CANCELLED: 'it was cancelled',
};

export function ticketError(status: TicketStatusCode, action: TicketAction): string {
  return `You cannot ${ACTION_NAMES[action]} — ${STATUS_REASONS[status]}.`;
}

// ── Visibility ────────────────────────────────────────────────────────

export interface CommentLike {
  kind: TicketCommentKind;
}

/**
 * The one piece of this module that must not be got wrong, so it is a function
 * with a test rather than an inline `.filter()` a second call site can forget.
 *
 * An internal note is where an agent writes "this is the third time, escalating
 * to their manager" or "waiting on finance, do not tell them the amount yet".
 * The requester seeing one is the worst failure this module has, and the second
 * worst is an agent believing a note was private when it was not — which is why
 * the UI labels them rather than only styling them differently.
 *
 * `SYSTEM` entries are visible to both sides on purpose: they are the ticket's
 * own history, and hiding "moved to In progress" from the person waiting would
 * be hiding the only progress they can see.
 */
export function visibleComments<T extends CommentLike>(comments: T[], isAgent: boolean): T[] {
  if (isAgent) return comments;
  return comments.filter((c) => c.kind !== 'INTERNAL');
}

// ── Age ───────────────────────────────────────────────────────────────

/**
 * Whole days between two `YYYY-MM-DD` keys, and the reason this module needs no
 * due date: a queue sorts on "oldest first", which is this, and an SLA would
 * need business hours and the holiday calendar — a second copy of leave's day
 * maths living in a module with no business owning one.
 *
 * Both arguments are keys rather than dates so that the caller's today is the
 * only today, and so this file never has to know a timezone.
 */
export function ticketAgeDays(createdKey: string, todayKey: string): number {
  const created = Date.parse(`${createdKey}T00:00:00Z`);
  const today = Date.parse(`${todayKey}T00:00:00Z`);
  if (Number.isNaN(created) || Number.isNaN(today)) return 0;
  return Math.max(0, Math.round((today - created) / 86_400_000));
}

/** Statuses that no longer want anybody's attention. */
const SETTLED: readonly TicketStatusCode[] = ['RESOLVED', 'CLOSED', 'CANCELLED'];
export const isSettled = (s: TicketStatusCode) => SETTLED.includes(s);
