'use client';

import { Button } from '@hrms/ui/components/button';
import { Textarea } from '@hrms/ui/components/textarea';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { type Column, DataTable } from '@/components/data-table';
import { fullName } from '@/features/employees/types';
import { type Timesheet, timesheetKeys, timesheetsApi } from '@/features/projects/api';
import { TimesheetStatusBadge } from '@/features/projects/components/project-badges';
import { useApiMutation } from '@/hooks/use-crud';

/**
 * Weeks waiting on me.
 *
 * Scoped `team`, which the API reads as "people who report to me" — an
 * org-wide reader still sees only their own reports here, because approving is
 * a management act rather than a reading one.
 */
export default function TimesheetApprovalsPage() {
  const [reviewing, setReviewing] = useState<Timesheet | null>(null);
  const [note, setNote] = useState('');

  const params = { page: 1, limit: 50, scope: 'team' as const, status: 'SUBMITTED' as const };

  const query = useQuery({
    queryKey: timesheetKeys.list(params),
    queryFn: () => timesheetsApi.list(params),
  });

  const invalidate = [timesheetKeys.all()];
  const close = () => {
    setReviewing(null);
    setNote('');
  };

  const approve = useApiMutation({
    mutationFn: (id: string) => timesheetsApi.approve(id, note.trim() ? { note: note.trim() } : {}),
    invalidate,
    success: 'Week approved',
    onSuccess: close,
  });

  const reject = useApiMutation({
    mutationFn: (id: string) => timesheetsApi.reject(id, { note: note.trim() }),
    invalidate,
    success: 'Week sent back',
    onSuccess: close,
  });

  const columns: Column<Timesheet>[] = [
    {
      key: 'who',
      header: 'Who',
      alwaysVisible: true,
      render: (row) => (row.employee ? fullName(row.employee) : '—'),
    },
    {
      key: 'week',
      header: 'Week beginning',
      render: (row) => <span className="tabular-nums">{row.weekStart}</span>,
    },
    {
      key: 'total',
      header: 'Hours',
      render: (row) => <span className="tabular-nums">{row.total}</span>,
    },
    {
      key: 'projects',
      header: 'Projects',
      render: (row) => {
        const codes = [...new Set(row.entries.map((entry) => entry.project?.code ?? '—'))];
        return codes.join(', ');
      },
    },
    {
      key: 'status',
      header: 'Status',
      render: (row) => <TimesheetStatusBadge status={row.status} />,
    },
  ];

  return (
    <div className="space-y-4">
      <DataTable
        columns={columns}
        rows={query.data?.data}
        rowKey={(row) => row.id}
        loading={query.isPending}
        error={query.isError}
        onRetry={() => query.refetch()}
        emptyTitle="Nothing waiting"
        emptyHint="Weeks your reports submit appear here until you approve them or send them back."
        actions={(row) => (
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setReviewing(row);
              setNote('');
            }}
          >
            Review
          </Button>
        )}
      />

      {reviewing && (
        <div className="space-y-3 rounded-md border p-4">
          <h2 className="font-medium">
            {reviewing.employee ? fullName(reviewing.employee) : 'This week'} · week of{' '}
            <span className="tabular-nums">{reviewing.weekStart}</span> ·{' '}
            <span className="tabular-nums">{reviewing.total} hours</span>
          </h2>

          <ul className="space-y-1 text-sm">
            {reviewing.entries.map((entry) => (
              <li key={entry.id} className="flex justify-between gap-4">
                <span>
                  <span className="tabular-nums">{entry.workedOn}</span> ·{' '}
                  {entry.project?.code ?? '—'}
                  {entry.note ? ` · ${entry.note}` : ''}
                </span>
                <span className="tabular-nums">{entry.hours}</span>
              </li>
            ))}
          </ul>

          <div className="space-y-1">
            <label htmlFor="decision-note" className="font-medium text-sm">
              Note
            </label>
            <Textarea
              id="decision-note"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="Required when sending a week back — say which line is wrong."
            />
          </div>

          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="ghost" onClick={close}>
              Cancel
            </Button>
            {/* Disabled without a note, because the API refuses it anyway and a
                refusal you could have been shown first is a wasted round trip. */}
            <Button
              variant="outline"
              disabled={reject.isPending || !note.trim()}
              onClick={() => reject.mutate(reviewing.id)}
            >
              Send it back
            </Button>
            <Button disabled={approve.isPending} onClick={() => approve.mutate(reviewing.id)}>
              Approve
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
