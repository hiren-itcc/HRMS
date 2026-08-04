'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { employeeCreateSchema } from '@hrms/shared';
import type { EmployeeStatus, Gender } from '@hrms/types';
import { Alert, AlertDescription, AlertTitle } from '@hrms/ui/components/alert';
import { Button } from '@hrms/ui/components/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@hrms/ui/components/card';
import { SelectItem } from '@hrms/ui/components/select';
import { useQueryClient } from '@tanstack/react-query';
import { KeyRound, Loader2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import type { z } from 'zod';
import { FormCheckbox, FormDatePicker, FormInput, FormSelect } from '@/components/form';
import { employeesApi } from '@/features/employees/api';
import { ROLE_LABEL, ROLE_OPTIONS } from '@/features/employees/role-options';
import { fullName } from '@/features/employees/types';
import {
  departmentsApi,
  designationsApi,
  employmentTypesApi,
  locationsApi,
  shiftsApi,
} from '@/features/organization/api';
import { errorMessage, type Option, useOptions } from '@/hooks/use-crud';

type FormValues = z.input<typeof employeeCreateSchema>;

/**
 * Only the settable statuses appear in the form. ONBOARDING is reached by
 * inviting somebody and left by approving them — never by picking it here.
 */
const STATUS_LABEL: Record<Exclude<EmployeeStatus, 'ONBOARDING'>, string> = {
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

export function EmployeeForm({ initial, employeeId, onSaved }: EmployeeFormProps) {
  const router = useRouter();
  const isEdit = Boolean(employeeId);

  const departments = useOptions('org-departments', departmentsApi.options, (d) => d.name);
  const designations = useOptions('org-designations', designationsApi.options, (d) => d.title);
  const locations = useOptions('org-locations', locationsApi.options, (l) => l.name);
  const shifts = useOptions('org-shifts', shiftsApi.options, (s) => s.name);
  const employmentTypes = useOptions(
    'org-employment-types',
    employmentTypesApi.options,
    (t) => t.name,
  );
  const managers = useOptions(
    'employees',
    employeesApi.options,
    (m) => `${fullName(m)} (${m.employeeCode})`,
  );

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
      // Empty rather than null: these are required, so they start unanswered
      // and the select shows its "Select a department" placeholder.
      departmentId: '',
      designationId: '',
      locationId: '',
      shiftId: '',
      employmentTypeId: '',
      managerId: null,
      createLogin: true,
      loginRole: 'EMPLOYEE',
      ...initial,
    },
  });
  const { isSubmitting } = form.formState;

  /*
   * This form submits directly rather than through a mutation, so nothing was
   * telling the cache. Adding somebody and landing back on the directory
   * showed a list without them in it until the entry went stale.
   */
  const queryClient = useQueryClient();
  const invalidateEmployees = () => queryClient.invalidateQueries({ queryKey: ['employees'] });

  const submit = form.handleSubmit(async (raw) => {
    const input = employeeCreateSchema.parse(raw);
    try {
      if (isEdit && employeeId) {
        await employeesApi.update(employeeId, input);
        invalidateEmployees();
        toast.success('Employee updated');
        onSaved(employeeId);
      } else {
        const created = await employeesApi.create(input);
        invalidateEmployees();
        toast.success(`${fullName(created)} added (${created.employeeCode})`, {
          description: created.loginCreated
            ? `They can sign in as ${created.loginEmail} with the default password.`
            : 'No sign-in was created — they cannot log in yet.',
        });
        onSaved(created.id);
      }
    } catch (err) {
      toast.error(errorMessage(err, 'Could not save. Try again.'));
    }
  });

  /**
   * The five required job-detail selects, which differ only in their options.
   *
   * All the wiring that used to live here — the id, the four aria props on the
   * trigger, the error, the NONE sentinel — belongs to `FormSelect` now, and
   * the `{id, label}` normalisation to `useOptions`. What is left is the one
   * thing genuinely local: options arrive asynchronously, so an empty list has
   * to read as "not yet" rather than "there are none".
   */
  const OptionSelect = ({
    label,
    name,
    items,
  }: {
    label: string;
    name: 'departmentId' | 'designationId' | 'locationId' | 'shiftId' | 'employmentTypeId';
    items: Option[] | undefined;
  }) => {
    const pending = items === undefined;
    return (
      <FormSelect
        control={form.control}
        name={name}
        label={label}
        required
        busy={pending}
        hint={pending ? 'Loading options…' : undefined}
        placeholder={pending ? 'Loading…' : `Select ${label.toLowerCase()}`}
      >
        {items?.map((item) => (
          <SelectItem key={item.id} value={item.id}>
            {item.label}
          </SelectItem>
        ))}
      </FormSelect>
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
          <FormInput
            control={form.control}
            name="firstName"
            label="First name"
            required
            autoFocus
          />
          <FormInput control={form.control} name="lastName" label="Last name" required />
          <FormInput
            control={form.control}
            name="workEmail"
            label="Work email"
            required
            type="email"
          />
          <FormInput
            control={form.control}
            name="personalEmail"
            label="Personal email"
            type="email"
          />
          <FormInput control={form.control} name="phone" label="Phone" type="tel" />
          <FormDatePicker
            control={form.control}
            name="dateOfBirth"
            label="Date of birth"
            placeholder="Select date of birth"
          />
          {/* Gender is optional, so `undefined` rather than null — the schema
              has no null branch for it. */}
          <FormSelect
            control={form.control}
            name="gender"
            label="Gender"
            placeholder="Not specified"
            emptyLabel="Not specified"
            emptyValue={undefined}
          >
            {Object.entries(GENDER_LABEL).map(([value, label]) => (
              <SelectItem key={value} value={value}>
                {label}
              </SelectItem>
            ))}
          </FormSelect>
          <FormInput control={form.control} name="addressLine" label="Address" />
          <FormInput control={form.control} name="city" label="City" />
          <FormInput control={form.control} name="country" label="Country" />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Job details</CardTitle>
          <CardDescription>Placement in the organization</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <FormInput
            control={form.control}
            name="employeeCode"
            label="Employee ID"
            hint={isEdit ? undefined : 'Leave blank to auto-generate (EMP-0001…)'}
            placeholder="EMP-0001"
          />
          <FormDatePicker
            control={form.control}
            name="joinDate"
            label="Joining date"
            required
            placeholder="Select joining date"
          />
          <OptionSelect label="Department" name="departmentId" items={departments.options} />
          <OptionSelect label="Designation" name="designationId" items={designations.options} />
          <OptionSelect label="Location" name="locationId" items={locations.options} />
          {/*
           * Manager is the only optional one: somebody has to be at the top of
           * the org chart, and the first employee in a new organization has
           * nobody to point at. Everything else must be answered.
           */}
          <FormSelect
            control={form.control}
            name="managerId"
            label="Reporting manager"
            emptyLabel="None — top of the organisation"
            busy={managers.isPending}
            placeholder="Select reporting manager"
          >
            {managers.options
              ?.filter((m) => m.id !== employeeId)
              .map((m) => (
                <SelectItem key={m.id} value={m.id}>
                  {m.label}
                </SelectItem>
              ))}
          </FormSelect>
          <OptionSelect label="Shift" name="shiftId" items={shifts.options} />
          <OptionSelect
            label="Employment type"
            name="employmentTypeId"
            items={employmentTypes.options}
          />
          <FormSelect control={form.control} name="status" label="Employment status">
            {Object.entries(STATUS_LABEL).map(([value, label]) => (
              <SelectItem key={value} value={value}>
                {label}
              </SelectItem>
            ))}
          </FormSelect>
        </CardContent>
      </Card>

      {!isEdit && (
        <Card>
          <CardHeader>
            <CardTitle>Sign-in &amp; role</CardTitle>
            <CardDescription>
              Creates a login using the work email above, and decides what they can do. Without one,
              the record exists but the person cannot use the product.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <FormCheckbox
                control={form.control}
                name="createLogin"
                label="Create a sign-in for this employee"
              />
            </div>

            {form.watch('createLogin') && (
              <>
                <FormSelect
                  control={form.control}
                  name="loginRole"
                  label="Role"
                  hint="Anything beyond self-service is a decision"
                >
                  {ROLE_OPTIONS.map(({ value, label }) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </FormSelect>

                <Alert variant="info" className="sm:col-span-2">
                  <KeyRound aria-hidden />
                  <AlertTitle>They start on the default password</AlertTitle>
                  <AlertDescription>
                    They sign in with their work email and the organization's default password, then
                    have to set their own before they can do anything else.
                  </AlertDescription>
                </Alert>
              </>
            )}
          </CardContent>
        </Card>
      )}

      {/*
        The role lives at the bottom of a long form and defaults to Employee,
        which made it easy to submit without ever seeing it. Restating it here
        makes the default a choice rather than an accident.
      */}
      {!isEdit && (
        <p className="text-muted-foreground text-sm">
          {form.watch('createLogin') ? (
            <>
              Will create a sign-in as{' '}
              <strong className="text-foreground">
                {ROLE_LABEL[form.watch('loginRole') ?? 'EMPLOYEE']}
              </strong>
              .
            </>
          ) : (
            'No sign-in will be created — this person will not be able to log in.'
          )}
        </p>
      )}

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
