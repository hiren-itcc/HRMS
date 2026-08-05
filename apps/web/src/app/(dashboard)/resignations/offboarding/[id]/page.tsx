'use client';

import {
  OFFBOARDING_REASON_LABELS,
  OFFBOARDING_STATUS_LABELS,
  type OffboardingStatusCode,
} from '@hrms/shared';
import { Alert, AlertDescription, AlertTitle } from '@hrms/ui/components/alert';
import { Avatar, AvatarFallback, AvatarImage } from '@hrms/ui/components/avatar';
import { Badge } from '@hrms/ui/components/badge';
import { Button } from '@hrms/ui/components/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@hrms/ui/components/card';
import { DatePicker } from '@hrms/ui/components/date-picker';
import { Input } from '@hrms/ui/components/input';
import { Skeleton } from '@hrms/ui/components/skeleton';
import { cn } from '@hrms/ui/lib/utils';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, CheckCircle2, FileText, Info, Undo2 } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { ActivityTimeline } from '@/components/activity-timeline';
import { FormDialog } from '@/components/crud/form-dialog';
import { ErrorState } from '@/components/error-state';
import { Field } from '@/components/field';
import { FadeInItem, Stagger } from '@/components/motion';
import { useSession } from '@/components/session-provider';
import { initials } from '@/features/employees/types';
import { lifecycleKeys } from '@/features/lifecycle/api';
import { offboardingKeys, offboardingsApi } from '@/features/offboarding/api';
import {
  ClearanceChecklist,
  clearanceProgress,
} from '@/features/offboarding/components/clearance-checklist';
import { ExitInterviewCard } from '@/features/offboarding/components/exit-interview-card';
import { resignationKeys } from '@/features/resignations/api';
import { SettlementCard } from '@/features/settlements/components/settlement-card';
import { useApiMutation } from '@/hooks/use-crud';

const dateFmt = new Intl.DateTimeFormat('en-IN', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});
const showDate = (iso: string | null) => (iso ? dateFmt.format(new Date(iso)) : null);

const TONE: Record<OffboardingStatusCode, string> = {
  IN_PROGRESS: 'bg-warning/15 text-warning-text',
  COMPLETED: 'bg-muted text-muted-foreground',
  CANCELLED: 'bg-muted text-muted-foreground',
};

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

export default function OffboardingDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { can } = useSession();
  const [completing, setCompleting] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [rescheduling, setRescheduling] = useState(false);
  const [lastWorkingDate, setLastWorkingDate] = useState('');
  const [cancelReason, setCancelReason] = useState('');

  const query = useQuery({
    queryKey: offboardingKeys.detail(id),
    queryFn: () => offboardingsApi.detail(id),
  });

  const record = query.data;
  const activity = useQuery({
    queryKey: offboardingKeys.activity(id),
    queryFn: () => offboardingsApi.activity(id),
  });

  const invalidate = [
    offboardingKeys.all(),
    ['employees'],
    lifecycleKeys.all(),
    resignationKeys.all(),
  ];

  const complete = useApiMutation({
    mutationFn: () => offboardingsApi.complete(id, { lastWorkingDate: null, note: null }),
    invalidate,
    success: 'Marked as left — their sign-in has been suspended',
    error: 'Could not complete the offboarding',
    onSuccess: () => setCompleting(false),
  });

  const cancel = useApiMutation({
    mutationFn: () => offboardingsApi.cancel(id, { reason: cancelReason }),
    invalidate,
    success: 'Exit cancelled — they are back to active',
    error: 'Could not cancel the offboarding',
    onSuccess: () => {
      setCancelling(false);
      setCancelReason('');
    },
  });

  const reschedule = useApiMutation({
    mutationFn: () => offboardingsApi.update(id, { lastWorkingDate, reasonNote: null }),
    invalidate,
    success: 'Last working date changed',
    error: 'Could not change the date',
    onSuccess: () => setRescheduling(false),
  });

  if (query.isPending) return <Skeleton className="h-96 w-full rounded-2xl" />;
  if (query.isError || !record) return <ErrorState onRetry={() => query.refetch()} />;

  const canManage = can('employee.offboard');
  const open = record.status === 'IN_PROGRESS';
  const progress = clearanceProgress(record.tasks);
  const outstanding = record.tasks.filter((t) => t.required && t.status === 'PENDING');
  const employeeName = `${record.employee.firstName} ${record.employee.lastName}`;

  return (
    <Stagger className="space-y-5">
      <FadeInItem>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" render={<Link href="/resignations/offboarding" />}>
              <ArrowLeft className="size-4" aria-hidden />
              <span className="sr-only">Back to offboarding</span>
            </Button>
            <Avatar className="size-10">
              {record.employee.avatarUrl && <AvatarImage src={record.employee.avatarUrl} alt="" />}
              <AvatarFallback>{initials(record.employee)}</AvatarFallback>
            </Avatar>
            <div>
              <h1 className="flex flex-wrap items-center gap-2 text-lg">
                {employeeName}
                <Badge className={cn('border-transparent', TONE[record.status])}>
                  {OFFBOARDING_STATUS_LABELS[record.status]}
                </Badge>
              </h1>
              <p className="text-muted-foreground text-sm">
                {OFFBOARDING_REASON_LABELS[record.reason]} ·{' '}
                <span className="font-mono text-xs">{record.employee.employeeCode}</span>
              </p>
            </div>
          </div>

          {canManage && open && (
            <div className="flex flex-wrap gap-2">
              <Button
                onClick={() => setCompleting(true)}
                // The gate lives in the API; disabling here says so before a
                // press rather than after a rejected one.
                disabled={outstanding.length > 0}
              >
                <CheckCircle2 className="size-4" aria-hidden /> Mark as left
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  setLastWorkingDate(record.lastWorkingDate.slice(0, 10));
                  setRescheduling(true);
                }}
              >
                Change the date
              </Button>
              <Button variant="outline" onClick={() => setCancelling(true)}>
                <Undo2 className="size-4" aria-hidden /> Cancel the exit
              </Button>
            </div>
          )}
        </div>
      </FadeInItem>

      {open && outstanding.length > 0 && (
        <FadeInItem>
          <Alert variant="info">
            <Info aria-hidden />
            <AlertTitle>
              {outstanding.length} clearance {outstanding.length === 1 ? 'item' : 'items'} still
              outstanding
            </AlertTitle>
            <AlertDescription>
              This exit cannot be completed until {outstanding.map((t) => t.label).join(', ')}{' '}
              {outstanding.length === 1 ? 'is' : 'are'} cleared or waived.
            </AlertDescription>
          </Alert>
        </FadeInItem>
      )}

      <div className="grid items-start gap-5 lg:grid-cols-2">
        <FadeInItem>
          <Card>
            <CardHeader>
              <CardTitle>The exit</CardTitle>
              <CardDescription>
                Department, designation and manager as they were when it started
              </CardDescription>
            </CardHeader>
            <CardContent>
              <dl className="divide-y">
                <Row label="Last working day" value={showDate(record.lastWorkingDate)} />
                <Row label="Joined" value={showDate(record.snapshotJoinDate)} />
                <Row label="Department" value={record.snapshotDepartment} />
                <Row label="Designation" value={record.snapshotDesignation} />
                <Row label="Reporting manager" value={record.snapshotManagerName} />
                <Row label="Started" value={showDate(record.startedAt)} />
                {record.completedAt && (
                  <Row label="Completed" value={showDate(record.completedAt)} />
                )}
                {record.cancelledAt && (
                  <Row label="Cancelled" value={showDate(record.cancelledAt)} />
                )}
                {record.reasonNote && <Row label="Note" value={record.reasonNote} />}
                {record.cancelReason && (
                  <Row label="Called off because" value={record.cancelReason} />
                )}
                {record.resignationId && (
                  <Row
                    label="Resignation"
                    value={
                      <Link
                        href={`/resignations/${record.resignationId}`}
                        className="hover:underline"
                      >
                        View the request
                      </Link>
                    }
                  />
                )}
              </dl>
            </CardContent>
          </Card>
        </FadeInItem>

        <FadeInItem>
          <Card>
            <CardHeader>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <CardTitle>Clearance</CardTitle>
                  <CardDescription>
                    {progress.total === 0
                      ? 'Nothing required'
                      : `${progress.done} of ${progress.total} required items settled`}
                  </CardDescription>
                </div>
                {canManage && (
                  <Button
                    variant="outline"
                    size="sm"
                    render={<Link href={`/employees/${record.employeeId}`} />}
                  >
                    <FileText className="size-4" aria-hidden /> Issue letters
                  </Button>
                )}
              </div>
            </CardHeader>
            <CardContent>
              <ClearanceChecklist
                tasks={record.tasks}
                editable={open}
                employeeManagerId={record.employee.managerId}
                employeeId={record.employeeId}
              />
            </CardContent>
          </Card>
        </FadeInItem>

        {/* HR only — a manager who signs off the handover is very often the
            subject of the answers. */}
        {canManage && (
          <FadeInItem>
            <ExitInterviewCard offboardingId={record.id} />
          </FadeInItem>
        )}

        {/* Gates itself on `payroll.read`: an exit page that shows a
            colleague's payout to every HR user is a leak. */}
        <FadeInItem>
          <SettlementCard offboardingId={record.id} />
        </FadeInItem>

        <FadeInItem>
          <Card>
            <CardHeader>
              <CardTitle>History</CardTitle>
              <CardDescription>Everything recorded against this exit</CardDescription>
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

      <FormDialog
        open={completing}
        onOpenChange={setCompleting}
        title="Mark as left"
        description="Closes the offboarding. This is the point their access ends."
        onSubmit={(e) => {
          e.preventDefault();
          complete.mutate();
        }}
        submitting={complete.isPending}
        submitLabel="Mark as left"
      >
        <div className="rounded-xl border bg-muted/40 p-3">
          <p className="font-medium text-sm">What this does</p>
          <ul className="mt-1.5 list-disc space-y-1 pl-4 text-muted-foreground text-sm">
            <li>Their sign-in is suspended and every device is signed out immediately.</li>
            <li>They stop appearing in the directory and as a manager option.</li>
            <li>Payslips, attendance and leave history are kept — nothing is deleted.</li>
            <li>The final part-month is still paid: payroll uses the exit date, not the status.</li>
          </ul>
        </div>
      </FormDialog>

      <FormDialog
        open={rescheduling}
        onOpenChange={setRescheduling}
        title="Change the last working date"
        description="Moves their exit date too, which is what payroll and attendance read."
        onSubmit={(e) => {
          e.preventDefault();
          reschedule.mutate();
        }}
        submitting={reschedule.isPending}
        submitLabel="Save date"
      >
        <Field label="Last working date" required>
          {(a11y) => (
            <DatePicker {...a11y} value={lastWorkingDate} onValueChange={setLastWorkingDate} />
          )}
        </Field>
      </FormDialog>

      <FormDialog
        open={cancelling}
        onOpenChange={setCancelling}
        title="Cancel the exit"
        description="They are staying. Clears the exit date and restores their sign-in."
        onSubmit={(e) => {
          e.preventDefault();
          cancel.mutate();
        }}
        submitting={cancel.isPending}
        submitLabel="Cancel the exit"
        submitDisabled={!cancelReason.trim()}
      >
        <Field
          label="Reason"
          required
          hint="Kept on the audit trail"
          error={cancelReason.trim() ? undefined : 'Say why the exit is being called off'}
        >
          {(a11y) => (
            <Input
              {...a11y}
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
              maxLength={1000}
              placeholder="Counter-offer accepted"
            />
          )}
        </Field>
      </FormDialog>
    </Stagger>
  );
}
