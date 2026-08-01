'use client';

import type { ReportChart as ReportChartData } from '@hrms/shared';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useSession } from '@/components/session-provider';
import { reportsApi } from '../api';
import { ReportChart } from './report-chart';

/**
 * Compact six-month movement chart for the dashboard. Rendered only for
 * people who can see reports at all — everyone else has no business
 * knowing org-wide headcount.
 */
export function HeadcountWidget() {
  const { can } = useSession();
  const allowed = can('report.view') || can('report.view.team');

  const query = useQuery({
    queryKey: ['reports', 'summary'],
    queryFn: reportsApi.summary,
    enabled: allowed,
    staleTime: 300_000,
  });

  if (!allowed || !query.data) return null;

  const chart: ReportChartData = {
    id: 'dashboard-headcount',
    title: 'Headcount · last 6 months',
    kind: 'line',
    xKey: 'month',
    series: [{ key: 'headcount', label: 'Headcount' }],
    data: query.data.data.map((p) => ({ month: p.month, headcount: p.headcount })),
  };

  return (
    <div className="space-y-2">
      <ReportChart chart={chart} height={200} />
      <Link
        href="/reports"
        className="inline-block px-1 text-muted-foreground text-xs hover:text-foreground hover:underline"
      >
        View all reports →
      </Link>
    </div>
  );
}
