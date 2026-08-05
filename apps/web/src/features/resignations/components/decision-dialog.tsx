'use client';

import { Alert, AlertDescription, AlertTitle } from '@hrms/ui/components/alert';
import { DatePicker } from '@hrms/ui/components/date-picker';
import { Textarea } from '@hrms/ui/components/textarea';
import { Info } from 'lucide-react';
import { useEffect, useState } from 'react';
import { FormDialog } from '@/components/crud/form-dialog';
import { Field } from '@/components/field';
import { useApiMutation } from '@/hooks/use-crud';
import { resignationKeys, resignationsApi } from '../api';
import type { Resignation } from '../types';

export type DecisionVerb = 'approve' | 'reject' | 'request_changes';

/**
 * What each decision actually does, spelled out rather than summarised.
 *
 * The difference between "approve" here and everywhere else in the product is
 * that it starts an offboarding and moves somebody to notice — not something
 * to infer from the word.
 */
const COPY: Record<
  DecisionVerb,
  { title: string; description: string; submit: string; consequences: string[] }
> = {
  approve: {
    title: 'Approve resignation',
    description: 'Confirms the exit and starts the offboarding.',
    submit: 'Approve',
    consequences: [
      'They move to “on notice”. Their sign-in keeps working and they are paid as normal.',
      'An offboarding is created with this last working date.',
      'On that date their sign-in is suspended and every device is signed out.',
      'Their payslips, attendance and leave history are kept.',
    ],
  },
  reject: {
    title: 'Reject resignation',
    description: 'The employee stays. Nothing about their record changes.',
    submit: 'Reject',
    consequences: [
      'They remain an active employee with no exit date.',
      'They will see your remarks, so say why.',
      'They can file a new resignation later.',
    ],
  },
  request_changes: {
    title: 'Send back for changes',
    description: 'Returns it to the employee to amend.',
    submit: 'Send back',
    consequences: [
      'They can change the date, reason or remarks and resubmit.',
      'They will see your remarks, so say what needs to change.',
      'Nothing about their employment changes in the meantime.',
    ],
  },
};

interface DecisionDialogProps {
  resignation: Resignation;
  verb: DecisionVerb | null;
  onClose: () => void;
  /** True when the caller is giving final sign-off rather than the manager step. */
  isHrDesk: boolean;
}

export function DecisionDialog({ resignation, verb, onClose, isHrDesk }: DecisionDialogProps) {
  const [remarks, setRemarks] = useState('');
  const [lastWorkingDate, setLastWorkingDate] = useState('');

  useEffect(() => {
    if (!verb) return;
    setRemarks('');
    setLastWorkingDate(resignation.requestedLastWorkingDate.slice(0, 10));
  }, [verb, resignation.requestedLastWorkingDate]);

  const decide = useApiMutation({
    mutationFn: () => {
      if (!verb) throw new Error('No decision');
      return resignationsApi.decide(resignation.id, {
        action: verb,
        remarks: remarks.trim() || null,
        // Only HR's approval carries a date, and only when it differs — the
        // API refuses one on a rejection.
        lastWorkingDate: verb === 'approve' && isHrDesk && lastWorkingDate ? lastWorkingDate : null,
      });
    },
    invalidate: [resignationKeys.all(), ['offboardings'], ['employees'], ['lifecycle']],
    success: verb === 'approve' ? 'Resignation approved' : 'Decision recorded',
    error: 'Could not record the decision',
    onSuccess: onClose,
  });

  if (!verb) return null;
  const copy = COPY[verb];
  // Remarks are the employee's only explanation for the two decisions that go
  // against them, so the API requires them and the button says so first.
  const remarksRequired = verb !== 'approve';
  const missing = remarksRequired && !remarks.trim();

  return (
    <FormDialog
      open
      onOpenChange={(next) => !next && onClose()}
      title={copy.title}
      description={copy.description}
      onSubmit={(e) => {
        e.preventDefault();
        decide.mutate();
      }}
      submitting={decide.isPending}
      submitLabel={copy.submit}
      submitDisabled={missing}
    >
      {verb === 'approve' && isHrDesk && (
        <Field
          label="Last working date"
          required
          hint={`They asked for ${resignation.requestedLastWorkingDate.slice(0, 10)}. Change it here if a different date was agreed.`}
        >
          {(a11y) => (
            <DatePicker {...a11y} value={lastWorkingDate} onValueChange={setLastWorkingDate} />
          )}
        </Field>
      )}

      {resignation.isShortNotice && verb === 'approve' && (
        <Alert variant="warning">
          <Info aria-hidden />
          <AlertTitle>This is short notice</AlertTitle>
          <AlertDescription>
            Their notice period is {resignation.noticeDays} days, which would make the earliest last
            working day {resignation.earliestLastWorkingDate.slice(0, 10)}.
          </AlertDescription>
        </Alert>
      )}

      <Field
        label="Remarks"
        required={remarksRequired}
        hint={remarksRequired ? 'The employee sees this' : 'Optional. The employee sees this.'}
        error={missing ? 'Say why — the employee sees this' : undefined}
      >
        {(a11y) => (
          <Textarea
            {...a11y}
            rows={3}
            value={remarks}
            onChange={(e) => setRemarks(e.target.value)}
            maxLength={1000}
          />
        )}
      </Field>

      <div className="rounded-xl border bg-muted/40 p-3">
        <p className="font-medium text-sm">What this does</p>
        <ul className="mt-1.5 list-disc space-y-1 pl-4 text-muted-foreground text-sm">
          {copy.consequences.map((point) => (
            <li key={point}>{point}</li>
          ))}
        </ul>
      </div>
    </FormDialog>
  );
}
