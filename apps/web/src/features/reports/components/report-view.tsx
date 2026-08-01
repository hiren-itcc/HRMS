'use client';

import type { ReportKpi } from '@hrms/shared';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@hrms/ui/components/select';
import { Skeleton } from '@hrms/ui/components/skeleton';
import { useQuery } from '@tanstack/react-query';
import type { LucideIcon } from 'lucide-react';
import {
  Activity,
  Building2,
  CalendarCheck,
  Clock3,
  LogOut,
  Percent,
  TrendingDown,
  UserPlus,
  Users,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { DataTable } from '@/components/data-table';
import { FadeInItem, Stagger } from '@/components/motion';
import { useSession } from '@/components/session-provider';
import { StatCard, type StatGradient } from '@/components/stat-card';
import { departmentsApi } from '@/features/organization/api';
import { useListParams } from '@/hooks/use-list-params';
import { defaultRange, type ReportName, reportsApi } from '../api';
import { DateRangeFilter } from './date-range-filter';
import { ExportMenu } from './export-menu';
import { ReportChart } from './report-chart';

const ALL = 'all';
const PAGE_SIZE = 15;

/** Fixed slot order — a KPI keeps its colour as the set changes. */
const GRADIENTS: StatGradient[] = ['primary', 'sky', 'emerald', 'amber', 'rose'];

const ICONS: Record<string, LucideIcon> = {
  headcount: Users,
  joiners: UserPlus,
  leavers: LogOut,
  attrition: TrendingDown,
  rate: Percent,
  present: CalendarCheck,
  absent: LogOut,
  late: Clock3,
  hours: Clock3,
  days: CalendarCheck,
  requests: Activity,
  pending: Clock3,
  takers: Users,
  utilisation: Percent,
  departments: Building2,
  largest: Building2,
  types: Building2,
};

function formatKpi(kpi: ReportKpi): string {
  if (kpi.unit === 'percent') return `${kpi.value}%`;
  if (kpi.unit === 'hours') return `${kpi.value}h`;
  if (kpi.unit === 'days') return `${kpi.value}d`;
  return String(kpi.value);
}

interface ReportViewProps {
  report: ReportName;
  /** Department filter is meaningless on the department rollup. */
  showDepartmentFilter?: boolean;
  emptyTitle: string;
}

export function ReportView({ report, showDepartmentFilter = true, emptyTitle }: ReportViewProps) {
  const params = useListParams('name');
  const { can } = useSession();
  const fallback = defaultRange();
  const from = params.get('from') ?? fallback.from;
  const to = params.get('to') ?? fallback.to;
  const departmentId = params.get('departmentId') ?? null;
  const range = { from, to, departmentId };

  const [printAll, setPrintAll] = useState(false);

  // Every row must be on the page before the print dialog opens — the table
  // is paged in JS, so no print stylesheet can reveal the rest.
  useEffect(() => {
    if (!printAll) return;
    const frame = requestAnimationFrame(() => {
      window.print();
      setPrintAll(false);
    });
    return () => cancelAnimationFrame(frame);
  }, [printAll]);

  const query = useQuery({
    queryKey: ['reports', report, from, to, departmentId],
    queryFn: () => reportsApi.get(report, range),
  });

  const departments = useQuery({
    queryKey: ['org-departments', 'options'],
    queryFn: departmentsApi.options,
    staleTime: 60_000,
    enabled: showDepartmentFilter && can('org.read'),
  });

  const data = query.data;
  const rows = data?.rows ?? [];
  const page = Math.min(params.page, Math.max(1, Math.ceil(rows.length / PAGE_SIZE)));
  // A stable key per row: report rows have no id, and the first column
  // (employee code, department name) is not guaranteed unique.
  const keyed = rows.map((row, i) => ({ ...row, __key: String(i) }));
  const visible = printAll ? keyed : keyed.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <Stagger className="space-y-6">
      <FadeInItem className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <DateRangeFilter
          from={from}
          to={to}
          onChange={(next) => params.setFilters({ from: next.from, to: next.to })}
        />
        <div className="flex items-center gap-2">
          {showDepartmentFilter && can('org.read') && (
            <Select
              value={departmentId ?? ALL}
              onValueChange={(v) => params.setFilter('departmentId', v === ALL ? undefined : v)}
            >
              <SelectTrigger className="w-44" aria-label="Filter by department">
                <SelectValue placeholder="All departments" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All departments</SelectItem>
                {departments.data?.map((d) => (
                  <SelectItem key={d.id} value={d.id}>
                    {d.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <ExportMenu report={report} range={range} onPrint={() => setPrintAll(true)} />
        </div>
      </FadeInItem>

      {/* Only visible when printing — the on-screen header already says this. */}
      <div className="hidden print:block">
        <h2 className="font-bold text-lg">{data?.meta.title}</h2>
        <p className="text-sm">
          {from} to {to}
          {data?.meta.scope === 'team' ? ' · direct reports' : ''}
        </p>
      </div>

      {data?.meta.truncated && (
        <FadeInItem>
          <p className="rounded-2xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm">
            This organisation is larger than one report can cover, so these figures include only the
            first 5,000 employees. Narrow the range or filter by department for accurate numbers.
          </p>
        </FadeInItem>
      )}

      {query.isError ? (
        <FadeInItem>
          <p className="rounded-2xl border border-destructive/30 bg-destructive/5 p-6 text-destructive-text text-sm">
            This report could not be generated. Try a shorter date range.
          </p>
        </FadeInItem>
      ) : (
        <>
          <FadeInItem>
            <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,13rem),1fr))] gap-4">
              {query.isLoading
                ? Array.from({ length: 5 }, (_, i) => (
                    // biome-ignore lint/suspicious/noArrayIndexKey: fixed-length skeleton
                    <Skeleton key={i} className="h-[116px] rounded-2xl" />
                  ))
                : data?.kpis.map((kpi, i) => (
                    <StatCard
                      key={kpi.key}
                      label={kpi.label}
                      value={formatKpi(kpi)}
                      icon={ICONS[kpi.key] ?? Activity}
                      gradient={GRADIENTS[i % GRADIENTS.length] as StatGradient}
                    />
                  ))}
            </div>
          </FadeInItem>

          <FadeInItem>
            <div className="grid gap-4 lg:grid-cols-2">
              {query.isLoading
                ? Array.from({ length: 2 }, (_, i) => (
                    // biome-ignore lint/suspicious/noArrayIndexKey: fixed-length skeleton
                    <Skeleton key={i} className="h-[340px] rounded-2xl" />
                  ))
                : data?.charts.map((chart) => <ReportChart key={chart.id} chart={chart} />)}
            </div>
          </FadeInItem>

          <FadeInItem>
            <DataTable
              columns={(data?.columns ?? []).map((col) => ({
                key: col.key,
                header: col.header,
                className: col.type === 'number' ? 'text-right' : undefined,
                render: (row: Record<string, string | number | null>) => (
                  <span className={col.type === 'number' ? 'block text-right tabular-nums' : ''}>
                    {row[col.key] ?? '—'}
                  </span>
                ),
              }))}
              rows={visible}
              rowKey={(row) => row.__key}
              loading={query.isLoading}
              error={query.isError}
              onRetry={() => query.refetch()}
              meta={printAll ? undefined : { page, limit: PAGE_SIZE, total: rows.length }}
              onPageChange={params.setPage}
              emptyTitle={emptyTitle}
              emptyHint="Try a wider date range or a different department"
            />
          </FadeInItem>
        </>
      )}
    </Stagger>
  );
}
