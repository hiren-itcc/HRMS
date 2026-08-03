'use client';

import { Alert, AlertDescription, AlertTitle } from '@hrms/ui/components/alert';
import { Button } from '@hrms/ui/components/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@hrms/ui/components/card';
import { Input } from '@hrms/ui/components/input';
import { Skeleton } from '@hrms/ui/components/skeleton';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Check, Info, Loader2, Undo2 } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { ErrorState } from '@/components/error-state';
import { FadeInItem, Stagger } from '@/components/motion';
import { NoAccess } from '@/components/no-access';
import { PageHeader } from '@/components/page-header';
import { useSession } from '@/components/session-provider';
import { DocumentsBrowser } from '@/features/documents/documents-browser';
import { onboardingApi, onboardingKeys } from '@/features/onboarding/api';
import { JobDetailsCard } from '@/features/onboarding/components/job-details-card';
import { ApiError } from '@/lib/api-client';

const dateFmt = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
});

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 py-1.5 sm:flex-row sm:justify-between">
      <dt className="text-muted-foreground text-sm">{label}</dt>
      <dd className="font-medium text-sm sm:text-right">{value || '—'}</dd>
    </div>
  );
}

/**
 * The review screen: what they typed, beside the documents they uploaded.
 *
 * Both on one page on purpose — the whole point of collecting a bank proof is
 * that somebody compares the account number on it with the one in the form.
 */
export default function OnboardingReviewPage() {
  const { id } = useParams<{ id: string }>();
  const { can, status: authStatus } = useSession();
  const queryClient = useQueryClient();
  const [note, setNote] = useState('');

  const record = useQuery({
    queryKey: onboardingKeys.one(id),
    queryFn: () => onboardingApi.detail(id),
  });

  const approve = useMutation({
    mutationFn: () => onboardingApi.approve(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: onboardingKeys.all() });
      queryClient.invalidateQueries({ queryKey: ['employees'] });
      toast.success('Approved — they are now an active employee');
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : 'Could not approve'),
  });

  const requestChanges = useMutation({
    mutationFn: () => onboardingApi.requestChanges(id, note),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: onboardingKeys.all() });
      toast.success('Sent back with your note');
      setNote('');
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : 'Could not send it back'),
  });

  if (authStatus === 'authenticated' && !can('employee.read')) {
    return <NoAccess what="onboarding" />;
  }
  if (record.isError) return <ErrorState onRetry={() => record.refetch()} />;
  if (!record.data) return <Skeleton className="h-96 w-full rounded-xl" />;

  const r = record.data;
  const e = r.employee;
  const pending = r.status === 'SUBMITTED';
  const canReview = can('employee.onboarding.approve');

  return (
    <Stagger className="space-y-6">
      <FadeInItem>
        <Button
          variant="ghost"
          size="sm"
          className="-ml-2"
          render={<Link href="/employees/onboarding" />}
        >
          <ArrowLeft className="size-4" aria-hidden /> Back to onboarding
        </Button>
        <PageHeader
          title={`${e.firstName} ${e.lastName}`}
          description={`${e.employeeCode} · joins ${dateFmt.format(new Date(e.joinDate))}`}
        />
      </FadeInItem>

      {!pending && (
        <FadeInItem>
          <Alert variant="info">
            <Info aria-hidden />
            <AlertTitle>
              {r.status === 'APPROVED' ? 'Already approved' : 'Not submitted yet'}
            </AlertTitle>
            <AlertDescription>
              {r.status === 'APPROVED'
                ? 'This hire is an active employee.'
                : 'They are still filling things in. Nothing to review until they submit.'}
            </AlertDescription>
          </Alert>
        </FadeInItem>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <FadeInItem>
          <Card>
            <CardHeader>
              <CardTitle>What they submitted</CardTitle>
              <CardDescription>Check these against the documents</CardDescription>
            </CardHeader>
            <CardContent>
              <dl className="divide-y">
                <Row label="Work email" value={e.workEmail} />
                <Row label="Personal email" value={e.personalEmail} />
                <Row
                  label="Date of birth"
                  value={e.dateOfBirth ? dateFmt.format(new Date(e.dateOfBirth)) : null}
                />
                <Row label="Phone" value={e.phone} />
                <Row
                  label="Address"
                  value={[e.addressLine, e.city, e.country].filter(Boolean).join(', ')}
                />
                <Row
                  label="First job"
                  value={
                    r.hasPreviousEmployment === null
                      ? null
                      : r.hasPreviousEmployment
                        ? 'No — has worked before'
                        : 'Yes — first job'
                  }
                />
              </dl>
            </CardContent>
          </Card>
        </FadeInItem>

        <FadeInItem>
          <Card>
            <CardHeader>
              <CardTitle>Bank account</CardTitle>
              <CardDescription>Must match the cancelled cheque</CardDescription>
            </CardHeader>
            <CardContent>
              <dl className="divide-y">
                <Row label="Account holder" value={e.bankDetail?.accountHolderName} />
                <Row label="Bank" value={e.bankDetail?.bankName} />
                <Row
                  label="Account number"
                  value={
                    e.bankDetail ? (
                      <span className="font-mono">{e.bankDetail.accountNumber}</span>
                    ) : null
                  }
                />
                <Row label="IFSC" value={e.bankDetail?.ifscCode} />
              </dl>
            </CardContent>
          </Card>
        </FadeInItem>
      </div>

      {/*
       * Before the documents, because it is the thing that blocks approval —
       * and the error that used to say "set the department" had nowhere on
       * this page to go and do it.
       */}
      <FadeInItem>
        <JobDetailsCard
          employeeId={e.id}
          current={{
            departmentId: e.departmentId ?? null,
            designationId: e.designationId ?? null,
            locationId: e.locationId ?? null,
            shiftId: e.shiftId ?? null,
            employmentTypeId: e.employmentTypeId ?? null,
            managerId: e.managerId ?? null,
          }}
          disabled={r.status === 'APPROVED' || !can('employee.update')}
        />
      </FadeInItem>

      <FadeInItem>
        <Card>
          <CardHeader>
            <CardTitle>Documents</CardTitle>
            <CardDescription>Open each one and check it against the details above</CardDescription>
          </CardHeader>
          <CardContent>
            <DocumentsBrowser employeeId={e.id} compact />
          </CardContent>
        </Card>
      </FadeInItem>

      {pending && canReview && (
        <FadeInItem>
          <Card>
            <CardHeader>
              <CardTitle>Decision</CardTitle>
              <CardDescription>
                Approving makes them an active employee and opens the rest of the app
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <Button disabled={approve.isPending} onClick={() => approve.mutate()}>
                {approve.isPending && <Loader2 className="size-4 animate-spin" aria-hidden />}
                <Check className="size-4" aria-hidden /> Approve
              </Button>

              <div className="flex flex-wrap gap-2">
                <Input
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  placeholder="What needs changing?"
                  aria-label="Reason for sending it back"
                  className="max-w-sm"
                />
                <Button
                  variant="outline"
                  disabled={note.trim() === '' || requestChanges.isPending}
                  onClick={() => requestChanges.mutate()}
                >
                  <Undo2 className="size-4" aria-hidden /> Send back
                </Button>
              </div>
            </CardContent>
          </Card>
        </FadeInItem>
      )}
    </Stagger>
  );
}
