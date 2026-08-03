import type {
  BankDetailInput,
  EmployeeOnboardInput,
  OnboardingDocumentInput,
  OnboardingProfileInput,
} from '@hrms/shared';
import type { Paginated } from '@hrms/types';
import { api } from '@/lib/api-client';

export type OnboardingStatus = 'IN_PROGRESS' | 'SUBMITTED' | 'APPROVED';

export interface OnboardingEmployee {
  id: string;
  firstName: string;
  lastName: string;
  employeeCode: string;
  workEmail: string;
  personalEmail: string | null;
  joinDate: string;
  status: string;
  dateOfBirth?: string | null;
  gender?: string | null;
  phone?: string | null;
  addressLine?: string | null;
  city?: string | null;
  country?: string | null;
  /** Deferred at invite time, required before approval. */
  departmentId?: string | null;
  designationId?: string | null;
  locationId?: string | null;
  shiftId?: string | null;
  employmentTypeId?: string | null;
  managerId?: string | null;
  bankDetail?: {
    accountHolderName: string;
    bankName: string;
    accountNumber: string;
    ifscCode: string | null;
    branch: string | null;
  } | null;
}

export interface OnboardingRecord {
  id: string;
  status: OnboardingStatus;
  hasPreviousEmployment: boolean | null;
  idProofDocId: string | null;
  bankProofDocId: string | null;
  educationDocId: string | null;
  prevEmploymentDocId: string | null;
  submittedAt: string | null;
  reviewedAt: string | null;
  reviewNote: string | null;
  employee: OnboardingEmployee;
  /** What the server says is still outstanding — the wizard's source of truth. */
  missing?: string[];
}

export interface InviteStatus {
  onboardingId: string;
  onboardingStatus: OnboardingStatus;
  /** Only an account that has never been used may be re-invited. */
  canResend: boolean;
  accepted: boolean;
  personalEmail: string | null;
  lastSentTo: string | null;
  lastSentAt: string | null;
  expiresAt: string | null;
  expired: boolean;
}

export const onboardingApi = {
  mine: () => api<OnboardingRecord>('/me/onboarding'),

  /** Null when the employee is not mid-onboarding. */
  inviteStatus: (employeeId: string) => api<InviteStatus | null>(`/employees/${employeeId}/invite`),

  updateProfile: (input: OnboardingProfileInput) =>
    api<OnboardingRecord>('/me/onboarding/profile', {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),

  setBank: (input: BankDetailInput) =>
    api<unknown>('/me/onboarding/bank', { method: 'PUT', body: JSON.stringify(input) }),

  attach: (input: OnboardingDocumentInput) =>
    api<OnboardingRecord>('/me/onboarding/documents', {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  submit: () => api<OnboardingRecord>('/me/onboarding/submit', { method: 'POST' }),

  // ── HR ──────────────────────────────────────────────────────────────
  onboard: (input: EmployeeOnboardInput) =>
    api<{ employee: { id: string }; inviteSent: boolean; inviteError?: string }>(
      '/employees/onboard',
      { method: 'POST', body: JSON.stringify(input) },
    ),

  resendInvite: (employeeId: string) =>
    api<{ inviteSent: boolean; inviteError?: string }>(`/employees/${employeeId}/invite`, {
      method: 'POST',
    }),

  list: (params: { status?: OnboardingStatus; page: number; limit: number }) => {
    const qs = new URLSearchParams({ page: String(params.page), limit: String(params.limit) });
    if (params.status) qs.set('status', params.status);
    return api<Paginated<OnboardingRecord>>(`/onboarding?${qs}`);
  },

  detail: (id: string) => api<OnboardingRecord>(`/onboarding/${id}`),

  approve: (id: string) => api<OnboardingRecord>(`/onboarding/${id}/approve`, { method: 'POST' }),

  requestChanges: (id: string, note: string) =>
    api<OnboardingRecord>(`/onboarding/${id}/request-changes`, {
      method: 'POST',
      body: JSON.stringify({ note }),
    }),
};

export const onboardingKeys = {
  all: () => ['onboarding'] as const,
  mine: () => ['onboarding', 'mine'] as const,
  list: (status?: string) => ['onboarding', 'list', status ?? 'all'] as const,
  one: (id: string) => ['onboarding', id] as const,
};
