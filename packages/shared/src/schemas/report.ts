import { z } from 'zod';
import { dateOnlySchema } from './common';

/** Anything wider risks an unbounded scan and a browser-melting payload. */
export const MAX_REPORT_DAYS = 366;

export const reportFormatSchema = z.enum(['json', 'csv', 'excel']).default('json');

export const reportRangeSchema = z
  .object({
    from: dateOnlySchema,
    to: dateOnlySchema,
    departmentId: z.string().optional(),
    format: reportFormatSchema,
  })
  .refine((d) => d.to >= d.from, {
    path: ['to'],
    message: 'End date cannot be before the start date',
  })
  .refine(
    (d) =>
      (Date.parse(`${d.to}T00:00:00.000Z`) - Date.parse(`${d.from}T00:00:00.000Z`)) / 86_400_000 <
      MAX_REPORT_DAYS,
    { path: ['to'], message: `Choose a range shorter than ${MAX_REPORT_DAYS} days` },
  );
export type ReportRangeQuery = z.infer<typeof reportRangeSchema>;

export type ReportFormat = z.infer<typeof reportFormatSchema>;

/** Column metadata drives both the on-screen table and every export. */
export interface ReportColumn {
  key: string;
  header: string;
  type?: 'text' | 'number' | 'date';
}

/**
 * One chart, as data only — no colours, no geometry. The web renders it with
 * Recharts and the table below it renders from `columns`/`rows`; neither
 * decides what the numbers mean.
 */
export interface ReportChart {
  id: string;
  title: string;
  kind: 'bar' | 'stackedBar' | 'line' | 'horizontalBar';
  /** Key in each `data` row holding the category label. */
  xKey: string;
  /** Series order is the palette order — fixed, never sorted by value. */
  series: { key: string; label: string }[];
  data: Record<string, string | number>[];
}

export interface ReportKpi {
  key: string;
  label: string;
  value: number;
  unit?: 'days' | 'hours' | 'percent';
}

/** Every report speaks this shape, so one export layer serves all four. */
export interface ReportResult {
  meta: {
    title: string;
    from: string;
    to: string;
    generatedAt: string;
    scope: 'org' | 'team';
    /** True when the roster hit its cap — the figures cover only part of the org. */
    truncated?: boolean;
  };
  kpis: ReportKpi[];
  charts: ReportChart[];
  columns: ReportColumn[];
  rows: Record<string, string | number | null>[];
}
