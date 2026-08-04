'use client';

import { Badge } from '@hrms/ui/components/badge';
import { Button } from '@hrms/ui/components/button';
import { Skeleton } from '@hrms/ui/components/skeleton';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { toast } from 'sonner';
import { EmptyState } from '@/components/empty-state';
import { ErrorState } from '@/components/error-state';
import { useSession } from '@/components/session-provider';
import { formatMoney, payrollApi, payrollKeys } from '@/features/payroll/api';

/** One employee's salary revision timeline, newest first. */
export default function SalaryTimelinePage() {
  const { employeeId } = useParams<{ employeeId: string }>();
  const { can } = useSession();
  const queryClient = useQueryClient();
  const timeline = useQuery({
    queryKey: [...payrollKeys.salaries(), employeeId],
    queryFn: () => payrollApi.salaryTimeline(employeeId),
  });

  /*
   * Deleting a revision is for correcting a mistake — a wrong figure or a
   * wrong effective date typed yesterday — not for rewriting history. The API
   * refuses once payroll for that month or any later one is locked or
   * published, because by then the revision is part of what somebody was
   * actually paid.
   *
   * The endpoint has existed since payroll shipped with no way to call it, so
   * a mistyped revision could only be buried under a corrective one.
   */
  const remove = useMutation({
    mutationFn: (id: string) => payrollApi.deleteSalary(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: payrollKeys.salaries() });
      toast.success('Revision removed');
    },
    onError: (error: Error) => toast.error(error.message),
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
                <div className="flex items-center gap-1">
                  <span className="text-muted-foreground text-sm">{revision.effectiveFrom}</span>
                  {can('payroll.salary.manage') && (
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      className="text-destructive hover:text-destructive"
                      aria-label={`Remove the revision effective ${revision.effectiveFrom}`}
                      title="Remove this revision — refused once its month's payroll is settled"
                      disabled={remove.isPending}
                      onClick={() => remove.mutate(revision.id)}
                    >
                      <Trash2 className="size-4" aria-hidden />
                    </Button>
                  )}
                </div>
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
