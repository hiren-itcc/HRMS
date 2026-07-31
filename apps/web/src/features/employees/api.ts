import type {
  BankDetailInput,
  EmployeeCreateInput,
  EmployeeUpdateInput,
  SelfProfileUpdateInput,
} from '@hrms/shared';
import type { Paginated } from '@hrms/types';
import type { ListRequest } from '@/features/organization/api';
import { api } from '@/lib/api-client';
import type { BankDetail, EmployeeDetail, EmployeeListItem, EmployeeOption } from './types';

function qs(params: ListRequest): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') search.set(key, String(value));
  }
  const s = search.toString();
  return s ? `?${s}` : '';
}

export const employeesApi = {
  list: (params: ListRequest) => api<Paginated<EmployeeListItem>>(`/employees${qs(params)}`),
  detail: (id: string) => api<EmployeeDetail>(`/employees/${id}`),
  options: () => api<EmployeeOption[]>('/employees/options'),
  create: (input: EmployeeCreateInput) =>
    api<EmployeeListItem>('/employees', { method: 'POST', body: JSON.stringify(input) }),
  update: (id: string, input: EmployeeUpdateInput) =>
    api<EmployeeListItem>(`/employees/${id}`, { method: 'PATCH', body: JSON.stringify(input) }),
  remove: (id: string) => api<void>(`/employees/${id}`, { method: 'DELETE' }),
  upsertBank: (id: string, input: BankDetailInput) =>
    api<BankDetail>(`/employees/${id}/bank`, { method: 'PUT', body: JSON.stringify(input) }),
};

export const meApi = {
  profile: () => api<EmployeeDetail>('/me/profile'),
  updateProfile: (input: SelfProfileUpdateInput) =>
    api<EmployeeDetail>('/me/profile', { method: 'PATCH', body: JSON.stringify(input) }),
};
