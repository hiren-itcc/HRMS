'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { OFFBOARDING_REASON_LABELS, offboardingCreateSchema } from '@hrms/shared';
import { SelectItem } from '@hrms/ui/components/select';
import { useForm } from 'react-hook-form';
import type { z } from 'zod';
import { FormDialog } from '@/components/crud/form-dialog';
import { FormDatePicker, FormInput, FormSelect } from '@/components/form';
import { employeesApi } from '@/features/employees/api';
import { fullName } from '@/features/employees/types';
import { useApiMutation, useOptions } from '@/hooks/use-crud';
import { offboardingKeys, offboardingsApi } from '../api';

type FormValues = z.input<typeof offboardingCreateSchema>;

/**
 * HR starting an exit that is not a resignation.
 *
 * `RESIGNATION` is deliberately absent from the reason list — the API refuses
 * it too. An offboarding with that reason and no resignation behind it would
 * be a resignation nobody could find, which is exactly how an attrition report
 * ends up disagreeing with the approvals inbox.
 */
export function StartOffboardingDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const employees = useOptions(
    'employees',
    employeesApi.options,
    (e) => `${fullName(e)} (${e.employeeCode})`,
    { enabled: open },
  );

  const form = useForm<FormValues>({
    resolver: zodResolver(offboardingCreateSchema),
    defaultValues: { employeeId: '', reason: 'TERMINATION', reasonNote: '', lastWorkingDate: '' },
  });
  const reason = form.watch('reason');

  const start = useApiMutation({
    mutationFn: (values: FormValues) =>
      offboardingsApi.create(offboardingCreateSchema.parse(values)),
    invalidate: [offboardingKeys.all(), ['employees'], ['lifecycle']],
    success: 'Exit recorded — they are now on notice',
    error: 'Could not start the offboarding',
    onSuccess: () => {
      onOpenChange(false);
      form.reset();
    },
  });

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Start an exit"
      description="For a termination, a contract ending or a retirement. A resignation starts its own offboarding when HR approves it."
      onSubmit={form.handleSubmit((v) => start.mutate(v))}
      submitting={start.isPending}
      submitLabel="Start offboarding"
    >
      <FormSelect
        control={form.control}
        name="employeeId"
        label="Employee"
        required
        busy={employees.options === undefined}
        placeholder={employees.options === undefined ? 'Loading…' : 'Select an employee'}
      >
        {employees.options?.map((e) => (
          <SelectItem key={e.id} value={e.id}>
            {e.label}
          </SelectItem>
        ))}
      </FormSelect>

      <FormSelect control={form.control} name="reason" label="Reason" required>
        {Object.entries(OFFBOARDING_REASON_LABELS)
          .filter(([value]) => value !== 'RESIGNATION')
          .map(([value, label]) => (
            <SelectItem key={value} value={value}>
              {label}
            </SelectItem>
          ))}
      </FormSelect>

      <FormInput
        control={form.control}
        name="reasonNote"
        label="Note"
        required={reason === 'OTHER'}
        hint={reason === 'OTHER' ? 'Required when the reason is Other' : 'Optional'}
      />

      <FormDatePicker
        control={form.control}
        name="lastWorkingDate"
        label="Last working date"
        required
        hint="They stay a full employee until this date — sign-in, attendance, leave and payroll are unchanged."
        placeholder="Select the last working date"
      />
    </FormDialog>
  );
}
