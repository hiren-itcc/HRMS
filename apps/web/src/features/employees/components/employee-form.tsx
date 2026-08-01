'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { employeeCreateSchema } from '@hrms/shared';
import type { EmployeeStatus, Gender } from '@hrms/types';
import { Button } from '@hrms/ui/components/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@hrms/ui/components/card';
import { Input } from '@hrms/ui/components/input';
import { Label } from '@hrms/ui/components/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@hrms/ui/components/select';
import { useQuery } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import type { z } from 'zod';
import { FormField } from '@/components/form-field';
import { Field } from '@/features/auth/components/field';
import { employeesApi } from '@/features/employees/api';
import { fullName } from '@/features/employees/types';
import { departmentsApi, locationsApi } from '@/features/organization/api';
import { ApiError, api } from '@/lib/api-client';

const NONE = 'none';
type FormValues = z.input<typeof employeeCreateSchema>;

const STATUS_LABEL: Record<EmployeeStatus, string> = {
  ACTIVE: 'Active',
  ON_NOTICE: 'On notice',
  EXITED: 'Exited',
};
const GENDER_LABEL: Record<Gender, string> = {
  MALE: 'Male',
  FEMALE: 'Female',
  OTHER: 'Other',
  PREFER_NOT_TO_SAY: 'Prefer not to say',
};

interface EmployeeFormProps {
  /** Prefilled values when editing; omit for create. */
  initial?: Partial<FormValues>;
  employeeId?: string;
  onSaved: (id: string) => void;
}

function useOptionsQuery<T>(key: string, fn: () => Promise<T>) {
  return useQuery({ queryKey: [key, 'options'], queryFn: fn, staleTime: 60_000 });
}

export function EmployeeForm({ initial, employeeId, onSaved }: EmployeeFormProps) {
  const router = useRouter();
  const isEdit = Boolean(employeeId);

  const departments = useOptionsQuery('org-departments', departmentsApi.options);
  const designations = useOptionsQuery('org-designations', () =>
    api<{ id: string; title: string }[]>('/organization/designations/options'),
  );
  const locations = useOptionsQuery('org-locations', locationsApi.options);
  const shifts = useOptionsQuery('org-shifts', () =>
    api<{ id: string; name: string }[]>('/organization/shifts/options'),
  );
  const employmentTypes = useOptionsQuery('org-employment-types', () =>
    api<{ id: string; name: string }[]>('/organization/employment-types/options'),
  );
  const managers = useOptionsQuery('employees', employeesApi.options);

  const form = useForm<FormValues>({
    resolver: zodResolver(employeeCreateSchema),
    defaultValues: {
      employeeCode: '',
      firstName: '',
      lastName: '',
      workEmail: '',
      personalEmail: '',
      phone: '',
      dateOfBirth: '',
      addressLine: '',
      city: '',
      country: '',
      status: 'ACTIVE',
      joinDate: new Date().toISOString().slice(0, 10),
      departmentId: null,
      designationId: null,
      locationId: null,
      managerId: null,
      shiftId: null,
      employmentTypeId: null,
      ...initial,
    },
  });
  const { errors, isSubmitting } = form.formState;

  const submit = form.handleSubmit(async (raw) => {
    const input = employeeCreateSchema.parse(raw);
    try {
      if (isEdit && employeeId) {
        await employeesApi.update(employeeId, input);
        toast.success('Employee updated');
        onSaved(employeeId);
      } else {
        const created = await employeesApi.create(input);
        toast.success(`${fullName(created)} added (${created.employeeCode})`);
        onSaved(created.id);
      }
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Could not save. Try again.');
    }
  });

  const selectField = (
    label: string,
    field:
      | 'departmentId'
      | 'designationId'
      | 'locationId'
      | 'managerId'
      | 'shiftId'
      | 'employmentTypeId',
    items: { id: string; label: string }[] | undefined,
  ) => {
    const value = form.watch(field);
    const pending = items === undefined;
    return (
      <FormField label={label} hint={pending ? 'Loading options…' : undefined}>
        {(a11y) => (
          <Select
            value={value ?? NONE}
            onValueChange={(v) =>
              form.setValue(field, v === NONE ? null : v, { shouldDirty: true })
            }
          >
            <SelectTrigger
              id={a11y.id}
              aria-describedby={a11y['aria-describedby']}
              aria-busy={pending || undefined}
            >
              <SelectValue placeholder={pending ? 'Loading…' : 'None'} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>None</SelectItem>
              {items?.map((item) => (
                <SelectItem key={item.id} value={item.id}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </FormField>
    );
  };

  return (
    <form onSubmit={submit} className="space-y-6" noValidate>
      <Card>
        <CardHeader>
          <CardTitle>Personal details</CardTitle>
          <CardDescription>Identity and contact information</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Field label="First name" required error={errors.firstName?.message}>
            {(a11y) => <Input {...a11y} autoFocus {...form.register('firstName')} />}
          </Field>
          <Field label="Last name" required error={errors.lastName?.message}>
            {(a11y) => <Input {...a11y} {...form.register('lastName')} />}
          </Field>
          <Field label="Work email" required error={errors.workEmail?.message}>
            {(a11y) => <Input {...a11y} type="email" {...form.register('workEmail')} />}
          </Field>
          <Field label="Personal email" error={errors.personalEmail?.message}>
            {(a11y) => <Input {...a11y} type="email" {...form.register('personalEmail')} />}
          </Field>
          <Field label="Phone" error={errors.phone?.message}>
            {(a11y) => <Input {...a11y} type="tel" {...form.register('phone')} />}
          </Field>
          <Field label="Date of birth" error={errors.dateOfBirth?.message}>
            {(a11y) => <Input {...a11y} type="date" {...form.register('dateOfBirth')} />}
          </Field>
          <div className="space-y-2">
            <Label htmlFor="gender">Gender</Label>
            <Select
              value={form.watch('gender') ?? NONE}
              onValueChange={(v) =>
                form.setValue('gender', v === NONE ? undefined : (v as Gender), {
                  shouldDirty: true,
                })
              }
            >
              <SelectTrigger id="gender" className="w-full">
                <SelectValue placeholder="Not specified" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>Not specified</SelectItem>
                {Object.entries(GENDER_LABEL).map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Field label="Address" error={errors.addressLine?.message}>
            {(a11y) => <Input {...a11y} {...form.register('addressLine')} />}
          </Field>
          <Field label="City" error={errors.city?.message}>
            {(a11y) => <Input {...a11y} {...form.register('city')} />}
          </Field>
          <Field label="Country" error={errors.country?.message}>
            {(a11y) => <Input {...a11y} {...form.register('country')} />}
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Job details</CardTitle>
          <CardDescription>Placement in the organization</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Employee ID"
            error={errors.employeeCode?.message}
            hint={isEdit ? undefined : 'Leave blank to auto-generate (EMP-0001…)'}
          >
            {(a11y) => (
              <Input {...a11y} placeholder="EMP-0001" {...form.register('employeeCode')} />
            )}
          </Field>
          <Field label="Joining date" error={errors.joinDate?.message}>
            {(a11y) => <Input {...a11y} type="date" {...form.register('joinDate')} />}
          </Field>
          {selectField(
            'Department',
            'departmentId',
            departments.data?.map((d) => ({ id: d.id, label: d.name })),
          )}
          {selectField(
            'Designation',
            'designationId',
            designations.data?.map((d) => ({ id: d.id, label: d.title })),
          )}
          {selectField(
            'Location',
            'locationId',
            locations.data?.map((l) => ({ id: l.id, label: l.name })),
          )}
          {selectField(
            'Reporting manager',
            'managerId',
            managers.data
              ?.filter((m) => m.id !== employeeId)
              .map((m) => ({ id: m.id, label: `${fullName(m)} (${m.employeeCode})` })),
          )}
          {selectField(
            'Shift',
            'shiftId',
            shifts.data?.map((s) => ({ id: s.id, label: s.name })),
          )}
          {selectField(
            'Employment type',
            'employmentTypeId',
            employmentTypes.data?.map((t) => ({ id: t.id, label: t.name })),
          )}
          <div className="space-y-2">
            <Label htmlFor="employment-status">Employment status</Label>
            <Select
              value={form.watch('status') ?? 'ACTIVE'}
              onValueChange={(v) =>
                form.setValue('status', v as EmployeeStatus, { shouldDirty: true })
              }
            >
              <SelectTrigger id="employment-status" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(STATUS_LABEL).map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <div className="flex gap-3">
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting && <Loader2 className="size-4 animate-spin" aria-hidden />}
          {isEdit ? 'Save changes' : 'Add employee'}
        </Button>
        <Button type="button" variant="outline" onClick={() => router.back()}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
