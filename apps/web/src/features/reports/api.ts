import type { ReportResult } from '@hrms/shared';
import { api, fetchBlob } from '@/lib/api-client';

export type ReportName = 'employees' | 'attendance' | 'leave' | 'departments';

export interface ReportRange {
  from: string;
  to: string;
  departmentId?: string | null;
}

function query(range: ReportRange, format: 'json' | 'csv' | 'excel'): string {
  const params = new URLSearchParams({ from: range.from, to: range.to, format });
  if (range.departmentId) params.set('departmentId', range.departmentId);
  return params.toString();
}

export interface SummaryPoint {
  month: string;
  headcount: number;
  joiners: number;
  leavers: number;
}

export const reportsApi = {
  get: (name: ReportName, range: ReportRange) =>
    api<ReportResult>(`/reports/${name}?${query(range, 'json')}`),

  summary: () => api<{ from: string; to: string; data: SummaryPoint[] }>('/reports/summary'),

  /**
   * Content-Disposition is not exposed across origins, so the filename is
   * composed here from the same parts the server uses.
   */
  async download(name: ReportName, range: ReportRange, format: 'csv' | 'excel') {
    const blob = await fetchBlob(`/reports/${name}?${query(range, format)}`);
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `hrms-${name}-${range.from}_${range.to}.${format === 'csv' ? 'csv' : 'xls'}`;
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  },
};

// ── date-range presets ──────────────────────────────────────────────────

const pad = (n: number) => String(n).padStart(2, '0');
const key = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** Presets are computed in the browser's timezone — they mirror the user's calendar. */
export function rangePresets(): { label: string; from: string; to: string }[] {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  const quarterStart = Math.floor(m / 3) * 3;
  return [
    { label: 'This month', from: key(new Date(y, m, 1)), to: key(new Date(y, m + 1, 0)) },
    { label: 'Last month', from: key(new Date(y, m - 1, 1)), to: key(new Date(y, m, 0)) },
    {
      label: 'This quarter',
      from: key(new Date(y, quarterStart, 1)),
      to: key(new Date(y, quarterStart + 3, 0)),
    },
    { label: 'Last 6 months', from: key(new Date(y, m - 5, 1)), to: key(new Date(y, m + 1, 0)) },
  ];
}

export function defaultRange(): { from: string; to: string } {
  const preset = rangePresets()[0];
  return { from: preset?.from ?? '', to: preset?.to ?? '' };
}
