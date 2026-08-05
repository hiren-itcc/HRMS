import type { OrgSettings } from '@hrms/shared';
import { api } from '@/lib/api-client';

/**
 * A figure is null when the caller may not see it, never zero.
 *
 * Zero reads as a fact — "nobody is on probation" — when what is true is "you
 * may not see that", so the dashboard checks for null and simply omits the
 * tile rather than showing a number that is not one.
 */
export interface LifecycleStats {
  today: string;
  /** People who actually work here — leavers and not-yet-started excluded. */
  headcount: number | null;
  onProbation: number | null;
  probationEndingSoon: number | null;
  probationOverdue: number | null;
  pendingResignations: number | null;
  activeNoticePeriods: number | null;
  offboardingInProgress: number | null;
  upcomingLastWorkingDates: {
    id: string;
    name: string;
    employeeCode: string;
    lastWorkingDate: string | null;
  }[];
}

export interface LifecycleStatus {
  today: string;
  lastRunAt: string | null;
  lastRunDate: string | null;
  dueToday: boolean;
  policy: OrgSettings['lifecycle'];
}

export interface LifecycleRunResult {
  ranAt: string;
  today: string;
  confirmed: number;
  exited: number;
  failures: { id: string; reason: string }[];
}

export const lifecycleKeys = {
  all: () => ['lifecycle'] as const,
  stats: () => ['lifecycle', 'stats'] as const,
  status: () => ['lifecycle', 'status'] as const,
};

export const lifecycleApi = {
  stats: () => api<LifecycleStats>('/lifecycle/stats'),
  status: () => api<LifecycleStatus>('/lifecycle/status'),
  run: () => api<LifecycleRunResult>('/lifecycle/run', { method: 'POST' }),
};
