import { EmployeeStatus } from '@hrms/types';
import { Badge } from '@hrms/ui/components/badge';
import { cn } from '@hrms/ui/lib/utils';

const STYLE: Record<EmployeeStatus, { label: string; className: string }> = {
  ONBOARDING: {
    label: 'Onboarding',
    className: 'bg-info/15 text-info-text border-transparent',
  },
  ACTIVE: { label: 'Active', className: 'bg-success/15 text-success-text border-transparent' },
  ON_NOTICE: {
    label: 'On notice',
    className: 'bg-warning/15 text-warning-text border-transparent',
  },
  EXITED: { label: 'Exited', className: 'bg-muted text-muted-foreground border-transparent' },
};

/** Status color is never the only signal — the label always accompanies it. */
export function EmployeeStatusBadge({ status }: { status: EmployeeStatus }) {
  const { label, className } = STYLE[status];
  return <Badge className={cn(className)}>{label}</Badge>;
}

const isEmployeeStatus = (value: unknown): value is EmployeeStatus =>
  typeof value === 'string' && value in EmployeeStatus;

/**
 * The same badge for a value the types have not vouched for — a report row is
 * `string | number | null`, its column metadata carrying no enum. Anything
 * unrecognised prints as text rather than indexing `STYLE` with a key it does
 * not have and taking the page down.
 */
export function EmployeeStatusCell({ value }: { value: string | number | null }) {
  if (!isEmployeeStatus(value)) return <span>{value ?? '—'}</span>;
  return <EmployeeStatusBadge status={value} />;
}
