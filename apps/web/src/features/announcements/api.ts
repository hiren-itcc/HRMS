import type { AnnouncementCreateInput, AnnouncementUpdateInput } from '@hrms/shared';
import type { Paginated } from '@hrms/types';
import { api, fetchBlob, uploadFile } from '@/lib/api-client';

export type AnnouncementCategory = 'GENERAL' | 'HOLIDAY' | 'BIRTHDAY' | 'POLICY';
export type AnnouncementPriority = 'NORMAL' | 'HIGH' | 'URGENT';
export type Audience = 'ALL' | 'DEPARTMENT' | 'LOCATION';

export interface AnnouncementAttachment {
  id: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
}

export interface Announcement {
  id: string;
  title: string;
  body: string;
  category: AnnouncementCategory;
  priority: AnnouncementPriority;
  audience: Audience;
  departmentId: string | null;
  locationId: string | null;
  isPinned: boolean;
  publishAt: string;
  expiresAt: string | null;
  createdAt: string;
  updatedAt: string;
  attachments: AnnouncementAttachment[];
  readCount: number;
  isRead: boolean;
  isScheduled: boolean;
  isExpired: boolean;
  author: { id: string; name: string; avatarUrl: string | null };
}

export interface ReadReceipt {
  userId: string;
  readAt: string;
  name: string;
  email: string | null;
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

export const announcementsApi = {
  list: (params: Params) => api<Paginated<Announcement>>(`/announcements${qs(params)}`),
  unreadCount: () => api<{ unread: number }>('/announcements/unread-count'),
  detail: (id: string) => api<Announcement>(`/announcements/${id}`),
  create: (input: AnnouncementCreateInput) =>
    api<Announcement>('/announcements', { method: 'POST', body: JSON.stringify(input) }),
  update: (id: string, input: AnnouncementUpdateInput) =>
    api<Announcement>(`/announcements/${id}`, { method: 'PATCH', body: JSON.stringify(input) }),
  remove: (id: string) => api<void>(`/announcements/${id}`, { method: 'DELETE' }),
  markRead: (id: string) => api<void>(`/announcements/${id}/read`, { method: 'POST' }),
  markAllRead: () => api<{ marked: number }>('/announcements/read-all', { method: 'POST' }),
  reads: (id: string) => api<ReadReceipt[]>(`/announcements/${id}/reads`),

  addAttachment: (id: string, file: File, onProgress: (percent: number) => void) => {
    const form = new FormData();
    form.append('file', file);
    return uploadFile<AnnouncementAttachment>(`/announcements/${id}/attachments`, form, onProgress);
  },
  removeAttachment: (attachmentId: string) =>
    api<void>(`/announcements/attachments/${attachmentId}`, { method: 'DELETE' }),
  attachmentBlob: (attachmentId: string) =>
    fetchBlob(`/announcements/attachments/${attachmentId}/file`),
};

export const CATEGORY_STYLE: Record<AnnouncementCategory, { label: string; className: string }> = {
  GENERAL: { label: 'General', className: 'bg-muted text-muted-foreground' },
  HOLIDAY: { label: 'Holiday', className: 'bg-success/15 text-success' },
  BIRTHDAY: { label: 'Birthday', className: 'bg-chart-5/15 text-chart-5' },
  POLICY: { label: 'Policy', className: 'bg-info/15 text-info' },
};

export const PRIORITY_STYLE: Record<AnnouncementPriority, { label: string; className: string }> = {
  NORMAL: { label: 'Normal', className: '' },
  HIGH: { label: 'High', className: 'bg-warning/15 text-warning' },
  URGENT: { label: 'Urgent', className: 'bg-destructive/15 text-destructive' },
};
