import type { AuditEntry } from '@hrms/shared';
import { api } from '@/lib/api-client';

export interface Paginated<T> {
  data: T[];
  meta: { page: number; limit: number; total: number };
}

export interface AuditFilters {
  page: number;
  limit: number;
  resource?: string;
  entity?: string;
  from?: string;
  to?: string;
}

export const auditApi = {
  list: (filters: AuditFilters) => {
    const params = new URLSearchParams({
      page: String(filters.page),
      limit: String(filters.limit),
    });
    for (const key of ['resource', 'entity', 'from', 'to'] as const) {
      const value = filters[key];
      if (value) params.set(key, value);
    }
    return api<Paginated<AuditEntry>>(`/audit?${params}`);
  },
  facets: () => api<{ actions: string[]; entities: string[] }>('/audit/facets'),
};

/** `leave.request.approved` → `leave`. Actions are dot-namespaced by convention. */
export function actionResource(action: string): string {
  return action.split('.')[0] ?? action;
}

/** `leave.request.approved` → `request approved` — the part worth reading. */
export function actionLabel(action: string): string {
  return action.split('.').slice(1).join(' ').replace(/_/g, ' ') || action;
}

const RELATIVE = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 31_536_000_000],
  ['month', 2_592_000_000],
  ['day', 86_400_000],
  ['hour', 3_600_000],
  ['minute', 60_000],
];

export function relativeTime(iso: string): string {
  const diff = Date.parse(iso) - Date.now();
  for (const [unit, ms] of UNITS) {
    if (Math.abs(diff) >= ms) return RELATIVE.format(Math.round(diff / ms), unit);
  }
  return 'just now';
}
