'use client';

import { RESIGNATION_REASON_LABELS } from '@hrms/shared';
import { Alert, AlertDescription, AlertTitle } from '@hrms/ui/components/alert';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@hrms/ui/components/alert-dialog';
import { Button } from '@hrms/ui/components/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@hrms/ui/components/card';
import { Skeleton } from '@hrms/ui/components/skeleton';
import { useQuery } from '@tanstack/react-query';
import { Info, Loader2, LogOut, Pencil, Undo2 } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { EmptyState } from '@/components/empty-state';
import { ErrorState } from '@/components/error-state';
import { FadeInItem, Stagger } from '@/components/motion';
import { resignationKeys, resignationsApi } from '@/features/resignations/api';
import { ResignDialog } from '@/features/resignations/components/resign-dialog';
import {
  ResignationStatusBadge,
  ResignationStepper,
  resignationSteps,
} from '@/features/resignations/components/resignation-status';
import type { Resignation } from '@/features/resignations/types';
import { useApiMutation } from '@/hooks/use-crud';

const dateFmt = new Intl.DateTimeFormat('en-IN', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});
const showDate = (iso: string) => dateFmt.format(new Date(iso));
const relative = (days: number) =>
  new Intl.RelativeTimeFormat('en', { numeric: 'auto' }).format(days, 'day');

function ResignationCard({ resignation }: { resignation: Resignation }) {
  const [editing, setEditing] = useState(false);
  const withEmployee =
    resignation.status === 'SUBMITTED' || resignation.status === 'CHANGES_REQUESTED';

  const withdraw = useApiMutation({
    mutationFn: () => resignationsApi.withdraw(resignation.id, { remarks: null }),
    invalidate: [resignationKeys.all(), ['employees']],
    success: 'Resignation withdrawn',
    error: 'Could not withdraw it',
  });

  const eligibility = useQuery({
    queryKey: resignationKeys.eligibility(),
    queryFn: resignationsApi.eligibility,
  });

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle className="flex flex-wrap items-center gap-2">
                Resignation
                <ResignationStatusBadge status={resignation.status} />
              </CardTitle>
              <CardDescription>Submitted {showDate(resignation.submittedAt)}</CardDescription>
            </div>
            <Button
              variant="outline"
              size="sm"
              render={<Link href={`/resignations/${resignation.id}`} />}
            >
              View details
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <ResignationStepper
            steps={resignationSteps({
              status: resignation.status,
              routedManagerId: resignation.routedManagerId,
              offboardingStatus: resignation.offboarding?.status ?? null,
            })}
          />

          <dl className="grid gap-3 sm:grid-cols-2">
            <div>
              <dt className="text-muted-foreground text-sm">Last working day</dt>
              <dd className="text-sm">
                {showDate(resignation.lastWorkingDate)}{' '}
                <span className="text-muted-foreground">
                  ({relative(resignation.daysUntilLastWorkingDate)})
                </span>
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground text-sm">Reason</dt>
              <dd className="text-sm">{RESIGNATION_REASON_LABELS[resignation.reason]}</dd>
            </div>
          </dl>

          {resignation.status === 'CHANGES_REQUESTED' && (
            <Alert variant="warning">
              <Info aria-hidden />
              <AlertTitle>Sent back to you</AlertTitle>
              <AlertDescription>
                {resignation.managerRemarks ??
                  resignation.hrRemarks ??
                  'Update your request and submit it again.'}
              </AlertDescription>
            </Alert>
          )}

          {resignation.status === 'REJECTED' && (
            <Alert variant="error">
              <Info aria-hidden />
              <AlertTitle>Not approved</AlertTitle>
              <AlertDescription>
                {resignation.hrRemarks ?? resignation.managerRemarks ?? 'No reason was recorded.'}
              </AlertDescription>
            </Alert>
          )}

          {withEmployee && (
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
                <Pencil className="size-4" aria-hidden /> Change my request
              </Button>
              {/*
               * Confirmed, because it is one press and there is no undo: a
               * withdrawn request is terminal, and getting back to where they
               * were means filing a fresh one.
               */}
              <AlertDialog>
                <AlertDialogTrigger render={<Button size="sm" variant="outline" />}>
                  <Undo2 className="size-4" aria-hidden /> Withdraw
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Withdraw your resignation?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This closes the request for good. You stay an employee and nothing about your
                      record changes — but if you change your mind again you will have to submit a
                      new resignation.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Keep it open</AlertDialogCancel>
                    <AlertDialogAction
                      disabled={withdraw.isPending}
                      onClick={() => withdraw.mutate()}
                    >
                      {withdraw.isPending && (
                        <Loader2 className="size-4 animate-spin" aria-hidden />
                      )}
                      Withdraw
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          )}
        </CardContent>
      </Card>

      {eligibility.data && (
        <ResignDialog
          open={editing}
          onOpenChange={setEditing}
          eligibility={eligibility.data}
          editing={resignation}
        />
      )}
    </>
  );
}

export default function MyResignationPage() {
  const [resigning, setResigning] = useState(false);

  const eligibility = useQuery({
    queryKey: resignationKeys.eligibility(),
    queryFn: resignationsApi.eligibility,
  });
  const history = useQuery({
    queryKey: resignationKeys.mine(),
    queryFn: resignationsApi.mine,
  });

  if (eligibility.isPending || history.isPending) {
    return <Skeleton className="h-64 w-full max-w-3xl rounded-2xl" />;
  }
  if (eligibility.isError || history.isError) {
    return (
      <ErrorState
        onRetry={() => {
          eligibility.refetch();
          history.refetch();
        }}
      />
    );
  }

  const open = eligibility.data.current;
  const past = (history.data ?? []).filter((r) => r.id !== open?.id);

  return (
    <Stagger className="max-w-3xl space-y-5">
      {open ? (
        <FadeInItem>
          <ResignationCard resignation={open} />
        </FadeInItem>
      ) : (
        <FadeInItem>
          <Card>
            <CardHeader>
              <CardTitle>Resigning</CardTitle>
              <CardDescription>
                Your notice period is {eligibility.data.noticeDays} days, so the earliest last
                working day is {showDate(eligibility.data.earliestLastWorkingDate)}.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {eligibility.data.canSubmit ? (
                <Button onClick={() => setResigning(true)}>
                  <LogOut className="size-4" aria-hidden /> Submit a resignation
                </Button>
              ) : (
                /* Why, rather than a button that fails on click. */
                <Alert variant="info">
                  <Info aria-hidden />
                  <AlertTitle>You cannot submit one right now</AlertTitle>
                  <AlertDescription>
                    {eligibility.data.blockedReason ?? 'Talk to HR.'}
                  </AlertDescription>
                </Alert>
              )}
            </CardContent>
          </Card>
        </FadeInItem>
      )}

      {past.length > 0 && (
        <FadeInItem>
          <Card>
            <CardHeader>
              <CardTitle>Earlier requests</CardTitle>
              <CardDescription>Withdrawn, rejected or completed</CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="divide-y">
                {past.map((r) => (
                  <li key={r.id} className="flex items-center justify-between gap-3 py-2.5">
                    <div className="min-w-0">
                      <p className="truncate text-sm">
                        {RESIGNATION_REASON_LABELS[r.reason]} · last day{' '}
                        {showDate(r.lastWorkingDate)}
                      </p>
                      <p className="text-muted-foreground text-xs">
                        Submitted {showDate(r.submittedAt)}
                      </p>
                    </div>
                    <ResignationStatusBadge status={r.status} />
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </FadeInItem>
      )}

      {!open && past.length === 0 && (
        <EmptyState
          title="No resignations"
          hint="Nothing has been filed on this account."
          icon={LogOut}
        />
      )}

      <ResignDialog open={resigning} onOpenChange={setResigning} eligibility={eligibility.data} />
    </Stagger>
  );
}
