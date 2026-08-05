import type { WfhApplyInput, WfhDecisionInput, WfhPreview } from '@hrms/shared';
import type { Paginated } from '@hrms/types';
import { api } from '@/lib/api-client';
import { type ListRequest, qs } from '@/lib/crud';

export type WfhStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';

export interface RemoteWorkRequest {
  id: string;
  employeeId: string;
  startDate: string;
  endDate: string;
  /** Working days the range covers — frozen when it was filed. */
  days: number;
  reason: string;
  status: WfhStatus;
  approverId: string | null;
  actedAt: string | null;
  approverNote: string | null;
  createdAt: string;
  employee: {
    id: string;
    firstName: string;
    lastName: string;
    employeeCode: string;
    avatarUrl: string | null;
    managerId: string | null;
  };
}

export const WFH_STATUS_LABELS: Record<WfhStatus, string> = {
  PENDING: 'Waiting',
  APPROVED: 'Approved',
  REJECTED: 'Declined',
  CANCELLED: 'Withdrawn',
};

export const wfhKeys = {
  all: () => ['wfh'] as const,
  list: (params: ListRequest) => ['wfh', 'list', params] as const,
  mine: (params: ListRequest) => ['wfh', 'mine', params] as const,
  preview: (startDate: string, endDate: string) => ['wfh', 'preview', startDate, endDate] as const,
};

export const wfhApi = {
  mine: (params: ListRequest) => api<Paginated<RemoteWorkRequest>>(`/wfh/me${qs(params)}`),
  list: (params: ListRequest) => api<Paginated<RemoteWorkRequest>>(`/wfh${qs(params)}`),
  preview: (startDate: string, endDate: string) =>
    api<WfhPreview>(`/wfh/preview${qs({ startDate, endDate })}`),

  apply: (input: WfhApplyInput) =>
    api<RemoteWorkRequest>('/wfh', { method: 'POST', body: JSON.stringify(input) }),
  amend: (id: string, input: WfhApplyInput) =>
    api<RemoteWorkRequest>(`/wfh/${id}`, { method: 'PATCH', body: JSON.stringify(input) }),
  cancel: (id: string) => api<RemoteWorkRequest>(`/wfh/${id}/cancel`, { method: 'POST' }),

  approve: (id: string, input: WfhDecisionInput) =>
    api<RemoteWorkRequest>(`/wfh/${id}/approve`, { method: 'POST', body: JSON.stringify(input) }),
  reject: (id: string, input: WfhDecisionInput) =>
    api<RemoteWorkRequest>(`/wfh/${id}/reject`, { method: 'POST', body: JSON.stringify(input) }),
};
