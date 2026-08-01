import { Badge } from '@hrms/ui/components/badge';
import type { PaymentStatus, RunStatus } from '../types';

/**
 * Run and payment status share a component but never a scale — they are two
 * different axes, and colouring them alike would suggest a progression that
 * does not exist.
 */
const RUN_VARIANT: Record<
  RunStatus,
  {
    variant: 'default' | 'secondary' | 'success' | 'warning' | 'info' | 'error' | 'outline';
    label: string;
  }
> = {
  DRAFT: { variant: 'outline', label: 'Draft' },
  IN_REVIEW: { variant: 'warning', label: 'In review' },
  APPROVED: { variant: 'info', label: 'Approved' },
  LOCKED: { variant: 'secondary', label: 'Locked' },
  PUBLISHED: { variant: 'success', label: 'Published' },
  CANCELLED: { variant: 'error', label: 'Cancelled' },
};

const PAYMENT_VARIANT: Record<
  PaymentStatus,
  { variant: 'outline' | 'info' | 'success' | 'error' | 'secondary'; label: string }
> = {
  PENDING: { variant: 'outline', label: 'Pending' },
  PROCESSING: { variant: 'info', label: 'Processing' },
  PAID: { variant: 'success', label: 'Paid' },
  FAILED: { variant: 'error', label: 'Failed' },
  CANCELLED: { variant: 'secondary', label: 'Cancelled' },
};

export function RunStatusBadge({ status }: { status: RunStatus }) {
  const { variant, label } = RUN_VARIANT[status];
  return <Badge variant={variant}>{label}</Badge>;
}

export function PaymentStatusBadge({ status }: { status: PaymentStatus }) {
  const { variant, label } = PAYMENT_VARIANT[status];
  return <Badge variant={variant}>{label}</Badge>;
}
