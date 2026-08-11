import {
  TICKET_PRIORITY_LABELS,
  TICKET_STATUS_LABELS,
  TICKET_STATUS_LABELS_AGENT,
  type TicketPriorityCode,
  type TicketStatusCode,
} from '@hrms/shared';
import { Badge } from '@hrms/ui/components/badge';
import { cn } from '@hrms/ui/lib/utils';
import { Lock } from 'lucide-react';

/**
 * Every badge says its state in words. Colour is a second reading, not the only
 * one — the same rule the expense, asset and leave screens follow.
 */

const STATUS_TONE: Record<TicketStatusCode, string> = {
  OPEN: 'bg-info/15 text-info-text',
  IN_PROGRESS: 'bg-info/15 text-info-text',
  WAITING_ON_REQUESTER: 'bg-warning/15 text-warning-text',
  RESOLVED: 'bg-success/15 text-success-text',
  CLOSED: 'bg-muted text-muted-foreground',
  CANCELLED: 'bg-muted text-muted-foreground',
};

/**
 * `audience` is not decoration.
 *
 * `WAITING_ON_REQUESTER` reads "Waiting on you" to the person who raised the
 * ticket and "Waiting on requester" on the desk. One wording cannot be right in
 * both places: the status exists to tell somebody they are the blocker, and a
 * queue that says "Waiting on you" to an agent about somebody else's reply is
 * telling them the opposite of the truth.
 */
export function TicketStatusBadge({
  status,
  audience = 'requester',
}: {
  status: TicketStatusCode;
  audience?: 'requester' | 'agent';
}) {
  const labels = audience === 'agent' ? TICKET_STATUS_LABELS_AGENT : TICKET_STATUS_LABELS;
  return <Badge className={cn('border-transparent', STATUS_TONE[status])}>{labels[status]}</Badge>;
}

const PRIORITY_TONE: Record<TicketPriorityCode, string> = {
  LOW: 'text-muted-foreground',
  NORMAL: 'text-muted-foreground',
  HIGH: 'text-warning-text',
  URGENT: 'text-destructive-text',
};

/**
 * Normal is the default and says nothing, deliberately: a priority badge on
 * every row is a priority badge on none of them. Low is shown because somebody
 * chose it.
 */
export function TicketPriorityBadge({ priority }: { priority: TicketPriorityCode }) {
  if (priority === 'NORMAL') return null;
  return (
    <Badge variant="outline" className={cn('tabular-nums', PRIORITY_TONE[priority])}>
      {TICKET_PRIORITY_LABELS[priority]}
    </Badge>
  );
}

/**
 * The label on an internal note, and the UI half of the `visibleComments`
 * guarantee.
 *
 * The requester never receives these — the API filters them out of the payload
 * entirely — so this is not what keeps them private. It exists for the other
 * side of the mistake: an agent needs to know at a glance which entries the
 * person they are talking to can read, because a note written in the belief it
 * was private is only half the failure. Word and icon, not a background tint,
 * because a tint is exactly what somebody skimming misses.
 */
export function InternalNoteBadge() {
  return (
    <Badge className="border-transparent bg-warning/15 text-warning-text">
      <Lock className="size-3" aria-hidden /> Internal — not visible to the requester
    </Badge>
  );
}

/** Only once it is worth saying. A ticket raised this morning is not news. */
export function TicketAgeBadge({ days }: { days: number }) {
  if (days < 3) return null;
  return (
    <Badge variant="outline" className="tabular-nums">
      {days} days old
    </Badge>
  );
}
