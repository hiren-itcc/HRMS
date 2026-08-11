import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { TICKET_STATUSES, type TicketStatusCode } from '@hrms/shared';
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
  isSettled,
  mayAct,
  nextStatus,
  type TicketAction,
  ticketAgeDays,
  ticketError,
  visibleComments,
} from './helpdesk.rules';

const ACTIONS: TicketAction[] = [
  'commentAsRequester',
  'commentAsAgent',
  'assign',
  'start',
  'waitOnRequester',
  'resolve',
  'reopen',
  'close',
  'cancel',
  'setPriority',
  'recategorise',
];

describe('the ticket state machine', () => {
  /*
   * The whole table, stated once here so a change to TRANSITIONS has to be a
   * deliberate edit in two places rather than a silent one in a lookup nobody
   * reads. `null` is refused.
   */
  const EXPECTED: Record<TicketStatusCode, Partial<Record<TicketAction, TicketStatusCode>>> = {
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
    CLOSED: { reopen: 'IN_PROGRESS' },
    CANCELLED: {},
  };

  it.each(TICKET_STATUSES)('%s allows exactly what it should', (status) => {
    for (const action of ACTIONS) {
      expect([status, action, nextStatus(status, action)]).toEqual([
        status,
        action,
        EXPECTED[status][action] ?? null,
      ]);
    }
  });

  /* The property the single-lookup idiom exists to buy: a transition cannot be
     legal in one place and illegal in another. */
  it.each(TICKET_STATUSES)('every derived can* on %s agrees with nextStatus', (status) => {
    const derived: [TicketAction, boolean][] = [
      ['commentAsRequester', canCommentAsRequester(status)],
      ['commentAsAgent', canCommentAsAgent(status)],
      ['assign', canAssign(status)],
      ['start', canStart(status)],
      ['waitOnRequester', canWaitOnRequester(status)],
      ['resolve', canResolve(status)],
      ['reopen', canReopen(status)],
      ['close', canClose(status)],
      ['cancel', canCancelTicket(status)],
      ['setPriority', canSetPriority(status)],
      ['recategorise', canRecategorise(status)],
    ];
    for (const [action, flag] of derived) {
      expect([action, flag]).toEqual([action, nextStatus(status, action) !== null]);
    }
  });

  /*
   * The only automatic transition in the module. "Waiting on them" becomes a
   * lie the moment they answer, and nobody remembers to flip it by hand.
   */
  it('a requester replying while waited on puts the ticket back in progress', () => {
    expect(nextStatus('WAITING_ON_REQUESTER', 'commentAsRequester')).toBe('IN_PROGRESS');
  });

  /* "Thanks, that worked" must not put a ticket back on somebody's desk. */
  it('a requester replying to a resolved ticket does not reopen it', () => {
    expect(nextStatus('RESOLVED', 'commentAsRequester')).toBe('RESOLVED');
    expect(nextStatus('RESOLVED', 'commentAsAgent')).toBe('RESOLVED');
  });

  it('a closed ticket can be reopened and a cancelled one cannot', () => {
    expect(nextStatus('CLOSED', 'reopen')).toBe('IN_PROGRESS');
    expect(nextStatus('CANCELLED', 'reopen')).toBeNull();
    for (const action of ACTIONS) expect(nextStatus('CANCELLED', action)).toBeNull();
  });

  it('a settled ticket cannot be picked up or put on hold', () => {
    for (const status of ['RESOLVED', 'CLOSED', 'CANCELLED'] as const) {
      expect(canStart(status)).toBe(false);
      expect(canWaitOnRequester(status)).toBe(false);
      expect(isSettled(status)).toBe(true);
    }
    for (const status of ['OPEN', 'IN_PROGRESS', 'WAITING_ON_REQUESTER'] as const) {
      expect(isSettled(status)).toBe(false);
    }
  });
});

describe('who may act', () => {
  it('a requester cannot do an agent’s job', () => {
    for (const action of ['resolve', 'setPriority', 'recategorise', 'assign', 'start'] as const) {
      expect(mayAct(action, 'REQUESTER')).toBe(false);
    }
  });

  it('an agent cannot post as the requester, and vice versa', () => {
    expect(mayAct('commentAsRequester', 'AGENT')).toBe(false);
    expect(mayAct('commentAsAgent', 'REQUESTER')).toBe(false);
  });

  it('close, reopen and cancel belong to both', () => {
    for (const action of ['close', 'reopen', 'cancel'] as const) {
      expect(mayAct(action, 'REQUESTER')).toBe(true);
      expect(mayAct(action, 'AGENT')).toBe(true);
    }
  });
});

describe('ticketError', () => {
  /* What stops a new status shipping with `undefined` in a 400 body. */
  it('produces a sentence for every status and action pair', () => {
    for (const status of TICKET_STATUSES) {
      for (const action of ACTIONS) {
        const message = ticketError(status, action);
        expect(message).toMatch(/^You cannot .+ — .+\.$/);
        expect(message).not.toContain('undefined');
      }
    }
  });
});

describe('visibleComments', () => {
  const thread = [
    { kind: 'PUBLIC' as const, body: 'a' },
    { kind: 'INTERNAL' as const, body: 'b' },
    { kind: 'SYSTEM' as const, body: 'c' },
    { kind: 'PUBLIC' as const, body: 'd' },
  ];

  /* The failure this module most has to avoid. */
  it('never shows an internal note to somebody who is not an agent', () => {
    expect(visibleComments(thread, false).map((c) => c.body)).toEqual(['a', 'c', 'd']);
  });

  it('shows an agent everything', () => {
    expect(visibleComments(thread, true)).toHaveLength(4);
  });

  /* System entries are the ticket's own history — hiding "moved to In
     progress" from the person waiting hides the only progress they can see. */
  it('keeps system entries for both sides', () => {
    expect(visibleComments(thread, false).some((c) => c.kind === 'SYSTEM')).toBe(true);
  });

  it('preserves order and answers an empty thread with an empty one', () => {
    expect(visibleComments([], false)).toEqual([]);
    expect(visibleComments(thread, false).map((c) => c.body)).toEqual(['a', 'c', 'd']);
  });
});

describe('ticketAgeDays', () => {
  it('is zero on the day it was raised', () => {
    expect(ticketAgeDays('2026-08-11', '2026-08-11')).toBe(0);
  });

  it('counts across a month boundary', () => {
    expect(ticketAgeDays('2026-07-30', '2026-08-02')).toBe(3);
  });

  it('never goes negative on a clock that disagrees', () => {
    expect(ticketAgeDays('2026-08-11', '2026-08-01')).toBe(0);
  });

  it('answers zero rather than NaN for a malformed key', () => {
    expect(ticketAgeDays('not-a-date', '2026-08-11')).toBe(0);
  });
});

/*
 * The rules file is only useful if it stays pure. A `new Date()` in here would
 * make every test above depend on when it ran, and the bug it produces — an age
 * computed in UTC against an IST day key — is exactly the class this repo pins
 * timezones to avoid.
 */
describe('purity', () => {
  /* Comments stripped first — the file's own header says "no Prisma, no clock",
     and a check that reads prose rather than code fails on the sentence
     promising the thing it is checking for. */
  const code = readFileSync(join(__dirname, 'helpdesk.rules.ts'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');

  it('reads no clock and touches no database', () => {
    expect(code).not.toMatch(/new Date\(/);
    expect(code).not.toMatch(/Date\.now\(/);
    expect(code).not.toMatch(/prisma/i);
  });
});
