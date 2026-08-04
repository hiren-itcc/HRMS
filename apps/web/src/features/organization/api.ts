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
import type { Paginated } from '@hrms/types';
import { api } from '@/lib/api-client';
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

export type ListRequest = Record<string, string | number | undefined>;

function qs(params: ListRequest): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') search.set(key, String(value));
  }
  const s = search.toString();
  return s ? `?${s}` : '';
}

export interface CrudApi<TRow, TCreate, TUpdate> {
  list: (params: ListRequest) => Promise<Paginated<TRow>>;
  create: (input: TCreate) => Promise<TRow>;
  update: (id: string, input: TUpdate) => Promise<TRow>;
  remove: (id: string) => Promise<void>;
}

function crudApi<TRow, TCreate, TUpdate>(base: string): CrudApi<TRow, TCreate, TUpdate> {
  return {
    list: (params) => api<Paginated<TRow>>(`${base}${qs(params)}`),
    create: (input) => api<TRow>(base, { method: 'POST', body: JSON.stringify(input) }),
    update: (id, input) =>
      api<TRow>(`${base}/${id}`, { method: 'PATCH', body: JSON.stringify(input) }),
    remove: (id) => api<void>(`${base}/${id}`, { method: 'DELETE' }),
  };
}

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
