import { Badge } from '@hrms/ui/components/badge';
import { cn } from '@hrms/ui/lib/utils';
import type { DerivedStatus } from '../api';

/** Colour is never the only signal — the label always accompanies it. */
export const STATUS_STYLE: Record<DerivedStatus, { label: string; badge: string; dot: string }> = {
  PRESENT: {
    label: 'Present',
    badge: 'bg-success/15 text-success-text border-transparent',
    dot: 'bg-success',
  },
  WFH: {
    label: 'Work from home',
    badge: 'bg-info/15 text-info-text border-transparent',
    dot: 'bg-info',
  },
  HALF_DAY: {
    label: 'Half day',
    badge: 'bg-warning/15 text-warning-text border-transparent',
    dot: 'bg-warning',
  },
  ABSENT: {
    label: 'Absent',
    badge: 'bg-destructive/15 text-destructive-text border-transparent',
    dot: 'bg-destructive',
  },
  ON_LEAVE: {
    label: 'On leave',
    badge: 'bg-primary/15 text-primary-text border-transparent',
    dot: 'bg-primary',
  },
  HOLIDAY: {
    label: 'Holiday',
    badge: 'bg-accent text-accent-foreground border-transparent',
    dot: 'bg-accent-foreground/60',
  },
  WEEK_OFF: {
    label: 'Week off',
    badge: 'bg-muted text-muted-foreground border-transparent',
    dot: 'bg-muted-foreground/40',
  },
  NOT_MARKED: {
    label: 'Not marked',
    badge: 'bg-transparent text-muted-foreground',
    dot: 'bg-border',
  },
  NOT_EMPLOYED: {
    label: 'Not employed',
    badge: 'bg-transparent text-muted-foreground/70',
    dot: 'bg-transparent',
  },
  FUTURE: { label: '—', badge: 'bg-transparent text-muted-foreground/60', dot: 'bg-transparent' },
};

export function AttendanceStatusBadge({
  status,
  isLate,
  remoteApproved,
}: {
  status: DerivedStatus;
  isLate?: boolean;
  /**
   * Null when the question does not arise. Only `false` earns a badge —
   * "approved" is the expected case and labelling it would put a chip on
   * almost every remote day, which is how a signal stops being one.
   */
  remoteApproved?: boolean | null;
}) {
  const style = STATUS_STYLE[status];
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <Badge className={cn(style.badge)}>{style.label}</Badge>
      {isLate && <Badge className="border-transparent bg-warning/15 text-warning-text">Late</Badge>}
      {remoteApproved === false && (
        <Badge className="border-transparent bg-warning/15 text-warning-text">Unplanned</Badge>
      )}
    </span>
  );
}
