import type { NotificationEntry } from '@hrms/shared';
import type { Paginated } from '@hrms/types';
import { api } from '@/lib/api-client';
import { type ListRequest, qs } from '@/lib/crud';

export type { NotificationEntry };

export const notificationKeys = {
  all: () => ['notifications'] as const,
  list: (params: ListRequest) => ['notifications', 'list', params] as const,
  unread: () => ['notifications', 'unread'] as const,
};

export const notificationsApi = {
  list: (params: ListRequest) => api<Paginated<NotificationEntry>>(`/notifications${qs(params)}`),
  unreadCount: () => api<{ unread: number }>('/notifications/unread-count'),
  markRead: (id: string) =>
    api<{ updated: number }>(`/notifications/${id}/read`, { method: 'POST' }),
  markAllRead: () => api<{ updated: number }>('/notifications/read-all', { method: 'POST' }),
};
