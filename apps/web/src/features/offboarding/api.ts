import type {
  OffboardingCancelInput,
  OffboardingCompleteInput,
  OffboardingCreateInput,
  OffboardingReasonCode,
  OffboardingStatusCode,
  OffboardingUpdateInput,
} from '@hrms/shared';
import type { Paginated } from '@hrms/types';
import { api } from '@/lib/api-client';
import { type ListRequest, qs } from '@/lib/crud';

export interface Offboarding {
  id: string;
  employeeId: string;
  resignationId: string | null;
  reason: OffboardingReasonCode;
  reasonNote: string | null;
  lastWorkingDate: string;
  status: OffboardingStatusCode;
  /** Frozen when the exit started — still true after a reorganisation. */
  snapshotDepartment: string | null;
  snapshotDesignation: string | null;
  snapshotManagerName: string | null;
  snapshotJoinDate: string;
  startedAt: string;
  completedAt: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  employee: {
    id: string;
    firstName: string;
    lastName: string;
    employeeCode: string;
    avatarUrl: string | null;
    workEmail: string;
    status: string;
    managerId: string | null;
  };
  resignation: {
    id: string;
    reason: string;
    status: string;
    submittedAt: string;
  } | null;
}

export const offboardingKeys = {
  all: () => ['offboardings'] as const,
  list: (params: ListRequest) => ['offboardings', 'list', params] as const,
  detail: (id: string) => ['offboardings', 'detail', id] as const,
};

export const offboardingsApi = {
  list: (params: ListRequest) => api<Paginated<Offboarding>>(`/offboardings${qs(params)}`),
  detail: (id: string) => api<Offboarding>(`/offboardings/${id}`),
  create: (input: OffboardingCreateInput) =>
    api<Offboarding>('/offboardings', { method: 'POST', body: JSON.stringify(input) }),
  update: (id: string, input: OffboardingUpdateInput) =>
    api<Offboarding>(`/offboardings/${id}`, { method: 'PATCH', body: JSON.stringify(input) }),
  complete: (id: string, input: OffboardingCompleteInput) =>
    api<Offboarding>(`/offboardings/${id}/complete`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  cancel: (id: string, input: OffboardingCancelInput) =>
    api<Offboarding>(`/offboardings/${id}/cancel`, { method: 'POST', body: JSON.stringify(input) }),
};
