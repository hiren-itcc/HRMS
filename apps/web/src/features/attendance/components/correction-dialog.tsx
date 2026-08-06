'use client';

import { attendanceRequestCreateSchema } from '@hrms/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import type { z } from 'zod';
import { FormDialog } from '@/components/crud/form-dialog';
import { FormDatePicker, FormTextarea, FormTimePicker } from '@/components/form';
import { useApiMutation } from '@/hooks/use-crud';
import { useZodForm } from '@/hooks/use-zod-form';
import { attendanceApi } from '../api';

type FormValues = z.input<typeof attendanceRequestCreateSchema>;

interface CorrectionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Pre-filled date (YYYY-MM-DD) when raised from a calendar day. */
  date: string;
}

export function CorrectionDialog({ open, onOpenChange, date }: CorrectionDialogProps) {
  const _queryClient = useQueryClient();
  const form = useZodForm<FormValues>(attendanceRequestCreateSchema, {
    defaultValues: { date, requestedIn: '', requestedOut: '', reason: '' },
  });

  useEffect(() => {
    if (open) form.reset({ date, requestedIn: '', requestedOut: '', reason: '' });
  }, [open, date, form]);

  const create = useApiMutation({
    mutationFn: attendanceApi.createRequest,
    invalidate: [['attendance']],
    success: 'Correction request sent for approval',
    error: 'Could not send the request',
    onSuccess: () => {
      onOpenChange(false);
    },
  });

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Request attendance correction"
      description="Your manager or HR will review the corrected times."
      onSubmit={form.handleSubmit((raw) => create.mutate(attendanceRequestCreateSchema.parse(raw)))}
      submitting={create.isPending}
      submitLabel="Send request"
    >
      <FormDatePicker control={form.control} name="date" label="Date" />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {/*
         * Five, not fifteen: a correction states the minute somebody actually
         * arrived, which is rarely on a quarter hour.
         */}
        <FormTimePicker
          control={form.control}
          name="requestedIn"
          label="Clock in"
          step={5}
          placeholder="09:30"
        />
        <FormTimePicker
          control={form.control}
          name="requestedOut"
          label="Clock out"
          step={5}
          placeholder="18:30"
        />
      </div>
      <FormTextarea
        control={form.control}
        name="reason"
        label="Reason"
        hint="Why the recorded times need correcting"
        rows={3}
        placeholder="Forgot to clock out after the client visit"
      />
    </FormDialog>
  );
}
