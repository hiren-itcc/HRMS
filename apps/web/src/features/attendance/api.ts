import type { ApprovalDecisionInput, AttendanceRequestCreateInput } from '@hrms/shared';
import type { Paginated } from '@hrms/types';
import { api } from '@/lib/api-client';

export type DerivedStatus =
  | 'PRESENT'
  | 'ABSENT'
  | 'HALF_DAY'
  | 'ON_LEAVE'
  | 'HOLIDAY'
  | 'WEEK_OFF'
  | 'WFH'
  | 'NOT_MARKED'
  | 'NOT_EMPLOYED'
  | 'FUTURE';

export interface DayEntry {
  date: string;
  status: DerivedStatus;
  checkIn: string | null;
  checkOut: string | null;
  workMinutes: number | null;
  isLate: boolean;
  note: string | null;
}

export interface TodayState extends DayEntry {
  timeZone: string;
  shift: { startTime: string; endTime: string; graceMinutes: number } | null;
  serverTime: string;
}

export interface MonthSummary {
  present: number;
  absent: number;
  halfDay: number;
  onLeave: number;
  holidays: number;
  weekOffs: number;
  lateMarks: number;
  workedMinutes: number;
}

export interface MonthResponse {
  month: string;
  timeZone: string;
  days: DayEntry[];
  summary: MonthSummary;
}

export interface EmployeeRef {
  id: string;
  firstName: string;
  lastName: string;
  employeeCode: string;
  avatarUrl?: string | null;
  department: string | null;
}

export interface DayViewRow extends DayEntry {
  employee: EmployeeRef;
}

export interface SummaryRow extends MonthSummary {
  employee: EmployeeRef;
}

export interface AttendanceStats {
  date: string;
  headcount: number;
  present: number;
  halfDay: number;
  late: number;
  stillIn: number;
  notMarked: number;
  pendingRequests: number;
}

export interface AttendanceRequestRow {
  id: string;
  date: string;
  requestedIn: string | null;
  requestedOut: string | null;
  reason: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';
  approverNote: string | null;
  actedAt: string | null;
  createdAt: string;
  employee: { id: string; firstName: string; lastName: string; employeeCode: string };
}

function qs(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') search.set(key, String(value));
  }
  const s = search.toString();
  return s ? `?${s}` : '';
}

export const attendanceApi = {
  today: () => api<TodayState>('/attendance/today'),
  checkIn: () => api<DayEntry>('/attendance/check-in', { method: 'POST' }),
  checkOut: () => api<DayEntry>('/attendance/check-out', { method: 'POST' }),

  myMonth: (month: string) => api<MonthResponse>(`/attendance/me${qs({ month })}`),
  employeeMonth: (employeeId: string, month: string) =>
    api<MonthResponse>(`/attendance/employees/${employeeId}${qs({ month })}`),

  dayView: (params: Record<string, string | number | undefined>) =>
    api<Paginated<DayViewRow> & { date: string }>(`/attendance${qs(params)}`),
  summary: (params: Record<string, string | number | undefined>) =>
    api<Paginated<SummaryRow> & { month: string }>(`/attendance/summary${qs(params)}`),
  stats: () => api<AttendanceStats>('/attendance/stats'),

  requests: (params: Record<string, string | number | undefined>) =>
    api<Paginated<AttendanceRequestRow>>(`/attendance/requests${qs(params)}`),
  createRequest: (input: AttendanceRequestCreateInput) =>
    api<AttendanceRequestRow>('/attendance/requests', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  approve: (id: string, input: ApprovalDecisionInput) =>
    api<AttendanceRequestRow>(`/attendance/requests/${id}/approve`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  reject: (id: string, input: ApprovalDecisionInput) =>
    api<AttendanceRequestRow>(`/attendance/requests/${id}/reject`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  cancelRequest: (id: string) => api<void>(`/attendance/requests/${id}/cancel`, { method: 'POST' }),
};

/** "7h 45m" from minutes. */
export function formatDuration(minutes: number | null | undefined): string {
  if (!minutes || minutes <= 0) return '—';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h ? `${h}h ${m}m` : `${m}m`;
}

/** Wall-clock HH:MM of an ISO instant, rendered in the given timezone. */
export function timeIn(iso: string | null, timeZone?: string): string {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(iso));
}

export function currentMonth(): string {
  return new Date().toISOString().slice(0, 7);
}

export function shiftMonth(month: string, delta: number): string {
  const [y = '2026', m = '01'] = month.split('-');
  const d = new Date(Date.UTC(Number(y), Number(m) - 1 + delta, 1));
  return d.toISOString().slice(0, 7);
}
