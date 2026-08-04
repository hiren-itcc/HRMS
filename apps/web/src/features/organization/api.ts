import type {
  CompanyUpdateInput,
  DepartmentCreateInput,
  DepartmentUpdateInput,
  DesignationCreateInput,
  DesignationUpdateInput,
  EmploymentTypeCreateInput,
  EmploymentTypeUpdateInput,
  HolidayCreateInput,
  HolidayUpdateInput,
  LocationCreateInput,
  LocationUpdateInput,
  ShiftCreateInput,
  ShiftUpdateInput,
} from '@hrms/shared';
import { api } from '@/lib/api-client';
import { crudApi } from '@/lib/crud';
import type {
  Company,
  Department,
  Designation,
  EmploymentTypeRow,
  Holiday,
  Location,
  Option,
  Shift,
} from './types';

/**
 * Re-exported so the many `import type { ListRequest } from '@/features/organization/api'`
 * lines keep working. New code should import from `@/lib/crud` directly —
 * none of this is organizational.
 */
export type { CrudApi, ListRequest } from '@/lib/crud';

export interface OrgChartNode {
  id: string;
  firstName: string;
  lastName: string;
  employeeCode: string;
  designation: string | null;
  department: string | null;
  avatarUrl: string | null;
  /** Everybody below them, not just direct reports. */
  totalReports: number;
  reports: OrgChartNode[];
}

export const companyApi = {
  get: () => api<Company>('/organization'),
  /** The reporting tree. Several roots are normal — see the service. */
  chart: () => api<{ roots: OrgChartNode[]; total: number }>('/organization/chart'),
  update: (input: CompanyUpdateInput) =>
    api<Company>('/organization', { method: 'PATCH', body: JSON.stringify(input) }),
};

export const departmentsApi = {
  ...crudApi<Department, DepartmentCreateInput, DepartmentUpdateInput>('/organization/departments'),
  options: () => api<Option[]>('/organization/departments/options'),
};

export const designationsApi = crudApi<Designation, DesignationCreateInput, DesignationUpdateInput>(
  '/organization/designations',
);

export const employmentTypesApi = crudApi<
  EmploymentTypeRow,
  EmploymentTypeCreateInput,
  EmploymentTypeUpdateInput
>('/organization/employment-types');

export const locationsApi = {
  ...crudApi<Location, LocationCreateInput, LocationUpdateInput>('/organization/locations'),
  options: () => api<(Option & { type: string })[]>('/organization/locations/options'),
};

export const shiftsApi = crudApi<Shift, ShiftCreateInput, ShiftUpdateInput>('/organization/shifts');

export const holidaysApi = crudApi<Holiday, HolidayCreateInput, HolidayUpdateInput>(
  '/organization/holidays',
);
