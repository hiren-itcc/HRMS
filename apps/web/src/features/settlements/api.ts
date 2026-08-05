import type {
  SettlementApproveInput,
  SettlementCancelInput,
  SettlementCreateInput,
  SettlementLineCreateInput,
  SettlementLineKindCode,
  SettlementLineSourceCode,
  SettlementLineUpdateInput,
  SettlementPayInput,
  SettlementStatusCode,
} from '@hrms/shared';
import type { Paginated } from '@hrms/types';
import type { ActivityEntry } from '@/features/resignations/types';
import { api } from '@/lib/api-client';
import { type ListRequest, qs } from '@/lib/crud';

export interface SettlementLine {
  id: string;
  kind: SettlementLineKindCode;
  source: SettlementLineSourceCode;
  label: string;
  /** How the figure was reached — "12.5 days × ₹2,400". */
  basis: string | null;
  amount: number;
  order: number;
  /** HR changed the computed figure. Printed, so the statement says so. */
  overridden: boolean;
}

export interface Settlement {
  id: string;
  offboardingId: string;
  employeeId: string;
  status: SettlementStatusCode;
  /** Frozen when computed — a later salary revision does not rewrite these. */
  lastWorkingDate: string;
  joinDate: string;
  monthlyPay: number;
  perDayRate: number;
  totalEarnings: number;
  totalDeductions: number;
  /** Can be negative: notice recovery may exceed what somebody is owed. */
  netPayable: number;
  notes: string | null;
  computedAt: string | null;
  approvedAt: string | null;
  paidAt: string | null;
  paymentRef: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  employee: {
    id: string;
    firstName: string;
    lastName: string;
    employeeCode: string;
    avatarUrl: string | null;
    workEmail: string;
  };
  offboarding: { id: string; reason: string; status: string };
  lines: SettlementLine[];
}

export const settlementKeys = {
  all: () => ['settlements'] as const,
  list: (params: ListRequest) => ['settlements', 'list', params] as const,
  detail: (id: string) => ['settlements', 'detail', id] as const,
  activity: (id: string) => ['settlements', 'detail', id, 'activity'] as const,
  forOffboarding: (offboardingId: string) =>
    ['settlements', 'for-offboarding', offboardingId] as const,
};

export const settlementsApi = {
  list: (params: ListRequest) => api<Paginated<Settlement>>(`/payroll/settlements${qs(params)}`),
  detail: (id: string) => api<Settlement>(`/payroll/settlements/${id}`),
  activity: (id: string) => api<ActivityEntry[]>(`/payroll/settlements/${id}/activity`),
  /** Null rather than a 404 when the exit has no settlement yet. */
  forOffboarding: (offboardingId: string) =>
    api<Settlement | null>(`/payroll/settlements/for-offboarding/${offboardingId}`),

  create: (input: SettlementCreateInput) =>
    api<Settlement>('/payroll/settlements', { method: 'POST', body: JSON.stringify(input) }),
  recompute: (id: string) =>
    api<Settlement>(`/payroll/settlements/${id}/recompute`, { method: 'POST' }),

  addLine: (id: string, input: SettlementLineCreateInput) =>
    api<Settlement>(`/payroll/settlements/${id}/lines`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  updateLine: (id: string, lineId: string, input: SettlementLineUpdateInput) =>
    api<Settlement>(`/payroll/settlements/${id}/lines/${lineId}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),
  removeLine: (id: string, lineId: string) =>
    api<Settlement>(`/payroll/settlements/${id}/lines/${lineId}`, { method: 'DELETE' }),

  approve: (id: string, input: SettlementApproveInput) =>
    api<Settlement>(`/payroll/settlements/${id}/approve`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  pay: (id: string, input: SettlementPayInput) =>
    api<Settlement>(`/payroll/settlements/${id}/pay`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  cancel: (id: string, input: SettlementCancelInput) =>
    api<Settlement>(`/payroll/settlements/${id}/cancel`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
};
