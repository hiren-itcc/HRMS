'use client';

import { Button } from '@hrms/ui/components/button';
import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, Play } from 'lucide-react';
import { useState } from 'react';
import { type Column, DataTable } from '@/components/data-table';
import { performanceApi, performanceKeys } from '@/features/performance/api';
import {
  CyclePhaseBadge,
  CycleStatusBadge,
} from '@/features/performance/components/performance-badges';
import type { ReviewCycle } from '@/features/performance/types';
import { useApiMutation } from '@/hooks/use-crud';

const dateFmt = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short' });
const showDate = (iso: string) => dateFmt.format(new Date(iso));

const PAGE_SIZE = 20;

export default function CyclesPage() {
  const [page, setPage] = useState(1);

  const params = { page, limit: PAGE_SIZE, order: 'desc' as const };
  const query = useQuery({
    queryKey: performanceKeys.cycles(params),
    queryFn: () => performanceApi.listCycles(params),
  });

  const invalidate = [performanceKeys.all()];

  const open = useApiMutation({
    mutationFn: (cycle: ReviewCycle) => performanceApi.openCycle(cycle.id),
    invalidate,
    success: 'Cycle opened — everybody eligible is enrolled',
  });

  /*
   * Not forced. The API refuses a close with reviews outstanding and says how
   * many, which is the right first answer — somebody who then genuinely wants
   * to close it anyway can say so, and that decision is worth making
   * deliberately rather than by default.
   */
  const close = useApiMutation({
    mutationFn: (cycle: ReviewCycle) => performanceApi.closeCycle(cycle.id, { force: false }),
    invalidate,
    success: 'Cycle closed',
  });

  const columns: Column<ReviewCycle>[] = [
    {
      key: 'name',
      header: 'Cycle',
      alwaysVisible: true,
      render: (row) => <span className="font-medium">{row.name}</span>,
    },
    {
      key: 'period',
      header: 'Period',
      render: (row) => (
        <span className="tabular-nums">
          {showDate(row.periodStart)} – {showDate(row.periodEnd)}
        </span>
      ),
    },
    {
      key: 'due',
      header: 'Assessments due',
      className: 'hidden md:table-cell',
      render: (row) => (row.dueOn ? showDate(row.dueOn) : '—'),
    },
    {
      key: 'phase',
      header: 'Phase',
      className: 'hidden lg:table-cell',
      render: (row) => <CyclePhaseBadge phase={row.phase} />,
    },
    {
      key: 'coverage',
      header: 'Reviews in',
      className: 'hidden sm:table-cell',
      render: (row) =>
        row.coverage ? (
          <span className="tabular-nums">
            {row.coverage.shared + row.coverage.acknowledged} / {row.coverage.total}
          </span>
        ) : (
          '—'
        ),
    },
    { key: 'status', header: 'Status', render: (row) => <CycleStatusBadge status={row.status} /> },
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
        meta={query.data?.meta}
        onPageChange={setPage}
        emptyTitle="No cycles yet"
        emptyHint="A cycle is the window in which everybody sets goals, writes a self-assessment and gets a rating."
        actions={(row) => (
          <span className="flex justify-end gap-2">
            {row.status !== 'OPEN' && (
              <Button
                size="sm"
                variant="outline"
                disabled={open.isPending}
                onClick={() => open.mutate(row)}
              >
                <Play className="size-4" aria-hidden />
                {/* "Open" on a draft, "Reopen" on a closed one — the same
                    endpoint, and the second is also how a late joiner is
                    enrolled without anything else changing. */}
                {row.status === 'DRAFT' ? 'Open' : 'Reopen'}
              </Button>
            )}
            {row.status === 'OPEN' && (
              <Button
                size="sm"
                variant="outline"
                disabled={close.isPending}
                onClick={() => close.mutate(row)}
              >
                <CheckCircle2 className="size-4" aria-hidden /> Close
              </Button>
            )}
          </span>
        )}
      />
      <p className="text-muted-foreground text-sm">
        Opening a cycle enrols everybody eligible and is safe to repeat — run it again to pick up
        anybody who has joined since.
      </p>
    </div>
  );
}
