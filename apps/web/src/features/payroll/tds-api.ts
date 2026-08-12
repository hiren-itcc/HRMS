import { api, fetchBlob } from '@/lib/api-client';

export const QUARTERS = ['Q1', 'Q2', 'Q3', 'Q4'] as const;
export type Quarter = (typeof QUARTERS)[number];

/** Apr-Jun, Jul-Sep, Oct-Dec, Jan-Mar — spelled out so the screen need not. */
export const QUARTER_LABELS: Record<Quarter, string> = {
  Q1: 'Q1 · Apr–Jun',
  Q2: 'Q2 · Jul–Sep',
  Q3: 'Q3 · Oct–Dec',
  Q4: 'Q4 · Jan–Mar',
};

export interface TdsChallan {
  id: string;
  period: string;
  bsrCode: string;
  challanSerial: string;
  depositDate: string;
  sectionCode: string;
  minorHead: string;
  tds: number;
  surcharge: number;
  educationCess: number;
  interest: number;
  fee: number;
  penalty: number;
  others: number;
  total: number;
}

export interface TdsNoPan {
  employeeCode: string;
  employeeName: string;
}

export interface TdsPreview {
  blocked: string | null;
  /** Set while the record layout is untranscribed. Blocks generating, not reading. */
  layoutBlocked: string | null;
  warnings: string[];
  months: string[];
  rowCount: number;
  noPan: TdsNoPan[];
  totals: Record<string, number>;
  preview: string[];
}

export interface TdsReturnRecord {
  id: string;
  financialYear: string;
  quarter: Quarter;
  rowCount: number;
  excludedCount: number;
  generatedAt: string;
}

export const tdsKeys = {
  all: () => ['payroll', 'tds'] as const,
  challans: (fy?: string) => ['payroll', 'tds', 'challans', fy ?? 'all'] as const,
  returns: (fy?: string) => ['payroll', 'tds', 'returns', fy ?? 'all'] as const,
  preview: (fy: string, quarter: Quarter) => ['payroll', 'tds', 'preview', fy, quarter] as const,
};

export const tdsApi = {
  challans: (fy?: string) => api<TdsChallan[]>(`/payroll/challans${fy ? `?fy=${fy}` : ''}`),
  createChallan: (body: unknown) =>
    api<TdsChallan>('/payroll/challans', { method: 'POST', body: JSON.stringify(body) }),
  updateChallan: (id: string, body: unknown) =>
    api<TdsChallan>(`/payroll/challans/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  removeChallan: (id: string) =>
    api<{ id: string }>(`/payroll/challans/${id}`, { method: 'DELETE' }),

  returns: (fy?: string) => api<TdsReturnRecord[]>(`/payroll/returns${fy ? `?fy=${fy}` : ''}`),
  preview: (fy: string, quarter: Quarter) =>
    api<TdsPreview>(`/payroll/returns/preview?fy=${fy}&quarter=${quarter}`),
  generate: (fy: string, quarter: Quarter) =>
    api<TdsPreview & { id: string }>(`/payroll/returns?fy=${fy}&quarter=${quarter}`, {
      method: 'POST',
    }),
  removeReturn: (id: string) => api<{ id: string }>(`/payroll/returns/${id}`, { method: 'DELETE' }),
  /**
   * Through `fetchBlob`, not an `<a href>`. The filings screen uses a bare
   * anchor and relies on the cookie; this carries the Bearer token and
   * controls the filename.
   */
  download: (id: string) => fetchBlob(`/payroll/returns/${id}/file`),
};

/**
 * To the paisa, deliberately not payroll's `formatMoney`, which rounds to
 * whole rupees. A challan has to tie exactly to the bank's record — the same
 * argument `formatSettlementMoney` makes.
 */
export function formatTdsMoney(amount: number): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

/**
 * The financial year a month key falls in. `2027-01` -> `2026-27`.
 *
 * A second copy of `apps/api/src/modules/payroll/tds-period.ts`, which is the
 * authority. It is not that the API needs this function elsewhere and the
 * browser doesn't — `financialYearOf` and `quarterOf` are in fact called by
 * nothing on the API side but their own spec today; only `monthsIn` has a
 * real caller (`TdsReturnsService.gather`). The duplication is here because
 * `packages/shared` has no home for a pure helper (only `constants/` and
 * `schemas/`), and four lines did not seem worth inventing one for.
 *
 * `tds-api.test.ts` pins this against the same table the API's spec uses, so
 * the two cannot drift in silence. That guard is the whole justification for
 * the duplication; do not delete it and keep the copy.
 */
export function financialYearOf(month: string): string {
  const [year, m] = month.split('-').map(Number);
  const start = m >= 4 ? year : year - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
}
