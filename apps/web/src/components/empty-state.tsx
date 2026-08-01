import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@hrms/ui/components/empty';
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
  className?: string;
}

/**
 * Wraps coss `Empty`, whose "icon" media variant stacks two tilted cards
 * behind the glyph — the emptiness reads as a considered state rather than
 * a failed render.
 */
export function EmptyState({
  title,
  hint,
  icon: Icon = Inbox,
  action,
  className,
}: EmptyStateProps) {
  return (
    <Empty className={cn('py-12 md:py-14', className)}>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Icon aria-hidden />
        </EmptyMedia>
        <EmptyTitle className="text-base">{title}</EmptyTitle>
        {hint && <EmptyDescription>{hint}</EmptyDescription>}
      </EmptyHeader>
      {action && <EmptyContent>{action}</EmptyContent>}
    </Empty>
  );
}
