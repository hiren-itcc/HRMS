import type {
  ProjectCreateInput,
  ProjectMemberCreateInput,
  ProjectMemberUpdateInput,
  ProjectStatusCode,
  ProjectUpdateInput,
  TimesheetDecisionInput,
  TimesheetStatusCode,
  TimesheetWeekInput,
} from '@hrms/shared';
import type { Paginated } from '@hrms/types';
import { api } from '@/lib/api-client';
import { type ListRequest, qs } from '@/lib/crud';

/**
 * Projects, and the week logged against them.
 *
 * Every `hours` here is `number`, and that is only true because
 * `projects.mapper.ts` converts on the way out — Prisma's `Decimal` serializes
 * to JSON as a string, and a grid summing strings shows `NaN` with no stack
 * trace to find it by.
 *
 * The paths do not mirror the screens. Timesheets live at `/timesheets` because
 * a week spans projects and must not be nested under one; the UI still puts
 * them behind the Projects nav entry.
 */

export interface Person {
  id: string;
  firstName: string;
  lastName: string;
  employeeCode: string;
}

export interface ProjectMember {
  id: string;
  projectId: string;
  employeeId: string;
  employee?: Person;
  role: string | null;
  /** Percent of one person's time. Planning data, never compared to hours. */
  allocation: number;
  joinedOn: string;
  leftOn: string | null;
}

export interface Project {
  id: string;
  code: string;
  name: string;
  description: string | null;
  status: ProjectStatusCode;
  startsOn: string;
  endsOn: string | null;
  managerId: string;
  manager?: Person;
  members?: ProjectMember[];
  memberCount?: number;
  /** Timesheet entries logged against it — what blocks a delete. */
  entryCount?: number;
  createdAt: string;
  updatedAt: string;
}

export interface TimesheetEntry {
  id: string;
  projectId: string;
  project?: { id: string; code: string; name: string; status: ProjectStatusCode };
  workedOn: string;
  hours: number;
  note: string | null;
}

export interface Timesheet {
  id: string;
  employeeId: string;
  employee?: Person;
  weekStart: string;
  status: TimesheetStatusCode;
  /** Derived from the entries on every read, never stored. */
  total: number;
  entryCount: number;
  entries: TimesheetEntry[];
  submittedAt: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
  createdAt: string;
}

/** A project the signed-in person may log against, with their membership window. */
export interface LoggableProject {
  id: string;
  code: string;
  name: string;
  status: ProjectStatusCode;
  startsOn: string;
  endsOn: string | null;
  joinedOn: string;
  leftOn: string | null;
}

export interface TimesheetWeek {
  weekStart: string;
  days: string[];
  /** Null until somebody actually types an hour — opening a week writes nothing. */
  timesheet: Timesheet | null;
  projects: LoggableProject[];
}

export interface UtilisationCell {
  employeeId: string;
  employee: Person;
  projectId: string;
  projectCode: string;
  projectName: string;
  hours: number;
}

export interface UtilisationReport {
  from: string;
  to: string;
  days: number;
  capacityHours: number;
  totalHours: number;
  rows: UtilisationCell[];
  byEmployee: { employeeId: string; employee: Person; hours: number; utilisation: number }[];
  byProject: { projectId: string; code: string; name: string; hours: number }[];
}

export interface ProjectListRequest extends ListRequest {
  status?: ProjectStatusCode;
  scope?: 'own' | 'all';
}

export interface TimesheetListRequest extends ListRequest {
  status?: TimesheetStatusCode;
  employeeId?: string;
  from?: string;
  to?: string;
  scope?: 'own' | 'team' | 'all';
}

export const projectKeys = {
  all: () => ['projects'] as const,
  list: (params: ProjectListRequest) => ['projects', 'list', params] as const,
  one: (id: string) => ['projects', id] as const,
  utilisation: (from: string, to: string, projectId?: string) =>
    ['projects', 'utilisation', from, to, projectId ?? null] as const,
};

export const timesheetKeys = {
  all: () => ['timesheets'] as const,
  list: (params: TimesheetListRequest) => ['timesheets', 'list', params] as const,
  one: (id: string) => ['timesheets', id] as const,
  week: (weekStart: string) => ['timesheets', 'week', weekStart] as const,
};

export const projectsApi = {
  list: (params: ProjectListRequest) => api<Paginated<Project>>(`/projects${qs(params)}`),
  get: (id: string) => api<Project>(`/projects/${id}`),
  create: (input: ProjectCreateInput) =>
    api<Project>('/projects', { method: 'POST', body: JSON.stringify(input) }),
  update: (id: string, input: ProjectUpdateInput) =>
    api<Project>(`/projects/${id}`, { method: 'PATCH', body: JSON.stringify(input) }),
  remove: (id: string) => api<{ id: string }>(`/projects/${id}`, { method: 'DELETE' }),

  addMember: (projectId: string, input: ProjectMemberCreateInput) =>
    api<ProjectMember>(`/projects/${projectId}/members`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  updateMember: (memberId: string, input: ProjectMemberUpdateInput) =>
    api<ProjectMember>(`/projects/members/${memberId}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),
  removeMember: (memberId: string) =>
    api<{ id: string }>(`/projects/members/${memberId}`, { method: 'DELETE' }),

  utilisation: (from: string, to: string, projectId?: string) =>
    api<UtilisationReport>(
      `/projects/reports/utilisation${qs({ from, to, ...(projectId ? { projectId } : {}) })}`,
    ),
};

export const timesheetsApi = {
  list: (params: TimesheetListRequest) => api<Paginated<Timesheet>>(`/timesheets${qs(params)}`),
  get: (id: string) => api<Timesheet>(`/timesheets/${id}`),
  week: (weekStart: string) => api<TimesheetWeek>(`/timesheets/week${qs({ weekStart })}`),
  saveWeek: (input: TimesheetWeekInput) =>
    api<Timesheet>('/timesheets/week', { method: 'PUT', body: JSON.stringify(input) }),
  submit: (id: string) => api<Timesheet>(`/timesheets/${id}/submit`, { method: 'POST' }),
  withdraw: (id: string) => api<Timesheet>(`/timesheets/${id}/withdraw`, { method: 'POST' }),
  approve: (id: string, input: TimesheetDecisionInput) =>
    api<Timesheet>(`/timesheets/${id}/approve`, { method: 'POST', body: JSON.stringify(input) }),
  reject: (id: string, input: TimesheetDecisionInput) =>
    api<Timesheet>(`/timesheets/${id}/reject`, { method: 'POST', body: JSON.stringify(input) }),
};
