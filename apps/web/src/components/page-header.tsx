import { cn } from '@hrms/ui/lib/utils';

interface PageHeaderProps {
  title: string;
  description?: string;
  /** Right-aligned actions — a primary button, a date badge, a filter. */
  actions?: React.ReactNode;
  className?: string;
}

/**
 * The page title block. `font-bold text-2xl tracking-tight` was retyped in 12
 * files and had already drifted in one; the heading rank now comes from the
 * base type scale and the layout comes from here.
 */
export function PageHeader({ title, description, actions, className }: PageHeaderProps) {
  return (
    <div className={cn('flex flex-wrap items-end justify-between gap-3', className)}>
      <div className="min-w-0">
        <h1>{title}</h1>
        {description && <p className="mt-1 text-muted-foreground text-sm">{description}</p>}
      </div>
      {actions}
    </div>
  );
}
