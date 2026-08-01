'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { attendanceRequestCreateSchema } from '@hrms/shared';
import { Input } from '@hrms/ui/components/input';
import { Textarea } from '@hrms/ui/components/textarea';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import type { z } from 'zod';
import { FormDialog } from '@/components/crud/form-dialog';
import { Field } from '@/features/auth/components/field';
import { ApiError } from '@/lib/api-client';
import { attendanceApi } from '../api';

type FormValues = z.input<typeof attendanceRequestCreateSchema>;

interface CorrectionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Pre-filled date (YYYY-MM-DD) when raised from a calendar day. */
  date: string;
}

export function CorrectionDialog({ open, onOpenChange, date }: CorrectionDialogProps) {
  const queryClient = useQueryClient();
  const form = useForm<FormValues>({
    resolver: zodResolver(attendanceRequestCreateSchema),
    defaultValues: { date, requestedIn: '', requestedOut: '', reason: '' },
  });

  useEffect(() => {
    if (open) form.reset({ date, requestedIn: '', requestedOut: '', reason: '' });
  }, [open, date, form]);

  const create = useMutation({
    mutationFn: attendanceApi.createRequest,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['attendance'] });
      toast.success('Correction request sent for approval');
      onOpenChange(false);
    },
    onError: (err) =>
      toast.error(err instanceof ApiError ? err.message : 'Could not send the request'),
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
      <Field label="Date" error={form.formState.errors.date?.message}>
        {(a11y) => <Input {...a11y} type="date" {...form.register('date')} />}
      </Field>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Clock in" error={form.formState.errors.requestedIn?.message}>
          {(a11y) => <Input {...a11y} type="time" {...form.register('requestedIn')} />}
        </Field>
        <Field label="Clock out" error={form.formState.errors.requestedOut?.message}>
          {(a11y) => <Input {...a11y} type="time" {...form.register('requestedOut')} />}
        </Field>
      </div>
      <Field
        label="Reason"
        error={form.formState.errors.reason?.message}
        hint="Why the recorded times need correcting"
      >
        {(a11y) => (
          <Textarea
            {...a11y}
            rows={3}
            placeholder="Forgot to clock out after the client visit"
            {...form.register('reason')}
          />
        )}
      </Field>
    </FormDialog>
  );
}
