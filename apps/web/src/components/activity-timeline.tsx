'use client';

import { Skeleton } from '@hrms/ui/components/skeleton';
import { EmptyState } from '@/components/empty-state';
import { ErrorState } from '@/components/error-state';
import type { ActivityEntry } from '@/features/resignations/types';

const stamp = new Intl.DateTimeFormat('en-IN', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
});

/**
 * A dot-namespaced action turned into a sentence.
 *
 * The map holds only the ones worth phrasing; anything else falls back to the
 * last two segments with the underscores taken out, so a new action added
 * elsewhere in the app reads as "probation extend" rather than disappearing or
 * showing a raw code.
 */
const LABEL: Record<string, string> = {
  'resignation.submit': 'Resignation submitted',
  'resignation.update': 'Request updated',
  'resignation.withdraw': 'Resignation withdrawn',
  'resignation.manager_approve': 'Approved by manager',
  'resignation.manager_reject': 'Rejected by manager',
  'resignation.request_changes': 'Changes requested',
  'resignation.hr_approve': 'Approved by HR',
  'resignation.hr_reject': 'Rejected by HR',
  'resignation.complete': 'Resignation closed',
  'resignation.reopen': 'Reopened',
  'offboarding.start': 'Offboarding started',
  'offboarding.reschedule': 'Last working date changed',
  'offboarding.complete': 'Offboarding completed',
  'offboarding.cancel': 'Offboarding cancelled',
  'employee.create': 'Employee record created',
  'employee.update': 'Record updated',
  'employee.confirm': 'Confirmed off probation',
  'employee.probation.extend': 'Probation extended',
  'employee.offboard': 'Exit recorded',
  'employee.role.change': 'Role changed',
  'employee.bank.update': 'Bank details updated',
  'onboarding.approve': 'Onboarding approved',
};

function actionLabel(action: string): string {
  return (
    LABEL[action] ??
    action
      .split('.')
      .slice(-2)
      .join(' ')
      .replaceAll('_', ' ')
      .replace(/^./, (c) => c.toUpperCase())
  );
}

/** The one or two facts on a row worth showing without opening anything. */
function detailOf(entry: ActivityEntry): string | null {
  const meta = entry.meta;
  if (!meta) return null;
  const note = typeof meta.note === 'string' ? meta.note : null;
  const after = (meta.after ?? null) as Record<string, unknown> | null;
  const date =
    after && typeof after.lastWorkingDate === 'string'
      ? `Last working day ${after.lastWorkingDate}`
      : after && typeof after.confirmedOn === 'string'
        ? `Confirmed on ${after.confirmedOn}`
        : null;
  return [date, note].filter(Boolean).join(' · ') || null;
}

interface ActivityTimelineProps {
  entries: ActivityEntry[] | undefined;
  loading: boolean;
  error?: boolean;
  onRetry?: () => void;
  emptyHint?: string;
}

/**
 * The audit trail for one record, newest first.
 *
 * An `<ol>` because it is an ordered list of events, and a screen reader
 * announcing "list, 6 items" is the right thing to hear. The markup was
 * previously inline in the salary-revision page; two call sites earned it a
 * component.
 */
export function ActivityTimeline({
  entries,
  loading,
  error,
  onRetry,
  emptyHint,
}: ActivityTimelineProps) {
  if (loading) {
    return (
      <div className="space-y-2">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-14 w-full rounded-lg" />
        ))}
      </div>
    );
  }

  // Distinguishable from "nothing here yet", which is the failure this exists
  // to avoid: a query that errored looking like a record with no history.
  if (error) {
    return <ErrorState onRetry={onRetry} hint="The history could not be loaded." />;
  }

  if (!entries?.length) {
    return <EmptyState title="Nothing recorded yet" hint={emptyHint} />;
  }

  return (
    <ol className="relative space-y-0">
      {entries.map((entry, index) => {
        const detail = detailOf(entry);
        return (
          <li key={entry.id} className="relative flex gap-3 pb-4 last:pb-0">
            {/* The rail, drawn between dots rather than behind the last one. */}
            <div className="flex flex-col items-center" aria-hidden>
              <span className="mt-1.5 size-2 shrink-0 rounded-full bg-primary" />
              {index < entries.length - 1 && <span className="w-px flex-1 bg-border" />}
            </div>
            <div className="min-w-0 flex-1">
              <p className="font-medium text-sm">{actionLabel(entry.action)}</p>
              <p className="text-muted-foreground text-xs">
                {/* "System" rather than a blank: the daily tick is a real actor. */}
                {entry.actor?.name ?? entry.actor?.email ?? 'System'} ·{' '}
                <time dateTime={entry.createdAt}>{stamp.format(new Date(entry.createdAt))}</time>
              </p>
              {detail && <p className="mt-1 break-words text-sm">{detail}</p>}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
