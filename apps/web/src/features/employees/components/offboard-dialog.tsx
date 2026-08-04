'use client';

import type { EmployeeOffboardInput } from '@hrms/shared';
import { Button } from '@hrms/ui/components/button';
import { DatePicker } from '@hrms/ui/components/date-picker';
import { Input } from '@hrms/ui/components/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@hrms/ui/components/select';
import { useQueryClient } from '@tanstack/react-query';
import { LogOut } from 'lucide-react';
import { useState } from 'react';
import { FormDialog } from '@/components/crud/form-dialog';
import { Field } from '@/components/field';
import { employeesApi } from '@/features/employees/api';
import { useApiMutation } from '@/hooks/use-crud';

type Destination = EmployeeOffboardInput['status'];

/**
 * Screen 12 — the offboarding dialog, specified since the beginning.
 *
 * Deliberately not the same thing as Delete. Delete is the Admin-only "this
 * record should not have existed" action and archives the row. Offboarding is
 * the ordinary HR event: the person did work here, and everything they did
 * stays exactly where it is.
 *
 * The consequences are listed rather than summarised, because the difference
 * between the two destinations is entirely in what happens to the sign-in and
 * that is not guessable from the words "on notice" and "exited".
 */

const CONSEQUENCES: Record<Destination, { label: string; points: string[] }> = {
  ON_NOTICE: {
    label: 'Serving notice',
    points: [
      'They stay a full employee — attendance, leave and payroll are unchanged.',
      'Their sign-in keeps working.',
      'The exit date is the planned last working day, and can be changed or withdrawn.',
    ],
  },
  EXITED: {
    label: 'Left the company',
    points: [
      'Their sign-in is suspended and every device is signed out immediately.',
      'They stop appearing as a manager option and in the directory.',
      'Payslips, attendance and leave history are kept — the record is not deleted.',
      'The final part-month is still paid: payroll uses the exit date, not the status.',
    ],
  },
  ACTIVE: {
    label: 'Withdraw the resignation',
    points: [
      'The exit date is cleared and they go back to being a normal employee.',
      'A sign-in suspended by offboarding is restored.',
    ],
  },
};

export function OffboardDialog({
  employeeId,
  employeeName,
  currentStatus,
}: {
  employeeId: string;
  employeeName: string;
  currentStatus: string;
}) {
  const _queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const leaving = currentStatus === 'ON_NOTICE' || currentStatus === 'EXITED';
  const [status, setStatus] = useState<Destination>(leaving ? 'EXITED' : 'ON_NOTICE');
  const [exitDate, setExitDate] = useState('');
  const [reason, setReason] = useState('');

  const offboard = useApiMutation({
    error: 'Could not record the exit',
    mutationFn: () =>
      employeesApi.offboard(employeeId, {
        status,
        exitDate: status === 'ACTIVE' ? null : exitDate,
        reason: reason.trim() || null,
      }),
    invalidate: [['employees']],
    success: (_data) =>
      status === 'ACTIVE'
        ? `${employeeName} is back to active`
        : `${employeeName} is now ${status === 'EXITED' ? 'marked as left' : 'on notice'}`,
    onSuccess: () => {
      setOpen(false);
    },
  });

  const consequences = CONSEQUENCES[status];

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <LogOut className="size-4" aria-hidden /> {leaving ? 'Update leaving' : 'Offboard'}
      </Button>

      <FormDialog
        open={open}
        onOpenChange={setOpen}
        title={`Offboard ${employeeName}`}
        description="Records that somebody is leaving. This is not a delete — their history stays."
        onSubmit={(e) => {
          e.preventDefault();
          offboard.mutate();
        }}
        submitting={offboard.isPending}
        submitLabel={status === 'ACTIVE' ? 'Withdraw resignation' : 'Confirm'}
      >
        <Field label="What is happening" required>
          {(a11y) => (
            <Select value={status} onValueChange={(v) => setStatus(v as Destination)}>
              <SelectTrigger {...a11y}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ON_NOTICE">{CONSEQUENCES.ON_NOTICE.label}</SelectItem>
                <SelectItem value="EXITED">{CONSEQUENCES.EXITED.label}</SelectItem>
                {leaving && <SelectItem value="ACTIVE">{CONSEQUENCES.ACTIVE.label}</SelectItem>}
              </SelectContent>
            </Select>
          )}
        </Field>

        {status !== 'ACTIVE' && (
          <Field
            label={status === 'EXITED' ? 'Last working day' : 'Planned last working day'}
            required
          >
            {(a11y) => <DatePicker {...a11y} value={exitDate} onValueChange={setExitDate} />}
          </Field>
        )}

        <Field label="Reason" hint="Recorded on the audit trail; the employee never sees it">
          {(a11y) => (
            <Input
              {...a11y}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={300}
              placeholder="Resigned, end of contract…"
            />
          )}
        </Field>

        <div className="rounded-xl border bg-muted/40 p-3">
          <p className="font-medium text-sm">What this does</p>
          <ul className="mt-1.5 list-disc space-y-1 pl-4 text-muted-foreground text-sm">
            {consequences.points.map((point) => (
              <li key={point}>{point}</li>
            ))}
          </ul>
        </div>
      </FormDialog>
    </>
  );
}
