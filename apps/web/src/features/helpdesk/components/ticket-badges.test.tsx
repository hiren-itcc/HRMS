import { TICKET_STATUSES } from '@hrms/shared';
import { describe, expect, it } from 'vitest';
import {
  InternalNoteBadge,
  TicketAgeBadge,
  TicketPriorityBadge,
  TicketStatusBadge,
} from '@/features/helpdesk/components/ticket-badges';
import { render, screen } from '@/test/render';

describe('ticket status badge', () => {
  it('says the status in words, not only in colour', () => {
    render(<TicketStatusBadge status="IN_PROGRESS" />);
    expect(screen.getByText('In progress')).toBeInTheDocument();
  });

  /*
   * The wording that cannot be the same on both sides. "Waiting on you" is the
   * whole point of the status when the requester reads it, and the opposite of
   * the truth when an agent reads it about somebody else's reply.
   */
  it('addresses the requester and the desk differently when they are the blocker', () => {
    const { unmount } = render(<TicketStatusBadge status="WAITING_ON_REQUESTER" />);
    expect(screen.getByText('Waiting on you')).toBeInTheDocument();
    unmount();

    render(<TicketStatusBadge status="WAITING_ON_REQUESTER" audience="agent" />);
    expect(screen.getByText('Waiting on requester')).toBeInTheDocument();
  });

  /* What stops a new status shipping as an empty pill. */
  it('names every status it can be handed, for both audiences', () => {
    for (const status of TICKET_STATUSES) {
      for (const audience of ['requester', 'agent'] as const) {
        const { container, unmount } = render(
          <TicketStatusBadge status={status} audience={audience} />,
        );
        expect(container.textContent?.trim()).not.toBe('');
        unmount();
      }
    }
  });
});

describe('ticket priority badge', () => {
  /* A badge on every row is a badge on none of them. */
  it('says nothing when the priority is the default', () => {
    const { container } = render(<TicketPriorityBadge priority="NORMAL" />);
    expect(container.textContent).toBe('');
  });

  it('speaks up for the ones somebody chose', () => {
    for (const [priority, label] of [
      ['LOW', 'Low'],
      ['HIGH', 'High'],
      ['URGENT', 'Urgent'],
    ] as const) {
      const { unmount } = render(<TicketPriorityBadge priority={priority} />);
      expect(screen.getByText(label)).toBeInTheDocument();
      unmount();
    }
  });
});

describe('internal note badge', () => {
  /*
   * The requester never receives an internal note — the API drops it from the
   * payload — so this label is not what keeps it private. It is for the agent,
   * who needs to know at a glance which entries the other person can read.
   */
  it('says in words that the requester cannot see it', () => {
    render(<InternalNoteBadge />);
    expect(screen.getByText(/not visible to the requester/i)).toBeInTheDocument();
  });
});

describe('ticket age badge', () => {
  it('stays quiet about a ticket raised this morning', () => {
    const { container } = render(<TicketAgeBadge days={0} />);
    expect(container.textContent).toBe('');
  });

  it('speaks up once it is worth saying', () => {
    render(<TicketAgeBadge days={9} />);
    expect(screen.getByText('9 days old')).toBeInTheDocument();
  });
});
