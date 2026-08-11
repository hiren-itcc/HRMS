import { api } from '@/lib/api-client';

export type FilingKind = 'ECR' | 'ESIC_RETURN';

export const FILING_LABELS: Record<FilingKind, string> = {
  ECR: 'EPFO — Electronic Challan cum Return',
  ESIC_RETURN: 'ESIC — monthly contribution return',
};

export interface FilingExclusion {
  employeeCode: string;
  employeeName: string;
  reason: string;
}

export interface FilingPreview {
  kind: FilingKind;
  rowCount: number;
  excluded: FilingExclusion[];
  totals: Record<string, number>;
  /** Lines for ECR, row objects for ESIC — shown as a sample, never the whole file. */
  preview: unknown[];
  /** Non-null when the company cannot file at all yet. */
  blocked?: string | null;
  id?: string;
}

export interface FilingRecord {
  id: string;
  kind: FilingKind;
  period: string;
  rowCount: number;
  excludedCount: number;
  generatedAt: string;
}

export const filingKeys = {
  all: () => ['payroll', 'filings'] as const,
  list: (period?: string) => ['payroll', 'filings', 'list', period ?? 'all'] as const,
  readiness: () => ['payroll', 'filings', 'readiness'] as const,
  preview: (kind: FilingKind, month: string) =>
    ['payroll', 'filings', 'preview', kind, month] as const,
};

export const filingsApi = {
  readiness: () => api<Record<FilingKind, string | null>>('/payroll/filings/readiness'),
  list: (period?: string) =>
    api<FilingRecord[]>(`/payroll/filings${period ? `?period=${period}` : ''}`),
  preview: (kind: FilingKind, month: string) =>
    api<FilingPreview>(`/payroll/filings/preview?kind=${kind}&month=${month}`),
  generate: (kind: FilingKind, month: string) =>
    api<FilingPreview>(`/payroll/filings?kind=${kind}&month=${month}`, { method: 'POST' }),
  remove: (id: string) => api<{ id: string }>(`/payroll/filings/${id}`, { method: 'DELETE' }),
};
