'use client';

import { Badge } from '@hrms/ui/components/badge';
import { Button } from '@hrms/ui/components/button';
import { Skeleton } from '@hrms/ui/components/skeleton';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { EmptyState } from '@/components/empty-state';
import { ErrorState } from '@/components/error-state';
import { formatMoney, payrollApi, payrollKeys } from '@/features/payroll/api';

/** One employee's salary revision timeline, newest first. */
export default function SalaryTimelinePage() {
  const { employeeId } = useParams<{ employeeId: string }>();
  const timeline = useQuery({
    queryKey: [...payrollKeys.salaries(), employeeId],
    queryFn: () => payrollApi.salaryTimeline(employeeId),
  });

  if (timeline.isError) return <ErrorState onRetry={() => timeline.refetch()} />;
  if (!timeline.data) return <Skeleton className="h-64 w-full rounded-xl" />;
  const { employee, revisions } = timeline.data;

  return (
    <section className="space-y-4">
      <Button
        variant="ghost"
        size="sm"
        className="-ml-2"
        render={<Link href="/payroll/salaries" />}
      >
        <ArrowLeft className="size-4" aria-hidden /> All salaries
      </Button>

      <div>
        <h2>{employee.name}</h2>
        <p className="mt-0.5 text-muted-foreground text-sm">
          {employee.employeeCode}
          {employee.designation && ` · ${employee.designation}`}
          {employee.department && ` · ${employee.department}`}
          {employee.joinDate && ` · joined ${employee.joinDate}`}
        </p>
      </div>

      {revisions.length === 0 ? (
        <EmptyState
          title="No salary assigned"
          hint="Assign a structure and CTC from the salaries list."
        />
      ) : (
        <ol className="space-y-3">
          {revisions.map((revision, index) => (
            <li key={revision.id} className="rounded-xl border bg-card p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-lg tabular-nums">
                    {formatMoney(revision.monthlyCtc)}
                  </span>
                  {index === 0 && <Badge variant="success">Current</Badge>}
                  {revision.changePercent !== null && (
                    <Badge variant={revision.changePercent >= 0 ? 'info' : 'error'}>
                      {revision.changePercent >= 0 ? '+' : ''}
                      {revision.changePercent}%
                    </Badge>
                  )}
                </div>
                <span className="text-muted-foreground text-sm">{revision.effectiveFrom}</span>
              </div>
              <p className="mt-1 text-muted-foreground text-sm">
                {revision.revisionType.toLowerCase()} · {revision.structureName}
                {revision.previousCtc !== null && ` · from ${formatMoney(revision.previousCtc)}`}
              </p>
              {revision.reason && <p className="mt-1 text-sm">{revision.reason}</p>}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
