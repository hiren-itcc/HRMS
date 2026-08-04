'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { leaveApplySchema } from '@hrms/shared';
import { SelectItem } from '@hrms/ui/components/select';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarCheck, Info } from 'lucide-react';
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import type { z } from 'zod';
import { FormDialog } from '@/components/crud/form-dialog';
import { FormDatePicker, FormSelect, FormTextarea } from '@/components/form';
import { useApiMutation, useOptions } from '@/hooks/use-crud';
import { formatDays, type LeaveBalance, leaveApi } from '../api';

type FormValues = z.input<typeof leaveApplySchema>;

const today = () => new Date().toISOString().slice(0, 10);

interface ApplyDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  balances: LeaveBalance[];
}

export function ApplyLeaveDialog({ open, onOpenChange, balances }: ApplyDialogProps) {
  const _queryClient = useQueryClient();
  // Keyed under ['leave'] so that editing a leave type invalidates this too.
  const types = useOptions(['leave', 'types'], leaveApi.typeOptions, (t) => t.name, {
    enabled: open,
  });

  const form = useForm<FormValues>({
    resolver: zodResolver(leaveApplySchema),
    defaultValues: {
      leaveTypeId: '',
      startDate: today(),
      endDate: today(),
      halfDaySide: null,
      reason: '',
    },
  });

  useEffect(() => {
    if (open) {
      form.reset({
        leaveTypeId: '',
        startDate: today(),
        endDate: today(),
        halfDaySide: null,
        reason: '',
      });
    }
  }, [open, form]);

  const startDate = form.watch('startDate');
  const endDate = form.watch('endDate');
  const halfDaySide = form.watch('halfDaySide');
  const leaveTypeId = form.watch('leaveTypeId');
  const singleDay = Boolean(startDate) && startDate === endDate;

  // Live cost of the selected range — weekends and holidays excluded
  const preview = useQuery({
    queryKey: ['leave', 'preview', startDate, endDate, halfDaySide],
    queryFn: () =>
      leaveApi.preview({
        startDate,
        endDate,
        halfDaySide: singleDay && halfDaySide ? halfDaySide : undefined,
      }),
    enabled: open && Boolean(startDate) && Boolean(endDate) && endDate >= startDate,
  });

  const balance = balances.find((b) => b.leaveTypeId === leaveTypeId);
  const shortfall = balance && preview.data ? preview.data.days > balance.available : false;

  const apply = useApiMutation({
    mutationFn: leaveApi.apply,
    invalidate: [['leave'], ['attendance']],
    success: (req) =>
      req.status === 'APPROVED'
        ? `Leave booked — ${formatDays(req.days)}`
        : `Leave requested — ${formatDays(req.days)} pending approval`,
    error: 'Could not submit the request',
    onSuccess: (_req) => {
      onOpenChange(false);
    },
  });

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Apply for leave"
      description="Weekends and company holidays are not deducted."
      onSubmit={form.handleSubmit((raw) => apply.mutate(leaveApplySchema.parse(raw)))}
      submitting={apply.isPending}
      submitLabel="Submit request"
    >
      <FormSelect
        control={form.control}
        name="leaveTypeId"
        label="Leave type"
        required
        placeholder="Choose a type"
        busy={types.isPending}
      >
        {types.options?.map((t) => {
          const b = balances.find((x) => x.leaveTypeId === t.id);
          return (
            <SelectItem key={t.id} value={t.id}>
              {t.label}
              {b ? ` — ${b.available} left` : ''}
            </SelectItem>
          );
        })}
      </FormSelect>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <FormDatePicker
          control={form.control}
          name="startDate"
          label="From"
          required
          onValueChange={(value) => {
            // Keep the range valid as the start moves forward
            if (form.getValues('endDate') < value) {
              form.setValue('endDate', value, { shouldDirty: true });
            }
            /*
             * A half day only makes sense on a single date, and the Duration
             * select unmounts the moment the range widens — taking the visible
             * error target with it. Without this clear, picking "First half"
             * and then extending the range left halfDaySide set, and the
             * schema's refine refused the submit with nothing on screen to
             * explain why.
             */
            if (form.getValues('endDate') !== value) {
              form.setValue('halfDaySide', null, { shouldDirty: true });
            }
          }}
        />
        <FormDatePicker
          control={form.control}
          name="endDate"
          label="To"
          required
          min={startDate}
          onValueChange={(value) => {
            // Same reason as the start date: widening the range unmounts the
            // Duration select, so the half-day choice has to go with it.
            if (value !== form.getValues('startDate')) {
              form.setValue('halfDaySide', null, { shouldDirty: true });
            }
          }}
        />
      </div>

      {singleDay && (
        <FormSelect
          control={form.control}
          name="halfDaySide"
          label="Duration"
          emptyLabel="Full day"
        >
          <SelectItem value="FIRST_HALF">First half</SelectItem>
          <SelectItem value="SECOND_HALF">Second half</SelectItem>
        </FormSelect>
      )}

      {preview.data && (
        <div
          className={`flex items-start gap-2 rounded-xl border p-3 text-sm ${
            shortfall ? 'border-destructive/40 bg-destructive/5' : 'bg-muted/50'
          }`}
        >
          {shortfall ? (
            <Info className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden />
          ) : (
            <CalendarCheck className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />
          )}
          <span>
            <span className="font-medium">{formatDays(preview.data.days)}</span> will be deducted
            {preview.data.skipped.length > 0 && (
              <span className="text-muted-foreground">
                {' '}
                · {preview.data.skipped.length} weekend/holiday day
                {preview.data.skipped.length === 1 ? '' : 's'} skipped
              </span>
            )}
            {balance && (
              <span className="block text-muted-foreground text-xs">
                {balance.leaveType?.name}: {balance.available} available
                {shortfall && ' — not enough balance'}
              </span>
            )}
          </span>
        </div>
      )}

      <FormTextarea
        control={form.control}
        name="reason"
        label="Reason"
        required
        rows={3}
        placeholder="Family function out of town"
      />
    </FormDialog>
  );
}
