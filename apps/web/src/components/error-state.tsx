'use client';

import { Button } from '@hrms/ui/components/button';
import { cn } from '@hrms/ui/lib/utils';
import { RotateCw, TriangleAlert } from 'lucide-react';

interface ErrorStateProps {
  title?: string;
  hint?: string;
  onRetry?: () => void;
  retrying?: boolean;
  bordered?: boolean;
  className?: string;
}

/**
 * A failed load, said out loud. Most screens rendered nothing on error — a
 * table showed its headers over an empty body, which reads as "no data"
 * rather than "this did not load". An error must be distinguishable from an
 * empty result, and it must offer a way forward.
 */
export function ErrorState({
  title = 'Could not load this',
  hint = 'Something went wrong on our side. Try again in a moment.',
  onRetry,
  retrying,
  bordered,
  className,
}: ErrorStateProps) {
  return (
    <div
      role="alert"
      className={cn(
        'flex flex-col items-center justify-center gap-2 px-6 py-12 text-center',
        bordered && 'rounded-2xl border border-destructive/30 bg-destructive/5',
        className,
      )}
    >
      <TriangleAlert className="size-8 text-destructive-text" aria-hidden />
      <div className="space-y-1">
        <p className="font-medium text-sm">{title}</p>
        <p className="text-muted-foreground text-xs">{hint}</p>
      </div>
      {onRetry && (
        <Button variant="outline" size="sm" className="mt-1" onClick={onRetry} disabled={retrying}>
          <RotateCw className={cn('size-4', retrying && 'animate-spin')} aria-hidden />
          Try again
        </Button>
      )}
    </div>
  );
}
