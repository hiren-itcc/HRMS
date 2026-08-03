import type { EmployeeStatus } from '@hrms/types';
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
