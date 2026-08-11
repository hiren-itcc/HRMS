'use client';

import { Alert } from '@hrms/ui/components/alert';
import { Button } from '@hrms/ui/components/button';
import { Skeleton } from '@hrms/ui/components/skeleton';
import { useQuery } from '@tanstack/react-query';
import { Eye, Target } from 'lucide-react';
import Link from 'next/link';
import { type Column, DataTable } from '@/components/data-table';
import { EmptyState } from '@/components/empty-state';
import { ErrorState } from '@/components/error-state';
import { IconAction } from '@/components/icon-action';
import { formatWeight, performanceApi, performanceKeys } from '@/features/performance/api';
import {
  GoalStatusBadge,
  OverdueBadge,
  RatingBadge,
  ReviewStatusBadge,
} from '@/features/performance/components/performance-badges';
import type { Goal, Review } from '@/features/performance/types';

const dateFmt = new Intl.DateTimeFormat('en-IN', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});
const showDate = (iso: string) => dateFmt.format(new Date(iso));

/**
 * Weights are a choice, not a requirement.
 *
 * All-zero is silent: an unweighted goal set is legitimate and forcing weights
 * onto a three-goal list is ceremony. Partly-weighted and not-totalling-100 are
 * both worth saying, and the wording distinguishes "you have not finished
 * allocating" from "you have allocated too much" — the same two messages the
 * API refuses a submission with.
 */
function WeightLedger({ goals }: { goals: Goal[] }) {
  const weighted = goals.filter((goal) => goal.weight > 0);
  if (weighted.length === 0) return null;

  const total = weighted.reduce((sum, goal) => sum + goal.weight, 0);
  if (weighted.length < goals.length) {
    const bare = goals.length - weighted.length;
    return (
      <Alert variant="warning">
        {bare} of these goals {bare === 1 ? 'has' : 'have'} no weight while the others do. Weight
        all of them, or none.
      </Alert>
    );
  }
  if (total > 100) {
    return <Alert variant="warning">The weights total {total}%. Trim them to 100%.</Alert>;
  }
  if (total < 100) {
    return (
      <p className="text-muted-foreground text-sm">
        Weights total {total}%. {100 - total}% of the cycle is unallocated.
      </p>
    );
  }
  return null;
}

export default function MyPerformancePage() {
  const cycleQuery = useQuery({
    queryKey: performanceKeys.activeCycle(),
    queryFn: () => performanceApi.activeCycle(),
  });

  const reviewParams = { page: 1, limit: 20, order: 'desc' as const, scope: 'own' as const };
  const reviewsQuery = useQuery({
    queryKey: performanceKeys.reviews(reviewParams),
    queryFn: () => performanceApi.listReviews(reviewParams),
  });

  const cycle = cycleQuery.data ?? null;
  const goalParams = {
    page: 1,
    limit: 50,
    order: 'asc' as const,
    scope: 'own' as const,
    cycleId: cycle?.id,
  };
  const goalsQuery = useQuery({
    queryKey: performanceKeys.goals(goalParams),
    queryFn: () => performanceApi.listGoals(goalParams),
    enabled: !!cycle,
  });

  if (cycleQuery.isPending || reviewsQuery.isPending) {
    return <Skeleton className="h-64 w-full max-w-3xl rounded-2xl" />;
  }
  if (cycleQuery.isError || reviewsQuery.isError) {
    return (
      <ErrorState
        onRetry={() => {
          cycleQuery.refetch();
          reviewsQuery.refetch();
        }}
      />
    );
  }

  const reviews = reviewsQuery.data?.data ?? [];
  const current = reviews.find((review) => review.cycleId === cycle?.id);
  const earlier = reviews.filter((review) => review.cycleId !== cycle?.id);
  const goals = goalsQuery.data?.data ?? [];

  /* Nothing has ever run. One empty state, and no disabled controls — an
     employee cannot make a cycle appear, so offering them a button would only
     lead to a refusal. */
  if (!cycle && earlier.length === 0) {
    return (
      <EmptyState
        icon={Target}
        title="No review cycles yet"
        hint="When HR opens one, your goals and your self-assessment will appear here."
      />
    );
  }

  const columns: Column<Goal>[] = [
    {
      key: 'goal',
      header: 'Goal',
      alwaysVisible: true,
      render: (row) => (
        <div>
          <span className="font-medium">{row.title}</span>
          {row.description && (
            <span className="block truncate text-muted-foreground text-xs">{row.description}</span>
          )}
        </div>
      ),
    },
    {
      key: 'weight',
      header: 'Weight',
      render: (row) => (
        <span className="tabular-nums">{row.weight > 0 ? formatWeight(row.weight) : '—'}</span>
      ),
    },
    {
      key: 'due',
      header: 'Due',
      className: 'hidden sm:table-cell',
      render: (row) => (
        <span className="flex flex-wrap items-center gap-1.5">
          {row.dueOn ? showDate(row.dueOn) : '—'}
          {row.overdue && <OverdueBadge />}
        </span>
      ),
    },
    {
      key: 'progress',
      header: 'Progress',
      // The number beside the bar, always: a bar alone is colour-only
      // information, which is the one thing the design rules forbid outright.
      render: (row) => <span className="tabular-nums">{row.progress}%</span>,
    },
    { key: 'status', header: 'Status', render: (row) => <GoalStatusBadge status={row.status} /> },
  ];

  return (
    <div className="max-w-4xl space-y-5">
      {cycle && (
        <div className="space-y-4 rounded-xl border p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="font-medium">{cycle.name}</p>
              <p className="text-muted-foreground text-sm">
                {showDate(cycle.periodStart)} – {showDate(cycle.periodEnd)}
                {cycle.dueOn ? ` · assessments due ${showDate(cycle.dueOn)}` : ''}
              </p>
            </div>
            {current && <ReviewStatusBadge status={current.status} />}
          </div>

          {current && <ReviewCallout review={current} />}
        </div>
      )}

      {cycle && (
        <div className="space-y-3">
          <h2 className="font-medium text-sm">My goals</h2>
          <DataTable
            columns={columns}
            rows={goals}
            rowKey={(row) => row.id}
            loading={goalsQuery.isPending}
            error={goalsQuery.isError}
            onRetry={() => goalsQuery.refetch()}
            emptyTitle="No goals for this cycle"
            emptyHint="Write down what you are working towards, and how much of the cycle each one is worth."
          />
          <WeightLedger goals={goals} />
        </div>
      )}

      {earlier.length > 0 && (
        <div className="space-y-3">
          <h2 className="font-medium text-sm">Earlier cycles</h2>
          <ul className="divide-y rounded-xl border">
            {earlier.map((review) => (
              <li key={review.id} className="flex items-center justify-between gap-3 p-3">
                <div>
                  <span className="font-medium">{review.cycle?.name ?? 'Cycle'}</span>
                  <span className="block text-muted-foreground text-xs">
                    {review.acknowledgedAt
                      ? `Signed off ${showDate(review.acknowledgedAt)}`
                      : 'Not signed off'}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <RatingBadge rating={review.managerRating} />
                  <IconAction
                    label={`Open the ${review.cycle?.name ?? 'earlier'} review`}
                    icon={Eye}
                    render={<Link href={`/performance/reviews/${review.id}`} />}
                  />
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/**
 * What the cycle wants from this person right now, in words.
 *
 * Driven entirely by the payload's capability flags rather than by a status
 * comparison here — in particular `managerVisibleToEmployee`, which is why an
 * unshared manager rating cannot reach this component to be accidentally
 * rendered.
 */
function ReviewCallout({ review }: { review: Review }) {
  if (review.canSelfAssess) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm">Your self-assessment is open.</p>
        <Button render={<Link href={`/performance/reviews/${review.id}`} />}>
          Write my self-assessment
        </Button>
      </div>
    );
  }
  if (review.status === 'PENDING_MANAGER') {
    return (
      <p className="text-muted-foreground text-sm">
        Submitted{review.selfSubmittedAt ? ` on ${showDate(review.selfSubmittedAt)}` : ''}. Waiting
        on {review.reviewer ? review.reviewer.firstName : 'a reviewer to be assigned'}.
      </p>
    );
  }
  if (review.canAcknowledge) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm">Your review is ready to read.</p>
        <Button render={<Link href={`/performance/reviews/${review.id}`} />}>Read it</Button>
      </div>
    );
  }
  if (review.status === 'ACKNOWLEDGED') {
    return (
      <p className="text-muted-foreground text-sm">
        Signed off{review.acknowledgedAt ? ` on ${showDate(review.acknowledgedAt)}` : ''}.
      </p>
    );
  }
  if (review.status === 'CANCELLED') {
    return <p className="text-muted-foreground text-sm">This review was dropped.</p>;
  }
  return null;
}
