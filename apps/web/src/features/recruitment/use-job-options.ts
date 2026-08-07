'use client';

import { employeesApi } from '@/features/employees/api';
import {
  departmentsApi,
  designationsApi,
  employmentTypesApi,
  locationsApi,
} from '@/features/organization/api';
import { useOptions } from '@/hooks/use-crud';

/**
 * The pickers that describe a job.
 *
 * An opening and an offer name the same four things — department, designation,
 * location, employment type — because an offer may differ from the advert, and
 * the offer is the one that becomes the employee record. Fetching them in one
 * place keeps the two screens asking the same questions in the same order.
 *
 * `useOptions` caches for a minute and keys by the module prefix, so these are
 * the same queries the organization screens already warmed.
 */
export function useJobOptions() {
  const departments = useOptions('departments', departmentsApi.options, (d) => d.name);
  const designations = useOptions('designations', designationsApi.options, (d) => d.title);
  const locations = useOptions('locations', locationsApi.options, (l) => l.name);
  const employmentTypes = useOptions('employment-types', employmentTypesApi.options, (t) => t.name);
  const employees = useOptions(
    'employees',
    employeesApi.options,
    (e) => `${e.firstName} ${e.lastName}`,
  );

  return { departments, designations, locations, employmentTypes, employees };
}
