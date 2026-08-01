'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { leaveApplySchema } from '@hrms/shared';
import { Input } from '@hrms/ui/components/input';
import { Label } from '@hrms/ui/components/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@hrms/ui/components/select';
import { Textarea } from '@hrms/ui/components/textarea';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarCheck, Info } from 'lucide-react';
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import type { z } from 'zod';
import { FormDialog } from '@/components/crud/form-dialog';
import { Field } from '@/components/field';
import { ApiError } from '@/lib/api-client';
import { formatDays, type LeaveBalance, leaveApi } from '../api';

type FormValues = z.input<typeof leaveApplySchema>;
const FULL_DAY = 'full';

const today = () => new Date().toISOString().slice(0, 10);

interface ApplyDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  balances: LeaveBalance[];
}

export function ApplyLeaveDialog({ open, onOpenChange, balances }: ApplyDialogProps) {
  const queryClient = useQueryClient();
  const types = useQuery({
    queryKey: ['leave', 'types', 'options'],
    queryFn: leaveApi.typeOptions,
    staleTime: 60_000,
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

  const apply = useMutation({
    mutationFn: leaveApi.apply,
    onSuccess: (req) => {
      queryClient.invalidateQueries({ queryKey: ['leave'] });
      queryClient.invalidateQueries({ queryKey: ['attendance'] });
      toast.success(
        req.status === 'APPROVED'
          ? `Leave booked — ${formatDays(req.days)}`
          : `Leave requested — ${formatDays(req.days)} pending approval`,
      );
      onOpenChange(false);
    },
    onError: (err) =>
      toast.error(err instanceof ApiError ? err.message : 'Could not submit the request'),
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
      <div className="space-y-2">
        <Label htmlFor="leave-type">Leave type</Label>
        <Select
          value={leaveTypeId || undefined}
          onValueChange={(v) => form.setValue('leaveTypeId', v, { shouldDirty: true })}
        >
          <SelectTrigger
            id="leave-type"
            className="w-full"
            aria-invalid={Boolean(form.formState.errors.leaveTypeId)}
          >
            <SelectValue placeholder="Choose a type" />
          </SelectTrigger>
          <SelectContent>
            {types.data?.map((t) => {
              const b = balances.find((x) => x.leaveTypeId === t.id);
              return (
                <SelectItem key={t.id} value={t.id}>
                  {t.name}
                  {b ? ` — ${b.available} left` : ''}
                </SelectItem>
              );
            })}
          </SelectContent>
        </Select>
        {form.formState.errors.leaveTypeId && (
          <p role="alert" className="text-destructive-text text-sm">
            {form.formState.errors.leaveTypeId.message}
          </p>
        )}
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="From" error={form.formState.errors.startDate?.message}>
          {(a11y) => (
            <Input
              {...a11y}
              type="date"
              {...form.register('startDate', {
                onChange: (e) => {
                  // Keep the range valid as the start moves forward
                  if (form.getValues('endDate') < e.target.value) {
                    form.setValue('endDate', e.target.value);
                  }
                },
              })}
            />
          )}
        </Field>
        <Field label="To" error={form.formState.errors.endDate?.message}>
          {(a11y) => <Input {...a11y} type="date" min={startDate} {...form.register('endDate')} />}
        </Field>
      </div>

      {singleDay && (
        <div className="space-y-2">
          <Label htmlFor="duration">Duration</Label>
          <Select
            value={halfDaySide ?? FULL_DAY}
            onValueChange={(v) =>
              form.setValue(
                'halfDaySide',
                v === FULL_DAY ? null : (v as 'FIRST_HALF' | 'SECOND_HALF'),
                { shouldDirty: true },
              )
            }
          >
            <SelectTrigger id="duration" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={FULL_DAY}>Full day</SelectItem>
              <SelectItem value="FIRST_HALF">First half</SelectItem>
              <SelectItem value="SECOND_HALF">Second half</SelectItem>
            </SelectContent>
          </Select>
        </div>
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

      <Field label="Reason" required error={form.formState.errors.reason?.message}>
        {(a11y) => (
          <Textarea
            {...a11y}
            rows={3}
            placeholder="Family function out of town"
            {...form.register('reason')}
          />
        )}
      </Field>
    </FormDialog>
  );
}
