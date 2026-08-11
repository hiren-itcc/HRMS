'use client';

import { RATING_LABELS, RATING_SCALE, type Rating } from '@hrms/shared';
import { Button } from '@hrms/ui/components/button';
import { Skeleton } from '@hrms/ui/components/skeleton';
import { Textarea } from '@hrms/ui/components/textarea';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Check, Send } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { ErrorState } from '@/components/error-state';
import { useSession } from '@/components/session-provider';
import { formatWeight, performanceApi, performanceKeys } from '@/features/performance/api';
import {
  GoalStatusBadge,
  RatingBadge,
  ReviewStatusBadge,
} from '@/features/performance/components/performance-badges';
import { useApiMutation } from '@/hooks/use-crud';

const dateFmt = new Intl.DateTimeFormat('en-IN', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});
const showDate = (iso: string) => dateFmt.format(new Date(iso));

/**
 * A radio group, not a select.
 *
 * The wording *is* the scale — "3" means nothing without "Meets expectations"
 * beside it — and a select hides every option but one behind a click. One tab
 * stop for the group, arrows within, and all five readable without interacting.
 */
function RatingField({
  name,
  value,
  onChange,
  disabled,
}: {
  name: string;
  value: number | null;
  onChange: (rating: number) => void;
  disabled?: boolean;
}) {
  return (
    <fieldset className="space-y-1.5" disabled={disabled}>
      <legend className="font-medium text-sm">Rating</legend>
      <div className="flex flex-col gap-1.5">
        {RATING_SCALE.map((rating) => (
          <label key={rating} className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name={name}
              value={rating}
              checked={value === rating}
              onChange={() => onChange(rating)}
              className="size-4"
            />
            <span className="tabular-nums">{rating}</span>
            <span className="text-muted-foreground">{RATING_LABELS[rating as Rating]}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export default function ReviewPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const { user } = useSession();

  const query = useQuery({
    queryKey: performanceKeys.review(id),
    queryFn: () => performanceApi.getReview(id),
  });

  const [selfRating, setSelfRating] = useState<number | null>(null);
  const [selfComment, setSelfComment] = useState('');
  const [managerRating, setManagerRating] = useState<number | null>(null);
  const [managerComment, setManagerComment] = useState('');
  const [managerActions, setManagerActions] = useState('');
  const [seeded, setSeeded] = useState(false);

  const review = query.data;

  // Seed the forms once from the server payload, and not again — re-seeding on
  // every render would overwrite what somebody is in the middle of typing.
  if (review && !seeded) {
    setSelfRating(review.selfRating);
    setSelfComment(review.selfComment ?? '');
    setManagerRating(review.managerRating ?? null);
    setManagerComment(review.managerComment ?? '');
    setManagerActions(review.managerActions ?? '');
    setSeeded(true);
  }

  const invalidate = [performanceKeys.all()];

  const saveSelf = useApiMutation({
    mutationFn: () => performanceApi.saveSelf(id, { selfRating, selfComment }),
    invalidate,
    success: 'Saved',
  });
  const submitSelf = useApiMutation({
    mutationFn: () => performanceApi.submitSelf(id, { selfRating, selfComment }),
    invalidate,
    success: 'Sent to your reviewer',
  });
  const saveManager = useApiMutation({
    mutationFn: () =>
      performanceApi.saveManager(id, { managerRating, managerComment, managerActions }),
    invalidate,
    success: 'Saved',
  });
  const share = useApiMutation({
    mutationFn: () => performanceApi.share(id, { managerRating, managerComment, managerActions }),
    invalidate,
    success: 'Shared',
  });
  const acknowledge = useApiMutation({
    mutationFn: () => performanceApi.acknowledge(id, {}),
    invalidate,
    success: 'Signed off',
  });

  if (query.isError) return <ErrorState onRetry={() => query.refetch()} />;
  if (!review) return <Skeleton className="h-96 w-full rounded-xl" />;

  const isMine = review.employeeId === user?.employee?.id;
  const goals = review.goals ?? [];

  return (
    <div className="max-w-3xl space-y-5">
      <Button
        variant="ghost"
        size="sm"
        className="-ml-2"
        render={<Link href={isMine ? '/performance' : '/performance/team'} />}
      >
        <ArrowLeft className="size-4" aria-hidden /> Back
      </Button>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-semibold text-lg">{review.cycle?.name ?? 'Review'}</h1>
          <p className="text-muted-foreground text-sm">
            {review.employee?.firstName} {review.employee?.lastName}
            {review.cycle
              ? ` · ${showDate(review.cycle.periodStart)} – ${showDate(review.cycle.periodEnd)}`
              : ''}
          </p>
        </div>
        <ReviewStatusBadge status={review.status} />
      </div>

      {goals.length > 0 && (
        <section className="space-y-2 rounded-xl border p-4">
          <h2 className="font-medium text-sm">Goals</h2>
          <ul className="divide-y">
            {goals.map((goal) => (
              <li key={goal.id} className="flex items-center justify-between gap-3 py-2">
                <div className="min-w-0">
                  <span className="block truncate font-medium text-sm">{goal.title}</span>
                  <span className="text-muted-foreground text-xs">
                    {goal.weight > 0 ? `${formatWeight(goal.weight)} · ` : ''}
                    {goal.progress}% done
                  </span>
                </div>
                <GoalStatusBadge status={goal.status} />
              </li>
            ))}
          </ul>
          {review.goalSummary?.weightedProgress != null && (
            <p className="text-muted-foreground text-sm tabular-nums">
              Weighted progress: {review.goalSummary.weightedProgress}%
            </p>
          )}
        </section>
      )}

      <section className="space-y-3 rounded-xl border p-4">
        <h2 className="font-medium text-sm">Self-assessment</h2>
        {review.canSelfAssess ? (
          <>
            <RatingField name="self-rating" value={selfRating} onChange={setSelfRating} />
            <Textarea
              aria-label="How the period went"
              placeholder="How did the period go? What landed, what did not, and why."
              value={selfComment}
              onChange={(e) => setSelfComment(e.target.value)}
              rows={6}
            />
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                disabled={saveSelf.isPending}
                onClick={() => saveSelf.mutate(undefined)}
              >
                Save draft
              </Button>
              <Button disabled={submitSelf.isPending} onClick={() => submitSelf.mutate(undefined)}>
                <Send className="size-4" aria-hidden /> Submit
              </Button>
            </div>
            <p className="text-muted-foreground text-xs">
              Once you submit, your reviewer sees this and you cannot change it.
            </p>
          </>
        ) : review.selfComment ? (
          <>
            <RatingBadge rating={review.selfRating} />
            <p className="whitespace-pre-wrap text-sm">{review.selfComment}</p>
          </>
        ) : (
          <p className="text-muted-foreground text-sm">Not written yet.</p>
        )}
      </section>

      {/*
        Rendered only when the API sent the manager half. It omits those keys
        entirely — rather than nulling them — until the review is shared, so an
        unshared rating is not in this page's props to be leaked by a mistake
        here.
      */}
      {(review.canManagerAssess ||
        review.managerVisibleToEmployee ||
        'managerRating' in review) && (
        <section className="space-y-3 rounded-xl border p-4">
          <h2 className="font-medium text-sm">Manager review</h2>
          {review.canManagerAssess ? (
            <>
              <RatingField
                name="manager-rating"
                value={managerRating}
                onChange={setManagerRating}
              />
              <Textarea
                aria-label="Your assessment"
                placeholder="What went well, and what you want to see change."
                value={managerComment}
                onChange={(e) => setManagerComment(e.target.value)}
                rows={6}
              />
              <Textarea
                aria-label="What to do next"
                placeholder="What they should act on before the next cycle."
                value={managerActions}
                onChange={(e) => setManagerActions(e.target.value)}
                rows={3}
              />
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  disabled={saveManager.isPending}
                  onClick={() => saveManager.mutate(undefined)}
                >
                  Save draft
                </Button>
                <Button disabled={share.isPending} onClick={() => share.mutate(undefined)}>
                  <Send className="size-4" aria-hidden /> Share with{' '}
                  {review.employee?.firstName ?? 'them'}
                </Button>
              </div>
              <p className="text-muted-foreground text-xs">
                Nothing here is visible to them until you share it.
              </p>
            </>
          ) : review.managerComment ? (
            <>
              <RatingBadge rating={review.managerRating} />
              <p className="whitespace-pre-wrap text-sm">{review.managerComment}</p>
              {review.managerActions && (
                <div>
                  <p className="font-medium text-sm">What to do next</p>
                  <p className="whitespace-pre-wrap text-sm">{review.managerActions}</p>
                </div>
              )}
            </>
          ) : (
            <p className="text-muted-foreground text-sm">Not written yet.</p>
          )}
        </section>
      )}

      {review.status === 'PENDING_MANAGER' && isMine && (
        <p className="text-muted-foreground text-sm">
          Your manager has your self-assessment. Their half is shared with you when they finish it.
        </p>
      )}

      {review.canAcknowledge && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border p-4">
          <p className="text-sm">Read this, and say so.</p>
          <Button disabled={acknowledge.isPending} onClick={() => acknowledge.mutate(undefined)}>
            <Check className="size-4" aria-hidden /> I have read this
          </Button>
        </div>
      )}

      {review.status === 'ACKNOWLEDGED' && review.acknowledgedAt && (
        <p className="text-muted-foreground text-sm">
          Signed off on {showDate(review.acknowledgedAt)}.
        </p>
      )}
    </div>
  );
}
