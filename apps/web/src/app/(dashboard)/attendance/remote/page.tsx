'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { type WfhApplyInput, wfhApplySchema } from '@hrms/shared';
import { Alert, AlertDescription } from '@hrms/ui/components/alert';
import { Badge } from '@hrms/ui/components/badge';
import { Button } from '@hrms/ui/components/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@hrms/ui/components/card';
import { cn } from '@hrms/ui/lib/utils';
import { useQuery } from '@tanstack/react-query';
import { House, Info, Plus } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { FormDialog } from '@/components/crud/form-dialog';
import { type Column, DataTable } from '@/components/data-table';
import { FormDatePicker, FormTextarea } from '@/components/form';
import { FadeInItem, Stagger } from '@/components/motion';
import { useSession } from '@/components/session-provider';
import {
  type RemoteWorkRequest,
  WFH_STATUS_LABELS,
  type WfhStatus,
  wfhApi,
  wfhKeys,
} from '@/features/wfh/api';
import { useApiMutation } from '@/hooks/use-crud';

const dateFmt = new Intl.DateTimeFormat('en-IN', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});
const showDate = (iso: string) => dateFmt.format(new Date(iso));

const TONE: Record<WfhStatus, string> = {
  PENDING: 'bg-warning/15 text-warning-text',
  APPROVED: 'bg-success/15 text-success-text',
  REJECTED: 'bg-destructive/15 text-destructive-text',
  CANCELLED: 'bg-muted text-muted-foreground',
};

const PAGE_SIZE = 10;

function StatusBadge({ status }: { status: WfhStatus }) {
  return (
    <Badge className={cn('border-transparent', TONE[status])}>{WFH_STATUS_LABELS[status]}</Badge>
  );
}

function rangeOf(row: RemoteWorkRequest) {
  return row.startDate === row.endDate
    ? showDate(row.startDate)
    : `${showDate(row.startDate)} – ${showDate(row.endDate)}`;
}

export default function RemoteWorkPage() {
  const { can } = useSession();
  const canDecide = can('wfh.approve') || can('wfh.approve.team');

  const [asking, setAsking] = useState(false);
  const [minePage, setMinePage] = useState(1);
  const [inboxPage, setInboxPage] = useState(1);

  const mineParams = { page: minePage, limit: PAGE_SIZE, order: 'desc' as const };
  const mine = useQuery({
    queryKey: wfhKeys.mine(mineParams),
    queryFn: () => wfhApi.mine(mineParams),
  });

  const inboxParams = { page: inboxPage, limit: PAGE_SIZE, order: 'asc' as const, scope: 'inbox' };
  const inbox = useQuery({
    queryKey: wfhKeys.list(inboxParams),
    queryFn: () => wfhApi.list(inboxParams),
    enabled: canDecide,
  });

  const form = useForm<WfhApplyInput>({ resolver: zodResolver(wfhApplySchema) });
  const startDate = form.watch('startDate');
  const endDate = form.watch('endDate');

  /*
   * Asked as soon as both dates exist, so "that would be three in the week of
   * 10 August" arrives before the button is pressed rather than as a refusal
   * afterwards.
   */
  const preview = useQuery({
    queryKey: wfhKeys.preview(startDate ?? '', endDate ?? ''),
    queryFn: () => wfhApi.preview(startDate as string, endDate as string),
    enabled: asking && Boolean(startDate) && Boolean(endDate) && endDate >= startDate,
  });

  const invalidate = [wfhKeys.all()];
  const apply = useApiMutation({
    mutationFn: (input: WfhApplyInput) => wfhApi.apply(input),
    invalidate,
    success: 'Request sent',
    onSuccess: () => setAsking(false),
  });
  const cancel = useApiMutation({
    mutationFn: (id: string) => wfhApi.cancel(id),
    invalidate,
    success: 'Withdrawn',
  });
  const approve = useApiMutation({
    mutationFn: (id: string) => wfhApi.approve(id, {}),
    invalidate,
    success: 'Approved',
  });
  const reject = useApiMutation({
    mutationFn: (id: string) => wfhApi.reject(id, {}),
    invalidate,
    success: 'Declined',
  });

  const mineColumns: Column<RemoteWorkRequest>[] = [
    { key: 'dates', header: 'Days', alwaysVisible: true, render: rangeOf },
    {
      key: 'days',
      header: 'Working days',
      className: 'hidden sm:table-cell',
      render: (row) => <span className="tabular-nums">{row.days}</span>,
    },
    {
      key: 'reason',
      header: 'Reason',
      className: 'hidden md:table-cell',
      render: (row) => row.reason,
    },
    { key: 'status', header: 'Status', render: (row) => <StatusBadge status={row.status} /> },
  ];

  const inboxColumns: Column<RemoteWorkRequest>[] = [
    {
      key: 'employee',
      header: 'Who',
      alwaysVisible: true,
      render: (row) => (
        <span>
          <span className="font-medium">
            {row.employee.firstName} {row.employee.lastName}
          </span>
          <span className="block text-muted-foreground text-xs">{row.employee.employeeCode}</span>
        </span>
      ),
    },
    { key: 'dates', header: 'Days', render: rangeOf },
    {
      key: 'days',
      header: 'Working days',
      className: 'hidden sm:table-cell',
      render: (row) => <span className="tabular-nums">{row.days}</span>,
    },
    {
      key: 'reason',
      header: 'Reason',
      className: 'hidden md:table-cell',
      render: (row) => row.reason,
    },
  ];

  const breaches = preview.data?.breaches ?? [];

  return (
    <Stagger className="space-y-5">
      {canDecide && (
        <FadeInItem>
          <Card>
            <CardHeader>
              <CardTitle>Waiting on you</CardTitle>
              <CardDescription>Remote days your team has asked for</CardDescription>
            </CardHeader>
            <CardContent>
              <DataTable
                columns={inboxColumns}
                rows={inbox.data?.data}
                rowKey={(row) => row.id}
                loading={inbox.isPending}
                error={inbox.isError}
                onRetry={() => inbox.refetch()}
                meta={inbox.data?.meta}
                onPageChange={setInboxPage}
                emptyTitle="Nothing waiting"
                emptyHint="Requests from the people who report to you arrive here."
                actions={(row) => (
                  <span className="flex gap-1.5">
                    <Button
                      size="sm"
                      disabled={approve.isPending}
                      onClick={() => approve.mutate(row.id)}
                    >
                      Approve
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={reject.isPending}
                      onClick={() => reject.mutate(row.id)}
                    >
                      Decline
                    </Button>
                  </span>
                )}
              />
            </CardContent>
          </Card>
        </FadeInItem>
      )}

      <FadeInItem>
        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <CardTitle>My remote days</CardTitle>
                <CardDescription>
                  Agreed in advance. Working from home without a request still records the day — it
                  is simply marked as unplanned.
                </CardDescription>
              </div>
              <Button
                onClick={() => {
                  form.reset({ startDate: '', endDate: '', reason: '' });
                  setAsking(true);
                }}
              >
                <Plus className="size-4" aria-hidden /> Ask for days
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <DataTable
              columns={mineColumns}
              rows={mine.data?.data}
              rowKey={(row) => row.id}
              loading={mine.isPending}
              error={mine.isError}
              onRetry={() => mine.refetch()}
              meta={mine.data?.meta}
              onPageChange={setMinePage}
              emptyTitle="No remote days yet"
              emptyHint="Ask for the days you plan to work from home."
              actions={(row) =>
                row.status === 'PENDING' || row.status === 'APPROVED' ? (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={cancel.isPending}
                    onClick={() => cancel.mutate(row.id)}
                  >
                    Withdraw
                  </Button>
                ) : null
              }
            />
          </CardContent>
        </Card>
      </FadeInItem>

      <FormDialog
        open={asking}
        onOpenChange={setAsking}
        title="Ask for remote days"
        description="Weekends and holidays in the range are skipped — only working days count."
        submitting={apply.isPending}
        submitLabel="Send the request"
        submitDisabled={breaches.length > 0}
        onSubmit={form.handleSubmit((values) => apply.mutate(values))}
      >
        <FormDatePicker
          control={form.control}
          name="startDate"
          label="From"
          placeholder="First day"
        />
        <FormDatePicker control={form.control} name="endDate" label="To" placeholder="Last day" />
        <FormTextarea
          control={form.control}
          name="reason"
          label="Why"
          placeholder="Plumber coming, or a focus day"
        />

        {preview.data && (
          <Alert variant={breaches.length > 0 ? 'error' : 'info'}>
            {breaches.length === 0 && <Info className="size-4" aria-hidden />}
            <AlertDescription>
              {breaches.length > 0 ? (
                <>
                  That would be {breaches[0]?.would} remote days in the week of{' '}
                  {showDate(breaches[0]?.weekKey ?? '')}, and you have{' '}
                  {preview.data.cap === 0 ? 'none' : preview.data.cap} a week.
                </>
              ) : (
                <>
                  {preview.data.workingDays.length} working day
                  {preview.data.workingDays.length === 1 ? '' : 's'}
                  {preview.data.skipped.length > 0 && (
                    <> · {preview.data.skipped.length} skipped as weekend or holiday</>
                  )}
                  . Your allowance is {preview.data.cap} a week.
                </>
              )}
            </AlertDescription>
          </Alert>
        )}
      </FormDialog>

      {!canDecide && (
        <p className="flex items-center gap-1.5 text-muted-foreground text-xs">
          <House className="size-3.5" aria-hidden /> A day worked from home without an approved
          request still counts as worked.
        </p>
      )}
    </Stagger>
  );
}
