import { Badge } from '@hrms/ui/components/badge';
import { cn } from '@hrms/ui/lib/utils';
import type { ProbationView } from '../types';

/**
 * Probation as a chip beside the employment status, not instead of it.
 *
 * The two are orthogonal: somebody on probation is ACTIVE, and a leaver can be
 * on notice while still unconfirmed. Folding probation into `EmployeeStatus`
 * would have made those states unrepresentable — and would have leaked into
 * every `status: { notIn: [...] }` filter in attendance, payroll and reports.
 */
export function ProbationBadge({ probation }: { probation: ProbationView }) {
  // Confirmed is the resting state for almost everybody. A chip on every
  // profile saying "Confirmed" would be noise that trains people to ignore the
  // one that says something.
  if (probation.state === 'NONE' || probation.state === 'CONFIRMED') return null;

  const overdue = probation.isOverdue;
  const label = probation.state === 'EXTENDED' ? 'Extended probation' : 'On probation';

  return (
    <Badge
      className={cn(
        'border-transparent',
        overdue ? 'bg-destructive/15 text-destructive-text' : 'bg-info/15 text-info-text',
      )}
    >
      {/* Never colour alone: the words carry the whole meaning on their own. */}
      {overdue ? `${label} — review overdue` : label}
    </Badge>
  );
}

/** "in 27 days" / "5 days ago" / "today", from a signed day count. */
export function relativeDays(days: number): string {
  if (days === 0) return 'today';
  const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
  return rtf.format(days, 'day');
}
