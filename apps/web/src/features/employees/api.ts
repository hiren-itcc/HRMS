import type {
  BankDetailInput,
  EmployeeConfirmInput,
  EmployeeCreateInput,
  EmployeeExtendProbationInput,
  EmployeeOffboardInput,
  EmployeeRoleChangeInput,
  EmployeeUpdateInput,
  RoleCodeInput,
  SelfProfileUpdateInput,
} from '@hrms/shared';
import type { Paginated } from '@hrms/types';
import { api, fetchBlob } from '@/lib/api-client';
import { type ListRequest, qs } from '@/lib/crud';
import type { BankDetail, EmployeeDetail, EmployeeListItem, EmployeeOption } from './types';

export const employeesApi = {
  list: (params: ListRequest) => api<Paginated<EmployeeListItem>>(`/employees${qs(params)}`),
  /** The current list as a file — same filters, same columns import accepts. */
  exportFile: (params: ListRequest) => fetchBlob(`/employees/export${qs(params)}`),
  detail: (id: string) => api<EmployeeDetail>(`/employees/${id}`),
  options: () => api<EmployeeOption[]>('/employees/options'),

  /**
   * Records somebody leaving, or withdraws a resignation. Not a delete — the
   * record and all its history stay, which is why it is a separate action.
   */
  offboard: (id: string, input: EmployeeOffboardInput) =>
    api<{ id: string; status: string; exitDate: string | null }>(`/employees/${id}/offboard`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  confirm: (id: string, input: EmployeeConfirmInput) =>
    api<{ id: string; confirmedOn: string }>(`/employees/${id}/confirm`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  extendProbation: (id: string, input: EmployeeExtendProbationInput) =>
    api<{ id: string; probationExtendedTo: string }>(`/employees/${id}/extend-probation`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  create: (input: EmployeeCreateInput) =>
    api<EmployeeListItem & { loginCreated: boolean; loginEmail: string | null }>('/employees', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  update: (id: string, input: EmployeeUpdateInput) =>
    api<EmployeeListItem>(`/employees/${id}`, { method: 'PATCH', body: JSON.stringify(input) }),
  setRole: (id: string, input: EmployeeRoleChangeInput) =>
    api<{ roleCode: RoleCodeInput; sessionsRevoked: number }>(`/employees/${id}/role`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),
  remove: (id: string) => api<void>(`/employees/${id}`, { method: 'DELETE' }),
  upsertBank: (id: string, input: BankDetailInput) =>
    api<BankDetail>(`/employees/${id}/bank`, { method: 'PUT', body: JSON.stringify(input) }),
};

export const meApi = {
  profile: () => api<EmployeeDetail>('/me/profile'),
  updateProfile: (input: SelfProfileUpdateInput) =>
    api<EmployeeDetail>('/me/profile', { method: 'PATCH', body: JSON.stringify(input) }),
};
