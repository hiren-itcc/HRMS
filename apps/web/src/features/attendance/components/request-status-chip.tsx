import { cn } from '@hrms/ui/lib/utils';

const STYLE: Record<string, string> = {
  PENDING: 'bg-warning/15 text-warning-text',
  APPROVED: 'bg-success/15 text-success-text',
  REJECTED: 'bg-destructive/15 text-destructive-text',
  CANCELLED: 'bg-muted text-muted-foreground',
};

export function RequestStatusChip({ status }: { status: string }) {
  return (
    <span
      className={cn(
        'rounded-full px-2.5 py-0.5 font-medium text-xs',
        STYLE[status] ?? STYLE.CANCELLED,
      )}
    >
      {status.charAt(0) + status.slice(1).toLowerCase()}
    </span>
  );
}
