'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import {
  RESIGNATION_REASON_LABELS,
  type ResignationReasonCode,
  resignationCreateSchema,
} from '@hrms/shared';
import { Alert, AlertDescription, AlertTitle } from '@hrms/ui/components/alert';
import { SelectItem } from '@hrms/ui/components/select';
import { TriangleAlert } from 'lucide-react';
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import type { z } from 'zod';
import { FormDialog } from '@/components/crud/form-dialog';
import { FormDatePicker, FormInput, FormSelect } from '@/components/form';
import { useApiMutation } from '@/hooks/use-crud';
import { resignationKeys, resignationsApi } from '../api';
import type { Resignation, ResignationEligibility } from '../types';

type FormValues = z.input<typeof resignationCreateSchema>;

interface ResignDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  eligibility: ResignationEligibility;
  /** Present when the employee is changing a request they already filed. */
  editing?: Resignation | null;
}

/**
 * Filing or amending a resignation.
 *
 * The last working date defaults to the earliest the notice period allows, and
 * that date comes from the server rather than being computed here — the policy
 * lives in Settings, and the browser's idea of "today" is the laptop's, not the
 * organization's.
 */
export function ResignDialog({ open, onOpenChange, eligibility, editing }: ResignDialogProps) {
  const form = useForm<FormValues>({
    resolver: zodResolver(resignationCreateSchema),
    defaultValues: {
      lastWorkingDate: eligibility.earliestLastWorkingDate,
      reason: 'BETTER_OPPORTUNITY',
      remarks: '',
    },
  });

  useEffect(() => {
    if (!open) return;
    form.reset({
      lastWorkingDate:
        editing?.requestedLastWorkingDate?.slice(0, 10) ?? eligibility.earliestLastWorkingDate,
      reason: editing?.reason ?? 'BETTER_OPPORTUNITY',
      remarks: editing?.remarks ?? '',
    });
  }, [open, editing, eligibility.earliestLastWorkingDate, form]);

  const chosen = form.watch('lastWorkingDate');
  const reason = form.watch('reason') as ResignationReasonCode | undefined;
  // Warned about, not blocked. Shortfalls get negotiated, and a form that
  // refuses one just moves the conversation to email where nothing records it.
  const short = Boolean(chosen) && chosen < eligibility.earliestLastWorkingDate;

  const save = useApiMutation({
    mutationFn: (values: FormValues) => {
      const parsed = resignationCreateSchema.parse(values);
      return editing ? resignationsApi.update(editing.id, parsed) : resignationsApi.submit(parsed);
    },
    invalidate: [resignationKeys.all()],
    success: editing ? 'Your resignation has been updated' : 'Your resignation has been submitted',
    error: 'Could not submit your resignation',
    onSuccess: () => onOpenChange(false),
  });

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={editing ? 'Update your resignation' : 'Submit your resignation'}
      description={
        editing
          ? 'Saving sends it back for review.'
          : 'This goes to your manager and then to HR. You can withdraw it any time before it is approved.'
      }
      onSubmit={form.handleSubmit((v) => save.mutate(v))}
      submitting={save.isPending}
      submitLabel={editing ? 'Save changes' : 'Submit resignation'}
    >
      <FormDatePicker
        control={form.control}
        name="lastWorkingDate"
        label="Last working date"
        required
        hint={`Your notice period is ${eligibility.noticeDays} days, so the earliest is ${eligibility.earliestLastWorkingDate}.`}
        placeholder="Select your last working date"
      />

      {short && (
        <Alert variant="warning">
          <TriangleAlert aria-hidden />
          <AlertTitle>That is shorter than your notice period</AlertTitle>
          <AlertDescription>
            You can still submit it. HR will see that it is short notice and may set a different
            last working date when they approve.
          </AlertDescription>
        </Alert>
      )}

      <FormSelect control={form.control} name="reason" label="Reason" required>
        {Object.entries(RESIGNATION_REASON_LABELS).map(([value, label]) => (
          <SelectItem key={value} value={value}>
            {label}
          </SelectItem>
        ))}
      </FormSelect>

      <FormInput
        control={form.control}
        name="remarks"
        label="Remarks"
        required={reason === 'OTHER'}
        hint={
          reason === 'OTHER'
            ? 'Required when the reason is Other'
            : 'Optional. Your manager and HR will see this.'
        }
        placeholder="Anything you would like to add"
      />
    </FormDialog>
  );
}
