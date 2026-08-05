import type {
  ClearanceKindCode,
  ClearanceOwnerCode,
  ExitInterviewInput,
  OffboardingCancelInput,
  OffboardingCompleteInput,
  OffboardingCreateInput,
  OffboardingReasonCode,
  OffboardingStatusCode,
  OffboardingTaskStatusCode,
  OffboardingTaskUpdateInput,
  OffboardingUpdateInput,
} from '@hrms/shared';
import type { Paginated } from '@hrms/types';
import type { ActivityEntry } from '@/features/resignations/types';
import { api } from '@/lib/api-client';
import { type ListRequest, qs } from '@/lib/crud';

export interface OffboardingTask {
  id: string;
  label: string;
  description: string | null;
  owner: ClearanceOwnerCode;
  /** MANUAL is hand-signed; ASSET_RETURN reads the register. */
  kind: ClearanceKindCode;
  /** Completion is blocked while any required item is still PENDING. */
  required: boolean;
  order: number;
  status: OffboardingTaskStatusCode;
  note: string | null;
  doneAt: string | null;
  doneById: string | null;
}

export interface ExitInterview {
  id: string;
  conductedOn: string | null;
  conductedById: string | null;
  /** The question text is frozen beside each answer. */
  responses: { key: string; question: string; answer: string }[];
  notes: string | null;
  wouldRecommend: boolean | null;
  rehireEligible: boolean | null;
  updatedAt: string;
}

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
  tasks: OffboardingTask[];
}

export const offboardingKeys = {
  all: () => ['offboardings'] as const,
  list: (params: ListRequest) => ['offboardings', 'list', params] as const,
  detail: (id: string) => ['offboardings', 'detail', id] as const,
  interview: (id: string) => ['offboardings', 'detail', id, 'interview'] as const,
  activity: (id: string) => ['offboardings', 'detail', id, 'activity'] as const,
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

  updateTask: (taskId: string, input: OffboardingTaskUpdateInput) =>
    api<OffboardingTask>(`/offboardings/tasks/${taskId}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),

  activity: (id: string) => api<ActivityEntry[]>(`/offboardings/${id}/activity`),
  interview: (id: string) => api<ExitInterview | null>(`/offboardings/${id}/interview`),
  saveInterview: (id: string, input: ExitInterviewInput) =>
    api<ExitInterview>(`/offboardings/${id}/interview`, {
      method: 'PUT',
      body: JSON.stringify(input),
    }),
};
