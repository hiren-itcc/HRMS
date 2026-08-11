import type {
  CycleCloseInput,
  GoalCreateInput,
  GoalStatusCode,
  GoalUpdateInput,
  ReviewAcknowledgeInput,
  ReviewCycleCreateInput,
  ReviewManagerInput,
  ReviewNoteInput,
  ReviewReassignInput,
  ReviewSelfInput,
  ReviewStatusCode,
} from '@hrms/shared';
import type { Paginated } from '@hrms/types';
import { api } from '@/lib/api-client';
import { type ListRequest, qs } from '@/lib/crud';
import type { Goal, Review, ReviewCycle } from './types';

export interface CycleListRequest extends ListRequest {
  status?: ReviewCycle['status'];
}

export interface GoalListRequest extends ListRequest {
  cycleId?: string;
  employeeId?: string;
  status?: GoalStatusCode;
  scope?: 'own' | 'team' | 'all';
}

export interface ReviewListRequest extends ListRequest {
  cycleId?: string;
  employeeId?: string;
  status?: ReviewStatusCode;
  scope?: 'own' | 'team' | 'all';
  awaitingMe?: 'true' | 'false';
}

/**
 * Every key starts `['performance']`, so one
 * `invalidate: [performanceKeys.all()]` after any write reaches the cycle list,
 * the team inbox, the review being read and the employee's own page — which is
 * what you want, because most writes here move a review between two of them.
 */
export const performanceKeys = {
  all: () => ['performance'] as const,
  cycles: (params: CycleListRequest) => ['performance', 'cycles', 'list', params] as const,
  cycle: (id: string) => ['performance', 'cycles', id] as const,
  activeCycle: () => ['performance', 'cycles', 'active'] as const,
  goals: (params: GoalListRequest) => ['performance', 'goals', 'list', params] as const,
  reviews: (params: ReviewListRequest) => ['performance', 'reviews', 'list', params] as const,
  review: (id: string) => ['performance', 'reviews', id] as const,
};

export const performanceApi = {
  // Cycles
  listCycles: (params: CycleListRequest) =>
    api<Paginated<ReviewCycle>>(`/performance/cycles${qs(params)}`),
  activeCycle: () => api<ReviewCycle | null>('/performance/cycles/active'),
  getCycle: (id: string) => api<ReviewCycle>(`/performance/cycles/${id}`),
  createCycle: (input: ReviewCycleCreateInput) =>
    api<ReviewCycle>('/performance/cycles', { method: 'POST', body: JSON.stringify(input) }),
  updateCycle: (id: string, input: ReviewCycleCreateInput) =>
    api<ReviewCycle>(`/performance/cycles/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),
  openCycle: (id: string) => api<ReviewCycle>(`/performance/cycles/${id}/open`, { method: 'POST' }),
  closeCycle: (id: string, input: CycleCloseInput) =>
    api<ReviewCycle>(`/performance/cycles/${id}/close`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  removeCycle: (id: string) =>
    api<{ id: string }>(`/performance/cycles/${id}`, { method: 'DELETE' }),

  // Goals
  listGoals: (params: GoalListRequest) => api<Paginated<Goal>>(`/performance/goals${qs(params)}`),
  createGoal: (input: GoalCreateInput) =>
    api<Goal>('/performance/goals', { method: 'POST', body: JSON.stringify(input) }),
  updateGoal: (id: string, input: GoalUpdateInput) =>
    api<Goal>(`/performance/goals/${id}`, { method: 'PATCH', body: JSON.stringify(input) }),
  removeGoal: (id: string) => api<{ id: string }>(`/performance/goals/${id}`, { method: 'DELETE' }),

  // Reviews
  listReviews: (params: ReviewListRequest) =>
    api<Paginated<Review>>(`/performance/reviews${qs(params)}`),
  getReview: (id: string) => api<Review>(`/performance/reviews/${id}`),
  saveSelf: (id: string, input: ReviewSelfInput) =>
    api<Review>(`/performance/reviews/${id}/self`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),
  submitSelf: (id: string, input: ReviewSelfInput) =>
    api<Review>(`/performance/reviews/${id}/self/submit`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  saveManager: (id: string, input: ReviewManagerInput) =>
    api<Review>(`/performance/reviews/${id}/manager`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),
  share: (id: string, input: ReviewManagerInput) =>
    api<Review>(`/performance/reviews/${id}/share`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  acknowledge: (id: string, input: ReviewAcknowledgeInput) =>
    api<Review>(`/performance/reviews/${id}/acknowledge`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  reopen: (id: string, input: ReviewNoteInput) =>
    api<Review>(`/performance/reviews/${id}/reopen`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  cancel: (id: string, input: ReviewNoteInput) =>
    api<Review>(`/performance/reviews/${id}/cancel`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  reassign: (id: string, input: ReviewReassignInput) =>
    api<Review>(`/performance/reviews/${id}/reassign`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
};

/** Weights as a percentage, without a trailing `.00` nobody needs. */
export function formatWeight(weight: number): string {
  return `${weight}%`;
}

/** An unrated review says so, rather than rendering `null / 5` or `NaN`. */
export function formatRating(rating: number | null | undefined): string {
  return rating == null ? '—' : `${rating} / 5`;
}
