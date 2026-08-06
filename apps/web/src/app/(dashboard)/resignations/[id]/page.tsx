'use client';

import {
  OFFBOARDING_STATUS_LABELS,
  RESIGNATION_REASON_LABELS,
  type ResignationStatusCode,
} from '@hrms/shared';
import { Alert, AlertDescription, AlertTitle } from '@hrms/ui/components/alert';
import { Avatar, AvatarFallback, AvatarImage } from '@hrms/ui/components/avatar';
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
import { ArrowLeft, Info } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { ActivityTimeline } from '@/components/activity-timeline';
import { ErrorState } from '@/components/error-state';
import { IconAction } from '@/components/icon-action';
import { FadeInItem, Stagger } from '@/components/motion';
import { useSession } from '@/components/session-provider';
import { initials } from '@/features/employees/types';
import { resignationKeys, resignationsApi } from '@/features/resignations/api';
import {
  DecisionDialog,
  type DecisionVerb,
} from '@/features/resignations/components/decision-dialog';
import {
  ResignationStatusBadge,
  ResignationStepper,
  resignationSteps,
} from '@/features/resignations/components/resignation-status';
import type { Resignation } from '@/features/resignations/types';

const dateFmt = new Intl.DateTimeFormat('en-IN', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});
const stamp = new Intl.DateTimeFormat('en-IN', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
});
const showDate = (iso: string | null) => (iso ? dateFmt.format(new Date(iso)) : null);

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2">
      <dt className="shrink-0 text-muted-foreground text-sm">{label}</dt>
      <dd className="text-right text-sm">
        {value ?? <span className="text-muted-foreground">—</span>}
      </dd>
    </div>
  );
}

/** One decision, with whatever the decider wrote. */
function Decision({
  who,
  at,
  remarks,
}: {
  who: string;
  at: string | null;
  remarks: string | null;
}) {
  if (!at) return null;
  return (
    <div className="rounded-lg border p-3">
      <p className="font-medium text-sm">
        {who} ·{' '}
        <span className="font-normal text-muted-foreground">{stamp.format(new Date(at))}</span>
      </p>
      {remarks && <p className="mt-1 whitespace-pre-wrap text-sm">{remarks}</p>}
    </div>
  );
}

/**
 * The offboarding half, once one exists.
 *
 * A summary and a link, not a second set of controls. Completing, cancelling
 * and rescheduling all live on the offboarding's own page — having them in two
 * places would mean two dialogs that have to agree about what completion does,
 * and the clearance gate is only visible on one of them.
 */
function OffboardingPanel({ resignation }: { resignation: Resignation }) {
  const offboarding = resignation.offboarding;
  if (!offboarding) return null;

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <CardTitle>Offboarding</CardTitle>
            <CardDescription>
              {OFFBOARDING_STATUS_LABELS[offboarding.status]} · last working day{' '}
              {showDate(offboarding.lastWorkingDate)}
            </CardDescription>
          </div>
          <Button
            variant="outline"
            size="sm"
            render={<Link href={`/resignations/offboarding/${offboarding.id}`} />}
          >
            Open the exit
          </Button>
        </div>
      </CardHeader>
    </Card>
  );
}

const FINISHED: ResignationStatusCode[] = ['REJECTED', 'WITHDRAWN', 'COMPLETED'];

export default function ResignationDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { can, user } = useSession();
  const [verb, setVerb] = useState<DecisionVerb | null>(null);

  const query = useQuery({
    queryKey: resignationKeys.detail(id),
    queryFn: () => resignationsApi.detail(id),
  });
  const activity = useQuery({
    queryKey: resignationKeys.activity(id),
    queryFn: () => resignationsApi.activity(id),
  });

  if (query.isPending) return <Skeleton className="h-96 w-full rounded-2xl" />;
  if (query.isError) return <ErrorState onRetry={() => query.refetch()} />;

  const r = query.data;
  const employeeName = `${r.employee.firstName} ${r.employee.lastName}`;

  /*
   * Which desk this caller is acting from. HR acting on a request still at the
   * manager's desk gives final approval — that is what unsticks a request whose
   * reviewer has themselves left — so the flag follows the permission, not the
   * status alone.
   */
  const isHrDesk = can('resignation.approve');
  const isRoutedManager =
    can('resignation.approve.team') && r.routedManagerId === user?.employee?.id;
  const isOwn = r.employeeId === user?.employee?.id;
  const canDecide = Boolean(r.awaitingDesk) && !isOwn && (isHrDesk || isRoutedManager);

  return (
    <Stagger className="space-y-5">
      <FadeInItem>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <IconAction
              label="Back to approvals"
              icon={ArrowLeft}
              render={<Link href="/resignations/approvals" />}
            />
            <Avatar className="size-10">
              {r.employee.avatarUrl && <AvatarImage src={r.employee.avatarUrl} alt="" />}
              <AvatarFallback>{initials(r.employee)}</AvatarFallback>
            </Avatar>
            <div>
              <h1 className="flex flex-wrap items-center gap-2 text-lg">
                {employeeName} <ResignationStatusBadge status={r.status} />
              </h1>
              <p className="text-muted-foreground text-sm">
                {r.employee.designation?.title ?? 'No designation'} ·{' '}
                <span className="font-mono text-xs">{r.employee.employeeCode}</span>
              </p>
            </div>
          </div>

          {canDecide && (
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => setVerb('approve')}>Approve</Button>
              <Button variant="outline" onClick={() => setVerb('request_changes')}>
                Send back
              </Button>
              <Button
                variant="outline"
                className="text-destructive hover:text-destructive"
                onClick={() => setVerb('reject')}
              >
                Reject
              </Button>
            </div>
          )}
        </div>
      </FadeInItem>

      <FadeInItem>
        <ResignationStepper
          steps={resignationSteps({
            status: r.status,
            routedManagerId: r.routedManagerId,
            offboardingStatus: r.offboarding?.status ?? null,
          })}
        />
      </FadeInItem>

      {r.isShortNotice && !FINISHED.includes(r.status) && (
        <FadeInItem>
          <Alert variant="warning">
            <Info aria-hidden />
            <AlertTitle>Short notice</AlertTitle>
            <AlertDescription>
              Their notice period is {r.noticeDays} days, so the earliest last working day would be{' '}
              {showDate(r.earliestLastWorkingDate)}. HR can set a different date when approving.
            </AlertDescription>
          </Alert>
        </FadeInItem>
      )}

      <div className="grid items-start gap-5 lg:grid-cols-2">
        <FadeInItem>
          <Card>
            <CardHeader>
              <CardTitle>The request</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="divide-y">
                <Row label="Submitted" value={stamp.format(new Date(r.submittedAt))} />
                <Row label="Reason" value={RESIGNATION_REASON_LABELS[r.reason]} />
                <Row label="Requested last day" value={showDate(r.requestedLastWorkingDate)} />
                {r.approvedLastWorkingDate && (
                  <Row label="Agreed last day" value={showDate(r.approvedLastWorkingDate)} />
                )}
                <Row label="Notice period" value={`${r.noticeDays} days`} />
                <Row label="Department" value={r.employee.department?.name} />
                <Row label="Joined" value={showDate(r.employee.joinDate)} />
              </dl>
              {r.remarks && (
                <div className="mt-3 rounded-lg bg-muted/50 p-3">
                  <p className="font-medium text-sm">Their remarks</p>
                  <p className="mt-1 whitespace-pre-wrap text-sm">{r.remarks}</p>
                </div>
              )}
            </CardContent>
          </Card>
        </FadeInItem>

        <FadeInItem>
          <Card>
            <CardHeader>
              <CardTitle>Decisions</CardTitle>
              <CardDescription>What each reviewer said</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              <Decision who="Manager" at={r.managerDecidedAt} remarks={r.managerRemarks} />
              <Decision who="HR" at={r.hrDecidedAt} remarks={r.hrRemarks} />
              {!r.managerDecidedAt && !r.hrDecidedAt && (
                <p className="text-muted-foreground text-sm">
                  {r.awaitingDesk === 'MANAGER'
                    ? 'Waiting on their manager.'
                    : r.awaitingDesk === 'HR'
                      ? 'Waiting on HR.'
                      : 'No decision was recorded.'}
                </p>
              )}
            </CardContent>
          </Card>
        </FadeInItem>

        {r.offboarding && (
          <FadeInItem>
            <OffboardingPanel resignation={r} />
          </FadeInItem>
        )}

        <FadeInItem>
          <Card>
            <CardHeader>
              <CardTitle>History</CardTitle>
              <CardDescription>Everything recorded against this request</CardDescription>
            </CardHeader>
            <CardContent>
              <ActivityTimeline
                entries={activity.data}
                loading={activity.isPending}
                error={activity.isError}
                onRetry={() => activity.refetch()}
              />
            </CardContent>
          </Card>
        </FadeInItem>
      </div>

      <DecisionDialog
        resignation={r}
        verb={verb}
        onClose={() => setVerb(null)}
        isHrDesk={isHrDesk}
      />
    </Stagger>
  );
}
