import {
  PROJECT_STATUS_LABELS,
  type ProjectStatusCode,
  TIMESHEET_STATUS_LABELS,
  type TimesheetStatusCode,
} from '@hrms/shared';
import { Badge } from '@hrms/ui/components/badge';
import { cn } from '@hrms/ui/lib/utils';

/**
 * Every badge says its state in words. Colour is a second reading, not the only
 * one — the same rule the expense, asset and leave screens follow, because "is
 * the amber one bad?" is a question a list should never make somebody ask.
 */

const PROJECT_TONE: Record<ProjectStatusCode, string> = {
  PLANNED: 'bg-info/15 text-info-text',
  ACTIVE: 'bg-success/15 text-success-text',
  ON_HOLD: 'bg-warning/15 text-warning-text',
  COMPLETED: 'bg-muted text-muted-foreground',
  CANCELLED: 'bg-destructive/15 text-destructive-text',
};

export function ProjectStatusBadge({ status }: { status: ProjectStatusCode }) {
  return (
    <Badge className={cn('border-transparent', PROJECT_TONE[status])}>
      {PROJECT_STATUS_LABELS[status]}
    </Badge>
  );
}

const TIMESHEET_TONE: Record<TimesheetStatusCode, string> = {
  DRAFT: 'bg-muted text-muted-foreground',
  SUBMITTED: 'bg-info/15 text-info-text',
  APPROVED: 'bg-success/15 text-success-text',
  REJECTED: 'bg-destructive/15 text-destructive-text',
};

export function TimesheetStatusBadge({ status }: { status: TimesheetStatusCode }) {
  return (
    <Badge className={cn('border-transparent', TIMESHEET_TONE[status])}>
      {TIMESHEET_STATUS_LABELS[status]}
    </Badge>
  );
}

/**
 * Shown against a project somebody has rolled off.
 *
 * Separate from the status badge because they answer different questions: the
 * project may be perfectly active and this person still not be on it any more,
 * and folding the two together is how a leaver looks like a live allocation.
 */
export function RolledOffBadge({ on }: { on: string }) {
  return (
    <Badge variant="outline" className="tabular-nums">
      Left {on}
    </Badge>
  );
}
