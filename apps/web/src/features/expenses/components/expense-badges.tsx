import { EXPENSE_CLAIM_STATUS_LABELS, type ExpenseClaimStatusCode } from '@hrms/shared';
import { Badge } from '@hrms/ui/components/badge';
import { cn } from '@hrms/ui/lib/utils';
import { BanknoteArrowUp } from 'lucide-react';

/**
 * Every badge says its state in words. Colour is a second reading, not the only
 * one — the same rule the asset register, the leave screens and the recruitment
 * pipeline follow, because "is the amber one bad?" is a question a list of
 * money should never make somebody ask.
 */

const CLAIM_TONE: Record<ExpenseClaimStatusCode, string> = {
  DRAFT: 'bg-muted text-muted-foreground',
  SUBMITTED: 'bg-info/15 text-info-text',
  APPROVED: 'bg-success/15 text-success-text',
  REJECTED: 'bg-destructive/15 text-destructive-text',
  CANCELLED: 'bg-muted text-muted-foreground',
};

export function ClaimStatusBadge({ status }: { status: ExpenseClaimStatusCode }) {
  return (
    <Badge className={cn('border-transparent', CLAIM_TONE[status])}>
      {EXPENSE_CLAIM_STATUS_LABELS[status]}
    </Badge>
  );
}

/**
 * Separate from the status badge on purpose.
 *
 * "Approved" and "you have the money" are different questions, and folding the
 * second into the first is how somebody chases a payment that was agreed three
 * weeks ago and paid last Friday. Shown only once it is true — an absent badge
 * reads as "not yet", which is what it means.
 */
export function PaidBadge({ month }: { month: string | null }) {
  return (
    <Badge className="border-transparent bg-success/15 text-success-text">
      <BanknoteArrowUp className="size-3" aria-hidden /> Paid{month ? ` · ${month}` : ''}
    </Badge>
  );
}

/** What an approved-but-unpaid claim is waiting for. */
export function ScheduledBadge({ month }: { month: string }) {
  return (
    <Badge variant="outline" className="tabular-nums">
      Paid with {month}
    </Badge>
  );
}
