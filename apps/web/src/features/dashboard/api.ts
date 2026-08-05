import { api } from '@/lib/api-client';

export interface Celebrant {
  id: string;
  name: string;
  avatarUrl: string | null;
  /** `"MM-DD"`. The API never sends a birth year — see the celebrations panel. */
  monthDay: string;
  /** Days from today, already ordered by the API. */
  inDays: number;
}

export interface DashboardSummary {
  today: string;
  /** Null throughout means "you may not see this", never "none". */
  headcount: number | null;
  onProbation: number | null;
  probationOverdue: number | null;
  exits: {
    leaving: number;
    pendingResignations: number;
    offboardingInProgress: number;
  } | null;
  approvals: {
    total: number;
    leave: number;
    attendance: number;
    remoteWork: number;
  } | null;
  payroll: {
    total: number;
    runsNeedingAction: number;
    settlementsToApprove: number;
    settlementsToPay: number;
  } | null;
  upcomingLastWorkingDates: {
    id: string;
    name: string;
    employeeCode: string;
    lastWorkingDate: string | null;
  }[];
  celebrations: {
    birthdays: Celebrant[];
    anniversaries: (Celebrant & { years: number })[];
  };
}

export const dashboardKeys = {
  summary: () => ['dashboard', 'summary'] as const,
};

export const dashboardApi = {
  summary: () => api<DashboardSummary>('/dashboard/summary'),
};
