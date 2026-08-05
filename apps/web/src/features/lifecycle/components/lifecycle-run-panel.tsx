'use client';

import { Button } from '@hrms/ui/components/button';
import { useQuery } from '@tanstack/react-query';
import { RotateCw } from 'lucide-react';
import { useApiMutation } from '@/hooks/use-crud';
import { lifecycleApi, lifecycleKeys } from '../api';

const stamp = new Intl.DateTimeFormat('en-IN', {
  day: 'numeric',
  month: 'short',
  hour: 'numeric',
  minute: '2-digit',
});

/**
 * The state of the daily check, and a way to run it now.
 *
 * It is here rather than hidden behind an endpoint because the check has no
 * scheduler behind it: it runs when somebody signs in, at most once a day. An
 * administrator who has just changed the policy above, or who is wondering why
 * somebody is still on probation, needs to be able to see when it last ran and
 * press it — otherwise the honest answer to "when will this apply?" is
 * "whenever somebody next logs in", and nothing in the product says so.
 */
export function LifecycleRunPanel() {
  const status = useQuery({
    queryKey: lifecycleKeys.status(),
    queryFn: lifecycleApi.status,
    staleTime: 30_000,
  });

  const run = useApiMutation({
    mutationFn: lifecycleApi.run,
    invalidate: [lifecycleKeys.all(), ['employees'], ['offboardings'], ['resignations']],
    success: (result) =>
      result.confirmed || result.exited
        ? `Confirmed ${result.confirmed}, exited ${result.exited}`
        : 'Nothing was due',
    error: 'Could not run the checks',
  });

  const failures = run.data?.failures ?? [];

  return (
    <div className="mt-2 rounded-xl border bg-muted/40 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="font-medium text-sm">Daily check</p>
          <p className="text-muted-foreground text-xs">
            {status.data?.lastRunAt
              ? `Last ran ${stamp.format(new Date(status.data.lastRunAt))}`
              : 'Has not run yet'}
            {status.data?.dueToday === false && ' · already run today'}
          </p>
        </div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={run.isPending}
          onClick={() => run.mutate()}
        >
          <RotateCw className={run.isPending ? 'size-4 animate-spin' : 'size-4'} aria-hidden />
          Run now
        </Button>
      </div>

      <p className="mt-2 text-muted-foreground text-xs">
        Confirms anyone past their probation end date and closes any notice period that has run out.
        It runs by itself once a day when somebody signs in, and running it twice changes nothing
        the first run already did.
      </p>

      {/* Refusals are reported, not swallowed — the usual one is the last-admin
          guard blocking an exit, which somebody has to see to resolve. */}
      {failures.length > 0 && (
        <ul className="mt-2 space-y-1 text-destructive-text text-xs">
          {failures.map((failure) => (
            <li key={failure.id}>{failure.reason}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
