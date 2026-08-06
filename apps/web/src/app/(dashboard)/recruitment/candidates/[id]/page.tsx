'use client';

import {
  INTERVIEW_MODE_LABELS,
  INTERVIEW_RECOMMENDATION_LABELS,
  INTERVIEW_RECOMMENDATIONS,
  interviewFeedbackSchema,
  REJECTION_REASON_LABELS,
} from '@hrms/shared';
import { Button } from '@hrms/ui/components/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@hrms/ui/components/card';
import { SelectItem } from '@hrms/ui/components/select';
import { Skeleton } from '@hrms/ui/components/skeleton';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Lock, MessageSquarePlus } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import type { z } from 'zod';
import { FormDialog } from '@/components/crud/form-dialog';
import { ErrorState } from '@/components/error-state';
import { FormSelect, FormTextarea } from '@/components/form';
import { useSession } from '@/components/session-provider';
import { formatMoney } from '@/features/payroll/api';
import {
  type CandidateDetail,
  fullName,
  recruitmentApi,
  recruitmentKeys,
} from '@/features/recruitment/api';
import {
  OfferStatusBadge,
  RecommendationBadge,
  StageBadge,
} from '@/features/recruitment/components/recruitment-badges';
import { useApiMutation } from '@/hooks/use-crud';
import { useZodForm } from '@/hooks/use-zod-form';

type Interview = CandidateDetail['applications'][number]['interviews'][number];
type FeedbackValues = z.input<typeof interviewFeedbackSchema>;

const whenFmt = new Intl.DateTimeFormat('en-IN', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
});
const dateFmt = new Intl.DateTimeFormat('en-IN', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-muted-foreground text-xs">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  );
}

export default function CandidateDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { can } = useSession();
  const canGiveFeedback = can('recruitment.interview.submit');

  const query = useQuery({
    queryKey: recruitmentKeys.candidate(id),
    queryFn: () => recruitmentApi.candidate(id),
  });

  const [feedbackFor, setFeedbackFor] = useState<Interview | null>(null);
  const form = useZodForm<FeedbackValues>(interviewFeedbackSchema);

  const submit = useApiMutation({
    mutationFn: (values: FeedbackValues) =>
      recruitmentApi.submitFeedback(
        // biome-ignore lint/style/noNonNullAssertion: the dialog only opens with a row
        feedbackFor!.id,
        interviewFeedbackSchema.parse(values),
      ),
    invalidate: [recruitmentKeys.all()],
    success: 'Feedback recorded',
    onSuccess: () => setFeedbackFor(null),
  });

  if (query.isPending) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }
  if (query.isError || !query.data) return <ErrorState onRetry={() => query.refetch()} />;

  const candidate = query.data;

  return (
    <div className="space-y-6">
      <Button variant="ghost" size="sm" render={<Link href="/recruitment/candidates" />}>
        <ArrowLeft className="size-4" aria-hidden /> All candidates
      </Button>

      <Card>
        <CardHeader>
          <CardTitle>
            {candidate.firstName} {candidate.lastName}
          </CardTitle>
          <CardDescription>
            {candidate.currentTitle ?? 'No current title'}
            {candidate.currentEmployer ? ` at ${candidate.currentEmployer}` : ''}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
            <Row
              label="Email"
              value={
                <a href={`mailto:${candidate.email}`} className="hover:underline">
                  {candidate.email}
                </a>
              }
            />
            <Row label="Phone" value={candidate.phone ?? '—'} />
            <Row
              label="Expects"
              value={
                candidate.expectedMonthlyCtc === null ? (
                  <span className="text-muted-foreground">Not stated</span>
                ) : (
                  <span className="tabular-nums">{formatMoney(candidate.expectedMonthlyCtc)}</span>
                )
              }
            />
            <Row
              label="Notice period"
              value={
                candidate.noticePeriodDays === null ? (
                  <span className="text-muted-foreground">Not stated</span>
                ) : (
                  `${candidate.noticePeriodDays} days`
                )
              }
            />
            <Row label="Source" value={candidate.source ?? '—'} />
            <Row
              label="Referred by"
              value={
                candidate.referrer ? (
                  <Link href={`/employees/${candidate.referrer.id}`} className="hover:underline">
                    {fullName(candidate.referrer)}
                  </Link>
                ) : (
                  '—'
                )
              }
            />
            <Row label="On file since" value={dateFmt.format(new Date(candidate.createdAt))} />
          </dl>
          {candidate.notes && (
            <p className="mt-4 whitespace-pre-wrap text-muted-foreground text-sm">
              {candidate.notes}
            </p>
          )}
        </CardContent>
      </Card>

      {candidate.applications.length === 0 && (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground text-sm">
            They are on file but have not been put forward for anything yet. Open a job and use “Put
            someone forward”.
          </CardContent>
        </Card>
      )}

      {candidate.applications.map((application) => (
        <Card key={application.id}>
          <CardHeader>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <Link
                    href={`/recruitment/openings/${application.opening.id}`}
                    className="hover:underline"
                  >
                    {application.opening.title}
                  </Link>
                  <StageBadge stage={application.stage} />
                </CardTitle>
                <CardDescription>
                  Applied {dateFmt.format(new Date(application.appliedOn))}
                  {application.decidedAt
                    ? ` · decided ${dateFmt.format(new Date(application.decidedAt))}`
                    : ''}
                </CardDescription>
              </div>

              {application.offer && (
                <Link
                  href={`/recruitment/offers/${application.offer.id}`}
                  className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm hover:bg-accent"
                >
                  <span className="tabular-nums">{formatMoney(application.offer.monthlyCtc)}</span>
                  <OfferStatusBadge status={application.offer.status} />
                </Link>
              )}
            </div>
          </CardHeader>

          <CardContent className="space-y-3">
            {application.rejectionReason && (
              <p className="rounded-md bg-muted p-3 text-sm">
                <span className="font-medium">
                  {REJECTION_REASON_LABELS[application.rejectionReason]}
                </span>
                {application.rejectionNote && (
                  <span className="block text-muted-foreground">{application.rejectionNote}</span>
                )}
              </p>
            )}

            {application.interviews.length === 0 ? (
              <p className="text-muted-foreground text-sm">No interviews booked.</p>
            ) : (
              application.interviews.map((interview) => (
                <div key={interview.id} className="space-y-2 rounded-lg border p-3 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="font-medium">
                        {interview.round ?? 'Interview'} · {INTERVIEW_MODE_LABELS[interview.mode]}
                      </p>
                      <p className="text-muted-foreground text-xs">
                        {whenFmt.format(new Date(interview.scheduledFor))} ·{' '}
                        {interview.durationMinutes} min
                        {interview.interviewer ? ` · ${fullName(interview.interviewer)}` : ''}
                      </p>
                    </div>

                    {interview.submittedAt ? (
                      interview.recommendation && (
                        <RecommendationBadge recommendation={interview.recommendation} />
                      )
                    ) : canGiveFeedback && !interview.cancelledAt ? (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          form.reset({ recommendation: undefined, notes: '' });
                          setFeedbackFor(interview);
                        }}
                      >
                        <MessageSquarePlus className="size-4" aria-hidden /> Give feedback
                      </Button>
                    ) : (
                      <span className="text-muted-foreground text-xs">Awaiting feedback</span>
                    )}
                  </div>

                  {interview.notes && (
                    <div className="space-y-1">
                      <p className="whitespace-pre-wrap">{interview.notes}</p>
                      {/*
                        Said plainly rather than left to be discovered. Feedback
                        freezes on submit — a recommendation that can be
                        rewritten after the decision is evidence of nothing.
                      */}
                      <p className="flex items-center gap-1 text-muted-foreground text-xs">
                        <Lock className="size-3" aria-hidden />
                        Submitted{' '}
                        {interview.submittedAt
                          ? dateFmt.format(new Date(interview.submittedAt))
                          : ''}{' '}
                        — this cannot be edited.
                      </p>
                    </div>
                  )}
                </div>
              ))
            )}
          </CardContent>
        </Card>
      ))}

      <FormDialog
        open={feedbackFor !== null}
        onOpenChange={(open) => !open && setFeedbackFor(null)}
        title="Interview feedback"
        description="Submitted once. It cannot be edited afterwards — record another interview if your view changes."
        submitting={submit.isPending}
        submitLabel="Submit"
        onSubmit={form.handleSubmit((values) => submit.mutate(values))}
      >
        <FormSelect control={form.control} name="recommendation" label="Recommendation">
          {INTERVIEW_RECOMMENDATIONS.map((r) => (
            <SelectItem key={r} value={r}>
              {INTERVIEW_RECOMMENDATION_LABELS[r]}
            </SelectItem>
          ))}
        </FormSelect>
        <FormTextarea
          control={form.control}
          name="notes"
          label="What you made of them"
          hint="What was asked, how they answered, and what you would want the next interviewer to probe."
          rows={6}
        />
      </FormDialog>
    </div>
  );
}
