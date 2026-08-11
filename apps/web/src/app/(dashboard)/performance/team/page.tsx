'use client';

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@hrms/ui/components/select';
import { useQuery } from '@tanstack/react-query';
import { Eye } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { type Column, DataTable } from '@/components/data-table';
import { IconAction } from '@/components/icon-action';
import { useSession } from '@/components/session-provider';
import { formatRating, performanceApi, performanceKeys } from '@/features/performance/api';
import {
  RatingBadge,
  ReviewStatusBadge,
} from '@/features/performance/components/performance-badges';
import type { Review } from '@/features/performance/types';

const PAGE_SIZE = 20;

export default function PerformanceTeamPage() {
  const { can } = useSession();
  // Awaiting-me first: the inbox exists to answer "what needs me", and an
  // unfiltered list of everything makes that the reader's job.
  const [awaitingMe, setAwaitingMe] = useState(true);
  const [page, setPage] = useState(1);

  const scope: 'team' | 'all' = can('performance.read') ? 'all' : 'team';
  const params = {
    page,
    limit: PAGE_SIZE,
    order: 'desc' as const,
    scope,
    ...(awaitingMe ? { awaitingMe: 'true' as const } : {}),
  };
  const query = useQuery({
    queryKey: performanceKeys.reviews(params),
    queryFn: () => performanceApi.listReviews(params),
  });

  const columns: Column<Review>[] = [
    {
      key: 'employee',
      header: 'Employee',
      alwaysVisible: true,
      render: (row) => (
        <Link href={`/performance/reviews/${row.id}`} className="hover:underline">
          <span className="font-medium">
            {row.employee?.firstName} {row.employee?.lastName}
          </span>
          <span className="block text-muted-foreground text-xs">{row.employee?.employeeCode}</span>
        </Link>
      ),
    },
    {
      key: 'department',
      header: 'Department',
      className: 'hidden md:table-cell',
      render: (row) => row.employee?.department?.name ?? '—',
    },
    {
      key: 'cycle',
      header: 'Cycle',
      className: 'hidden lg:table-cell',
      render: (row) => row.cycle?.name ?? '—',
    },
    {
      key: 'reviewer',
      header: 'Reviewer',
      className: 'hidden lg:table-cell',
      // The one that needs saying out loud: an unassigned review is not
      // "nobody yet", it is stuck until somebody assigns one.
      render: (row) =>
        row.reviewer ? (
          `${row.reviewer.firstName} ${row.reviewer.lastName}`
        ) : (
          <span className="text-warning-text">Not assigned</span>
        ),
    },
    {
      key: 'rating',
      header: 'Rating',
      className: 'hidden sm:table-cell',
      render: (row) =>
        row.managerRating == null ? (
          <span className="text-muted-foreground">{formatRating(null)}</span>
        ) : (
          <RatingBadge rating={row.managerRating} />
        ),
    },
    { key: 'status', header: 'Status', render: (row) => <ReviewStatusBadge status={row.status} /> },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Select
          value={awaitingMe ? 'mine' : 'all'}
          onValueChange={(v) => {
            setAwaitingMe(v === 'mine');
            setPage(1);
          }}
        >
          <SelectTrigger className="w-56" aria-label="Which reviews to show">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="mine">Waiting on me</SelectItem>
            <SelectItem value="all">
              {can('performance.read') ? 'Everyone' : 'My whole team'}
            </SelectItem>
          </SelectContent>
        </Select>
      </div>

      <DataTable
        columns={columns}
        rows={query.data?.data}
        rowKey={(row) => row.id}
        loading={query.isPending}
        error={query.isError}
        onRetry={() => query.refetch()}
        meta={query.data?.meta}
        onPageChange={setPage}
        emptyTitle={awaitingMe ? 'Nothing waiting on you' : 'No reviews'}
        emptyHint={
          awaitingMe
            ? 'Reviews appear here once your reports have submitted their self-assessments.'
            : 'Reviews appear once HR opens a cycle.'
        }
        actions={(row) => (
          /*
            The words carried the distinction — a review waiting on you said
            "Write", the rest said "View". The tooltip carries it now, so
            collapsing to an icon costs nothing.
          */
          <IconAction
            label={`${row.canManagerAssess ? 'Write' : 'View'} ${row.employee?.firstName} ${row.employee?.lastName}’s review`}
            icon={Eye}
            render={<Link href={`/performance/reviews/${row.id}`} />}
          />
        )}
      />
    </div>
  );
}
