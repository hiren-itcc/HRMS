'use client';

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
import { BadgeCheck, CalendarClock } from 'lucide-react';
import { useState } from 'react';
import { FormDialog } from '@/components/crud/form-dialog';
import { Field } from '@/components/field';
import { useSession } from '@/components/session-provider';
import { employeesApi } from '@/features/employees/api';
import { useApiMutation } from '@/hooks/use-crud';
import type { EmployeeDetail } from '../types';
import { ProbationBadge, relativeDays } from './probation-badge';

const dateFmt = new Intl.DateTimeFormat('en-IN', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
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

/**
 * Probation, notice period and exit date — the three dates that decide when
 * somebody's employment starts counting and when it stops.
 *
 * They sit in their own card rather than in Job because they are not
 * placement: Job answers "where do they sit", this answers "where are they in
 * their employment". The two Job-card dates that belong to that question
 * (joining, and the notice they owe) are repeated here rather than moved, so
 * neither card reads as though something is missing.
 */
export function LifecycleCard({ employee }: { employee: EmployeeDetail }) {
  const { can } = useSession();
  const [confirming, setConfirming] = useState(false);
  const [extending, setExtending] = useState(false);
  const [confirmedOn, setConfirmedOn] = useState('');
  const [extendedTo, setExtendedTo] = useState('');
  const [reason, setReason] = useState('');

  const { probation } = employee;
  const canConfirm = can('employee.confirm');
  const onProbation = probation.state === 'PROBATION' || probation.state === 'EXTENDED';

  const confirm = useApiMutation({
    mutationFn: () =>
      employeesApi.confirm(employee.id, { confirmedOn: confirmedOn || null, note: null }),
    invalidate: [['employees']],
    success: 'Confirmed — they are off probation',
    error: 'Could not confirm them',
    onSuccess: () => {
      setConfirming(false);
      setConfirmedOn('');
    },
  });

  const extend = useApiMutation({
    mutationFn: () => employeesApi.extendProbation(employee.id, { extendedTo, reason }),
    invalidate: [['employees']],
    success: 'Probation extended',
    error: 'Could not extend the probation',
    onSuccess: () => {
      setExtending(false);
      setExtendedTo('');
      setReason('');
    },
  });

  /** What the probation row says, in words rather than only in colour. */
  const probationValue = (() => {
    switch (probation.state) {
      case 'CONFIRMED':
        return (
          <span className="inline-flex items-center gap-1.5">
            <BadgeCheck className="size-4 text-success-text" aria-hidden />
            Confirmed {showDate(employee.confirmedOn) ? `on ${showDate(employee.confirmedOn)}` : ''}
          </span>
        );
      case 'NONE':
        return <span className="text-muted-foreground">Not applicable</span>;
      default:
        return (
          <span className="space-y-0.5">
            <ProbationBadge probation={probation} />
            <span className="block text-muted-foreground text-xs">
              {probation.isOverdue ? 'Ended' : 'Ends'} {showDate(probation.endDate)}
              {probation.daysRemaining !== null && ` (${relativeDays(probation.daysRemaining)})`}
            </span>
          </span>
        );
    }
  })();

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CalendarClock className="size-4 text-muted-foreground" aria-hidden />
            Employment lifecycle
          </CardTitle>
          <CardDescription>Probation, notice period and leaving date</CardDescription>
        </CardHeader>
        <CardContent>
          <dl className="divide-y">
            <Row label="Joined" value={showDate(employee.joinDate)} />
            <Row label="Probation" value={probationValue} />
            {probation.originalEndDate && (
              <Row
                label="Originally ended"
                value={
                  <span className="text-muted-foreground">
                    {showDate(probation.originalEndDate)}
                  </span>
                }
              />
            )}
            <Row
              label="Notice period"
              value={
                <>
                  {employee.effectiveNoticeDays} days
                  {employee.noticePeriodDays === null && (
                    <span className="ml-1 text-muted-foreground text-xs">(company default)</span>
                  )}
                </>
              }
            />
            {employee.exitDate && (
              <Row
                label={employee.status === 'EXITED' ? 'Left on' : 'Last working day'}
                value={showDate(employee.exitDate)}
              />
            )}
          </dl>

          {canConfirm && onProbation && (
            <div className="mt-4 flex flex-wrap gap-2">
              <Button size="sm" onClick={() => setConfirming(true)}>
                Confirm employee
              </Button>
              <Button size="sm" variant="outline" onClick={() => setExtending(true)}>
                Extend probation
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <FormDialog
        open={confirming}
        onOpenChange={setConfirming}
        title="Confirm off probation"
        description="Records that their probation is over and they are permanent staff. This does not change their employment type or their pay."
        onSubmit={(e) => {
          e.preventDefault();
          confirm.mutate();
        }}
        submitting={confirm.isPending}
        submitLabel="Confirm"
      >
        <Field
          label="Confirmed on"
          hint="Leave blank for today. Back-date it if the review already happened."
        >
          {(a11y) => <DatePicker {...a11y} value={confirmedOn} onValueChange={setConfirmedOn} />}
        </Field>
      </FormDialog>

      <FormDialog
        open={extending}
        onOpenChange={setExtending}
        title="Extend probation"
        description="Pushes the end date back. The original date is kept, so the record shows this as an extension."
        onSubmit={(e) => {
          e.preventDefault();
          extend.mutate();
        }}
        submitting={extend.isPending}
        submitLabel="Extend"
      >
        <Field
          label="New end date"
          required
          hint={probation.endDate ? `Currently ends ${showDate(probation.endDate)}` : undefined}
        >
          {(a11y) => <DatePicker {...a11y} value={extendedTo} onValueChange={setExtendedTo} />}
        </Field>
        <Field label="Reason" required hint="Kept on the audit trail">
          {(a11y) => (
            <Input
              {...a11y}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={500}
              placeholder="Needs another quarter to meet the review criteria"
            />
          )}
        </Field>
      </FormDialog>
    </>
  );
}
