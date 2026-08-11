import type {
  TicketAssignInput,
  TicketCancelInput,
  TicketCategoryCreateInput,
  TicketCategoryUpdateInput,
  TicketCommentCreateInput,
  TicketCreateInput,
  TicketPriorityCode,
  TicketResolveInput,
  TicketScope,
  TicketStatusCode,
  TicketWaitInput,
} from '@hrms/shared';
import type { Paginated } from '@hrms/types';
import { api } from '@/lib/api-client';
import { type ListRequest, qs } from '@/lib/crud';
import type { Ticket, TicketCategory, TicketSummary } from './types';

export interface TicketListRequest extends ListRequest {
  scope?: TicketScope;
  status?: TicketStatusCode;
  priority?: TicketPriorityCode;
  categoryId?: string;
  assigneeId?: string;
  search?: string;
}

/**
 * Every key starts `['helpdesk']`, so one `invalidate: [helpdeskKeys.all()]`
 * after any write reaches the list, the queue, the ticket being read and the
 * tab counts together. That is what you want here rather than surgical
 * invalidation: almost every action on a ticket moves it between two of those
 * views at once, and the counts are wrong the moment one of them changes.
 */
export const helpdeskKeys = {
  all: () => ['helpdesk'] as const,
  tickets: (params: TicketListRequest) => ['helpdesk', 'tickets', 'list', params] as const,
  ticket: (id: string) => ['helpdesk', 'tickets', id] as const,
  summary: () => ['helpdesk', 'summary'] as const,
  categories: (activeOnly?: boolean) => ['helpdesk', 'categories', activeOnly ?? null] as const,
};

export const helpdeskApi = {
  list: (params: TicketListRequest) => api<Paginated<Ticket>>(`/helpdesk/tickets${qs(params)}`),
  get: (id: string) => api<Ticket>(`/helpdesk/tickets/${id}`),
  summary: () => api<TicketSummary>('/helpdesk/summary'),

  create: (input: TicketCreateInput) =>
    api<Ticket>('/helpdesk/tickets', { method: 'POST', body: JSON.stringify(input) }),

  comment: (id: string, input: TicketCommentCreateInput) =>
    api<Ticket>(`/helpdesk/tickets/${id}/comments`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  assign: (id: string, input: TicketAssignInput) =>
    api<Ticket>(`/helpdesk/tickets/${id}/assign`, { method: 'POST', body: JSON.stringify(input) }),
  start: (id: string) => api<Ticket>(`/helpdesk/tickets/${id}/start`, { method: 'POST' }),
  wait: (id: string, input: TicketWaitInput) =>
    api<Ticket>(`/helpdesk/tickets/${id}/wait`, { method: 'POST', body: JSON.stringify(input) }),
  resolve: (id: string, input: TicketResolveInput) =>
    api<Ticket>(`/helpdesk/tickets/${id}/resolve`, { method: 'POST', body: JSON.stringify(input) }),
  reopen: (id: string) => api<Ticket>(`/helpdesk/tickets/${id}/reopen`, { method: 'POST' }),
  close: (id: string) => api<Ticket>(`/helpdesk/tickets/${id}/close`, { method: 'POST' }),
  cancel: (id: string, input: TicketCancelInput) =>
    api<Ticket>(`/helpdesk/tickets/${id}/cancel`, { method: 'POST', body: JSON.stringify(input) }),
  setPriority: (id: string, priority: TicketPriorityCode) =>
    api<Ticket>(`/helpdesk/tickets/${id}/priority`, {
      method: 'PATCH',
      body: JSON.stringify({ priority }),
    }),
  recategorise: (id: string, categoryId: string) =>
    api<Ticket>(`/helpdesk/tickets/${id}/category`, {
      method: 'PATCH',
      body: JSON.stringify({ categoryId }),
    }),

  listCategories: (activeOnly?: boolean) =>
    api<TicketCategory[]>(`/helpdesk/categories${activeOnly ? '?active=true' : ''}`),
  createCategory: (input: TicketCategoryCreateInput) =>
    api<TicketCategory>('/helpdesk/categories', { method: 'POST', body: JSON.stringify(input) }),
  updateCategory: (id: string, input: TicketCategoryUpdateInput) =>
    api<TicketCategory>(`/helpdesk/categories/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),
  removeCategory: (id: string) =>
    api<{ ok: true }>(`/helpdesk/categories/${id}`, { method: 'DELETE' }),
};
