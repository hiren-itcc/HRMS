import {
  CYCLE_PHASE_LABELS,
  type CyclePhase,
  GOAL_STATUS_LABELS,
  type GoalStatusCode,
  RATING_LABELS,
  type Rating,
  REVIEW_CYCLE_STATUS_LABELS,
  REVIEW_STATUS_LABELS,
  type ReviewCycleStatusCode,
  type ReviewStatusCode,
} from '@hrms/shared';
import { Badge } from '@hrms/ui/components/badge';
import { cn } from '@hrms/ui/lib/utils';
import { CalendarClock } from 'lucide-react';

/**
 * Every badge says its state in words. Colour is a second reading, not the only
 * one — the same rule the asset register, the expense claims and the
 * recruitment pipeline follow, because "is the amber one bad?" is a question a
 * screen about somebody's performance should never make them ask.
 */

const CYCLE_TONE: Record<ReviewCycleStatusCode, string> = {
  DRAFT: 'bg-muted text-muted-foreground',
  OPEN: 'bg-info/15 text-info-text',
  CLOSED: 'bg-muted text-muted-foreground',
};

export function CycleStatusBadge({ status }: { status: ReviewCycleStatusCode }) {
  return (
    <Badge className={cn('border-transparent', CYCLE_TONE[status])}>
      {REVIEW_CYCLE_STATUS_LABELS[status]}
    </Badge>
  );
}

const GOAL_TONE: Record<GoalStatusCode, string> = {
  ACTIVE: 'bg-info/15 text-info-text',
  ACHIEVED: 'bg-success/15 text-success-text',
  MISSED: 'bg-destructive/15 text-destructive-text',
  CANCELLED: 'bg-muted text-muted-foreground',
};

export function GoalStatusBadge({ status }: { status: GoalStatusCode }) {
  return (
    <Badge className={cn('border-transparent', GOAL_TONE[status])}>
      {GOAL_STATUS_LABELS[status]}
    </Badge>
  );
}

const REVIEW_TONE: Record<ReviewStatusCode, string> = {
  PENDING_SELF: 'bg-warning/15 text-warning-text',
  PENDING_MANAGER: 'bg-info/15 text-info-text',
  SHARED: 'bg-success/15 text-success-text',
  ACKNOWLEDGED: 'bg-success/15 text-success-text',
  CANCELLED: 'bg-muted text-muted-foreground',
};

export function ReviewStatusBadge({ status }: { status: ReviewStatusCode }) {
  return (
    <Badge className={cn('border-transparent', REVIEW_TONE[status])}>
      {REVIEW_STATUS_LABELS[status]}
    </Badge>
  );
}

export function CyclePhaseBadge({ phase }: { phase: CyclePhase }) {
  return <Badge variant="outline">{CYCLE_PHASE_LABELS[phase]}</Badge>;
}

/**
 * The number and the words together, always.
 *
 * A bare "4" means nothing without the scale beside it, and the scale is the
 * content of a rating — which is also why the form uses a radio group rather
 * than a select that hides the wording behind a click.
 */
export function RatingBadge({ rating }: { rating: number | null | undefined }) {
  if (rating == null) return <span className="text-muted-foreground">—</span>;
  const label = RATING_LABELS[rating as Rating];
  return (
    <Badge variant="outline" className="tabular-nums">
      {rating} / 5{label ? ` · ${label}` : ''}
    </Badge>
  );
}

/** Derived from the due date, never a stored status — so it cannot go stale. */
export function OverdueBadge() {
  return (
    <Badge className="border-transparent bg-warning/15 text-warning-text">
      <CalendarClock className="size-3" aria-hidden /> Overdue
    </Badge>
  );
}
