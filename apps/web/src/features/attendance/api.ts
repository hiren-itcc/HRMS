import type {
  ApprovalDecisionInput,
  AttendanceRequestCreateInput,
  ClockInInput,
  ClockOutInput,
} from '@hrms/shared';
import type { Paginated } from '@hrms/types';
import { api } from '@/lib/api-client';
import { qs } from '@/lib/crud';

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

export type WorkMode = 'OFFICE' | 'REMOTE' | 'CLIENT_SITE';
export type LocationVerification = 'VERIFIED' | 'OUTSIDE' | 'UNVERIFIED' | 'NOT_APPLICABLE';

export const WORK_MODE_LABEL: Record<WorkMode, string> = {
  OFFICE: 'Office',
  REMOTE: 'Remote',
  CLIENT_SITE: 'Client site',
};

/** One clock-in/clock-out pair; `checkOut` is null while the person is in. */
export interface DaySession {
  id: string;
  checkIn: string;
  checkOut: string | null;
  workMode: WorkMode;
  verification: LocationVerification;
  distanceMeters: number | null;
  officeName: string | null;
}

export interface DayEntry {
  date: string;
  status: DerivedStatus;
  /** First session's clock-in. */
  checkIn: string | null;
  /** Last session's clock-out — null while any session is still open. */
  checkOut: string | null;
  /** Summed across closed sessions; the running one counts when it ends. */
  workMinutes: number | null;
  isLate: boolean;
  note: string | null;
  /** The day rolled up: all one way, or OFFICE when the sittings were mixed. */
  workMode: WorkMode | null;
  /**
   * Whether a remote day was agreed in advance. Null when the question does
   * not arise — an office day has nothing to approve, so false there would
   * read as a refusal rather than as "not applicable".
   */
  remoteApproved: boolean | null;
  sessions: DaySession[];
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

export const attendanceApi = {
  today: () => api<TodayState>('/attendance/today'),
  checkIn: (input: ClockInInput) =>
    api<DayEntry>('/attendance/check-in', { method: 'POST', body: JSON.stringify(input) }),
  checkOut: (input: ClockOutInput = {}) =>
    api<DayEntry>('/attendance/check-out', { method: 'POST', body: JSON.stringify(input) }),

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

export type PositionResult =
  | { status: 'ok'; latitude: number; longitude: number; accuracyMeters: number }
  /** The browser will not even ask: no HTTPS, or no geolocation at all. */
  | { status: 'unavailable' }
  /** It asked and came back empty: refused, timed out, or no signal. */
  | { status: 'refused' };

/**
 * Asks the browser where we are, and reports *why* when it cannot say.
 *
 * That distinction is the whole point. A refusal is something the person can
 * undo, so the caller turns it into an error and the punch does not happen. A
 * page served over plain HTTP, or a browser with no geolocation, is not — so
 * those go through, recorded as unverified, rather than stopping somebody
 * working over a deployment detail they have no control of.
 */
export function getPosition(): Promise<PositionResult> {
  if (typeof window === 'undefined' || !window.isSecureContext || !navigator.geolocation) {
    return Promise.resolve({ status: 'unavailable' });
  }
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (position) =>
        resolve({
          status: 'ok',
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracyMeters: position.coords.accuracy,
        }),
      () => resolve({ status: 'refused' }),
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 60_000 },
    );
  });
}

/** The position part of a punch body, or the reason there is not one. */
export function punchBody(result: PositionResult): ClockInInput {
  if (result.status === 'ok') {
    const { status: _status, ...fix } = result;
    return fix;
  }
  return { locationUnavailable: true };
}

/** "2.4 km away" / "180 m away" — distance a person can act on. */
export function formatDistance(meters: number | null): string {
  if (meters === null) return '';
  return meters >= 1000 ? `${(meters / 1000).toFixed(1)} km away` : `${Math.round(meters)} m away`;
}

/** Minutes worked in one session; null while it is still running. */
export function sessionMinutes(session: DaySession): number | null {
  if (!session.checkOut) return null;
  return Math.max(
    0,
    Math.round(
      (new Date(session.checkOut).getTime() - new Date(session.checkIn).getTime()) / 60_000,
    ),
  );
}

/** The session currently running, if any — at most one can be open. */
export function openSessionOf(entry: Pick<DayEntry, 'sessions'>): DaySession | null {
  return entry.sessions.find((s) => !s.checkOut) ?? null;
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

/** Today's YYYY-MM-DD in the given timezone — mirrors the server's day key. */
export function todayKeyIn(timeZone: string): string {
  // en-CA formats as YYYY-MM-DD
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

export function shiftMonth(month: string, delta: number): string {
  const [y = '2026', m = '01'] = month.split('-');
  const d = new Date(Date.UTC(Number(y), Number(m) - 1 + delta, 1));
  return d.toISOString().slice(0, 7);
}
