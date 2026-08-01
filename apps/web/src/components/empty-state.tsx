import { cn } from '@hrms/ui/lib/utils';
import { Inbox, type LucideIcon } from 'lucide-react';

interface EmptyStateProps {
  title: string;
  hint?: string;
  icon?: LucideIcon;
  /**
   * The way out. Of 30+ empty states in the app exactly one offered an
   * action — several told the user to "add the first employee" with nothing
   * to click.
   */
  action?: React.ReactNode;
  /** `bordered` for a standalone panel; plain when already inside a card or table. */
  bordered?: boolean;
  className?: string;
}

export function EmptyState({
  title,
  hint,
  icon: Icon = Inbox,
  action,
  bordered,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-2 px-6 py-12 text-center',
        bordered && 'rounded-2xl border border-dashed',
        className,
      )}
    >
      <Icon className="size-8 text-muted-foreground/50" aria-hidden />
      <div className="space-y-1">
        <p className="font-medium text-sm">{title}</p>
        {hint && <p className="text-muted-foreground text-xs">{hint}</p>}
      </div>
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}
