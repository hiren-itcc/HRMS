import type {
  ResignationCreateInput,
  ResignationDecisionInput,
  ResignationWithdrawInput,
} from '@hrms/shared';
import type { Paginated } from '@hrms/types';
import { api } from '@/lib/api-client';
import { type ListRequest, qs } from '@/lib/crud';
import type { ActivityEntry, Resignation, ResignationEligibility } from './types';

/**
 * Key factory, following `payrollKeys`.
 *
 * Every key starts with `'resignations'`, so a single
 * `invalidate: [resignationKeys.all()]` after any write reaches the list, the
 * detail, the inbox and the employee's own view — the thing a hand-written
 * `['resignation', id]` would have quietly fallen outside of.
 */
export const resignationKeys = {
  all: () => ['resignations'] as const,
  list: (params: ListRequest) => ['resignations', 'list', params] as const,
  mine: () => ['resignations', 'mine'] as const,
  eligibility: () => ['resignations', 'eligibility'] as const,
  detail: (id: string) => ['resignations', 'detail', id] as const,
  activity: (id: string) => ['resignations', 'detail', id, 'activity'] as const,
};

export const resignationsApi = {
  list: (params: ListRequest) => api<Paginated<Resignation>>(`/resignations${qs(params)}`),
  mine: () => api<Resignation[]>('/resignations/me'),
  eligibility: () => api<ResignationEligibility>('/resignations/me/eligibility'),
  detail: (id: string) => api<Resignation>(`/resignations/${id}`),
  activity: (id: string) => api<ActivityEntry[]>(`/resignations/${id}/activity`),

  submit: (input: ResignationCreateInput) =>
    api<Resignation>('/resignations', { method: 'POST', body: JSON.stringify(input) }),
  update: (id: string, input: ResignationCreateInput) =>
    api<Resignation>(`/resignations/${id}`, { method: 'PATCH', body: JSON.stringify(input) }),
  withdraw: (id: string, input: ResignationWithdrawInput) =>
    api<Resignation>(`/resignations/${id}/withdraw`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  decide: (id: string, input: ResignationDecisionInput) =>
    api<Resignation>(`/resignations/${id}/decision`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
};
