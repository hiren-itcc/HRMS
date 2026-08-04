'use client';

import { Button } from '@hrms/ui/components/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@hrms/ui/components/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@hrms/ui/components/select';
import { Loader2 } from 'lucide-react';
import { useState } from 'react';
import { Field } from '@/components/field';
import { employeesApi } from '@/features/employees/api';
import { onboardingKeys } from '@/features/onboarding/api';
import {
  departmentsApi,
  designationsApi,
  employmentTypesApi,
  locationsApi,
  shiftsApi,
} from '@/features/organization/api';
import { useApiMutation, useOptions } from '@/hooks/use-crud';

/**
 * Where HR fills in the job details onboarding let them defer.
 *
 * These live here rather than only on the edit form because approval is where
 * they become required — telling somebody "set the department before
 * approving" on a screen with no way to set the department is an instruction
 * to go and find another screen.
 */
export function JobDetailsCard({
  employeeId,
  current,
  disabled,
}: {
  employeeId: string;
  current: {
    departmentId: string | null;
    designationId: string | null;
    locationId: string | null;
    shiftId: string | null;
    employmentTypeId: string | null;
    managerId: string | null;
  };
  disabled: boolean;
}) {
  const [draft, setDraft] = useState(current);

  const departments = useOptions('org-departments', departmentsApi.options, (d) => d.name);
  const designations = useOptions('org-designations', designationsApi.options, (d) => d.title);
  const locations = useOptions('org-locations', locationsApi.options, (l) => l.name);
  const shifts = useOptions('org-shifts', shiftsApi.options, (s) => s.name);
  const employmentTypes = useOptions(
    'org-employment-types',
    employmentTypesApi.options,
    (t) => t.name,
  );

  const save = useApiMutation({
    /*
     * Only the fields that have a value. `employeeUpdateSchema` is a partial
     * of the create schema, where these ids are `requiredId` — so an absent
     * key is fine but an explicit null is a validation error, and a
     * half-filled form would fail on the boxes HR had not reached yet.
     */
    mutationFn: () =>
      employeesApi.update(
        employeeId,
        Object.fromEntries(Object.entries(draft).filter(([, v]) => v)),
      ),
    invalidate: [onboardingKeys.all(), ['employees']],
    success: 'Job details saved',
    error: 'Could not save the job details',
  });

  /*
   * `opts` is undefined until the request settles. That distinction is the
   * point: this card told HR "None configured yet" through the whole first
   * render, sending them off to create departments that already existed.
   */
  const rows = [
    { key: 'departmentId', label: 'Department', opts: departments.options },
    { key: 'designationId', label: 'Designation', opts: designations.options },
    { key: 'locationId', label: 'Location', opts: locations.options },
    { key: 'shiftId', label: 'Shift', opts: shifts.options },
    { key: 'employmentTypeId', label: 'Employment type', opts: employmentTypes.options },
  ] as const;

  const missing = rows.filter((r) => !draft[r.key]).map((r) => r.label.toLowerCase());
  const dirty = rows.some((r) => draft[r.key] !== current[r.key]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Job details</CardTitle>
        <CardDescription>
          {missing.length > 0
            ? `Needed before approving: ${missing.join(', ')}`
            : 'Where this person sits in the organization'}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          {rows.map((row) => (
            <Field key={row.key} label={row.label}>
              {(a11y) => (
                <Select
                  value={draft[row.key] ?? ''}
                  onValueChange={(v) => setDraft((d) => ({ ...d, [row.key]: v }))}
                  disabled={disabled || row.opts?.length === 0}
                >
                  <SelectTrigger
                    {...a11y}
                    aria-busy={row.opts === undefined || undefined}
                    className="w-full"
                  >
                    <SelectValue
                      placeholder={
                        row.opts === undefined
                          ? 'Loading…'
                          : row.opts.length === 0
                            ? 'None configured yet'
                            : 'Select'
                      }
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {row.opts?.map((o) => (
                      <SelectItem key={o.id} value={o.id}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </Field>
          ))}
        </div>

        {rows.some((r) => r.opts?.length === 0) && (
          <p className="text-muted-foreground text-xs">
            Anything marked “None configured yet” has to be created under Organization first.
          </p>
        )}

        {!disabled && (
          <Button disabled={!dirty || save.isPending} onClick={() => save.mutate()}>
            {save.isPending && <Loader2 className="size-4 animate-spin" aria-hidden />}
            Save job details
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
