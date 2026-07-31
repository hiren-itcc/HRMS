import type {
  LeaveApplyInput,
  LeaveBalanceAdjustInput,
  LeaveDecisionInput,
  LeaveTypeCreateInput,
  LeaveTypeUpdateInput,
} from '@hrms/shared';
import type { Paginated } from '@hrms/types';
import { api } from '@/lib/api-client';

export interface LeaveType {
  id: string;
  name: string;
  code: string;
  daysPerYear: number;
  isPaid: boolean;
  carryForward: boolean;
  maxCarryForward: number | null;
  requiresApproval: boolean;
  _count?: { requests: number };
}

export interface LeaveBalance {
  id: string;
  year: number;
  leaveTypeId: string;
  leaveType?: { id: string; name: string; code: string; isPaid: boolean };
  employee?: { id: string; firstName: string; lastName: string; employeeCode: string };
  allocated: number;
  carriedOver: number;
  used: number;
  available: number;
}

export interface LeaveRequest {
  id: string;
  startDate: string;
  endDate: string;
  halfDaySide: 'FIRST_HALF' | 'SECOND_HALF' | null;
  days: number;
  reason: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';
  approverNote: string | null;
  actedAt: string | null;
  createdAt: string;
  leaveType?: { id: string; name: string; code: string };
  employee?: {
    id: string;
    firstName: string;
    lastName: string;
    employeeCode: string;
    managerId?: string | null;
  };
}

export interface LeavePreview {
  days: number;
  workingDays: number;
  skipped: string[];
}

type Params = Record<string, string | number | undefined>;

function qs(params: Params): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') search.set(key, String(value));
  }
  const s = search.toString();
  return s ? `?${s}` : '';
}

export const leaveApi = {
  types: (params: Params = {}) => api<Paginated<LeaveType>>(`/leave/types${qs(params)}`),
  typeOptions: () => api<LeaveType[]>('/leave/types/options'),
  createType: (input: LeaveTypeCreateInput) =>
    api<LeaveType>('/leave/types', { method: 'POST', body: JSON.stringify(input) }),
  updateType: (id: string, input: LeaveTypeUpdateInput) =>
    api<LeaveType>(`/leave/types/${id}`, { method: 'PATCH', body: JSON.stringify(input) }),
  removeType: (id: string) => api<void>(`/leave/types/${id}`, { method: 'DELETE' }),

  myBalances: (year?: number) =>
    api<{ year: number; balances: LeaveBalance[] }>(`/leave/balances/me${qs({ year })}`),
  balances: (params: Params) =>
    api<Paginated<LeaveBalance> & { year: number }>(`/leave/balances${qs(params)}`),
  adjustBalance: (input: LeaveBalanceAdjustInput) =>
    api<LeaveBalance>('/leave/balances/adjust', { method: 'POST', body: JSON.stringify(input) }),

  preview: (params: Params) => api<LeavePreview>(`/leave/requests/preview${qs(params)}`),
  apply: (input: LeaveApplyInput) =>
    api<LeaveRequest>('/leave/requests', { method: 'POST', body: JSON.stringify(input) }),
  requests: (params: Params) => api<Paginated<LeaveRequest>>(`/leave/requests${qs(params)}`),
  calendar: (month: string) =>
    api<{ month: string; requests: LeaveRequest[] }>(`/leave/calendar${qs({ month })}`),
  approve: (id: string, input: LeaveDecisionInput) =>
    api<LeaveRequest>(`/leave/requests/${id}/approve`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  reject: (id: string, input: LeaveDecisionInput) =>
    api<LeaveRequest>(`/leave/requests/${id}/reject`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  cancel: (id: string) => api<void>(`/leave/requests/${id}/cancel`, { method: 'POST' }),
};

const rangeFmt = new Intl.DateTimeFormat(undefined, {
  day: 'numeric',
  month: 'short',
  timeZone: 'UTC',
});

/** "3–5 Aug" or "5 Aug" for a single day. */
export function formatRange(startDate: string, endDate: string): string {
  const start = rangeFmt.format(new Date(`${startDate}T00:00:00.000Z`));
  if (startDate === endDate) return start;
  return `${start} – ${rangeFmt.format(new Date(`${endDate}T00:00:00.000Z`))}`;
}

export function formatDays(days: number): string {
  return `${days} ${days === 1 ? 'day' : 'days'}`;
}
