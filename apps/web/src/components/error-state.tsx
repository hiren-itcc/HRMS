'use client';

import { Alert, AlertAction, AlertDescription, AlertTitle } from '@hrms/ui/components/alert';
import { Button } from '@hrms/ui/components/button';
import { cn } from '@hrms/ui/lib/utils';
import { RotateCw, TriangleAlert } from 'lucide-react';

interface ErrorStateProps {
  title?: string;
  hint?: string;
  onRetry?: () => void;
  retrying?: boolean;
  className?: string;
}

/**
 * A failed load, said out loud. Most screens rendered nothing on error — a
 * table showed its headers over an empty body, which reads as "no data"
 * rather than "this did not load". An error must be distinguishable from an
 * empty result, and it must offer a way forward.
 *
 * Built on coss `Alert` rather than the centred block `EmptyState` uses, so
 * the two are told apart at a glance: a tinted banner is a problem, quiet
 * centred text is simply nothing here.
 */
export function ErrorState({
  title = 'Could not load this',
  hint = 'Something went wrong on our side. Try again in a moment.',
  onRetry,
  retrying,
  className,
}: ErrorStateProps) {
  return (
    <Alert variant="error" className={cn('my-4', className)}>
      <TriangleAlert aria-hidden />
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription>{hint}</AlertDescription>
      {onRetry && (
        <AlertAction>
          <Button variant="outline" size="sm" onClick={onRetry} disabled={retrying}>
            <RotateCw className={cn('size-4', retrying && 'animate-spin')} aria-hidden />
            Try again
          </Button>
        </AlertAction>
      )}
    </Alert>
  );
}
