'use client';

import { Alert, AlertDescription, AlertTitle } from '@hrms/ui/components/alert';
import { Button } from '@hrms/ui/components/button';
import { Card, CardContent, CardHeader, CardTitle } from '@hrms/ui/components/card';
import { Checkbox } from '@hrms/ui/components/checkbox';
import { Skeleton } from '@hrms/ui/components/skeleton';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  BadgeCheck,
  Ban,
  Calculator,
  CircleDollarSign,
  Lock,
  Send,
  TriangleAlert,
  Undo2,
} from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { type Column, DataTable } from '@/components/data-table';
import { ErrorState } from '@/components/error-state';
import { useSession } from '@/components/session-provider';
import { formatMoney, formatMonth, payrollApi, payrollKeys } from '@/features/payroll/api';
import { AdjustmentsPanel } from '@/features/payroll/components/adjustments-panel';
import { PaymentStatusBadge, RunStatusBadge } from '@/features/payroll/components/status-badge';
import type { PayslipRow, RunStatus } from '@/features/payroll/types';
import { useListParams } from '@/hooks/use-list-params';

/**
 * Which actions are offered in which state. Mirrors the API state machine —
 * the server is still the authority, this only avoids showing a button that
 * would be refused.
 */
const ACTIONS: {
  action: 'calculate' | 'approve' | 'reopen' | 'lock' | 'publish' | 'cancel';
  label: string;
  icon: typeof Calculator;
  from: RunStatus[];
  permission: string;
  variant?: 'default' | 'outline' | 'destructive';
}[] = [
  {
    action: 'calculate',
    label: 'Calculate',
    icon: Calculator,
    from: ['DRAFT', 'IN_REVIEW'],
    permission: 'payroll.process',
  },
  {
    action: 'approve',
    label: 'Approve',
    icon: BadgeCheck,
    from: ['IN_REVIEW'],
    permission: 'payroll.approve',
  },
  {
    action: 'reopen',
    label: 'Reopen',
    icon: Undo2,
    from: ['APPROVED'],
    permission: 'payroll.approve',
    variant: 'outline',
  },
  { action: 'lock', label: 'Lock', icon: Lock, from: ['APPROVED'], permission: 'payroll.approve' },
  {
    action: 'publish',
    label: 'Publish',
    icon: Send,
    from: ['LOCKED'],
    permission: 'payroll.process',
  },
  {
    action: 'cancel',
    label: 'Cancel',
    icon: Ban,
    from: ['DRAFT', 'IN_REVIEW', 'APPROVED'],
    permission: 'payroll.process',
    variant: 'destructive',
  },
];

const STEPS: RunStatus[] = ['DRAFT', 'IN_REVIEW', 'APPROVED', 'LOCKED', 'PUBLISHED'];

export default function PayrollRunPage() {
  const { runId } = useParams<{ runId: string }>();
  const queryClient = useQueryClient();
  const { can } = useSession();
  const params = useListParams('employeeName');
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const run = useQuery({ queryKey: payrollKeys.run(runId), queryFn: () => payrollApi.run(runId) });

  /*
   * 100 is the cap every list endpoint enforces, not a number picked to fit.
   * This page previously asked for 200 to avoid wiring pagination, which the
   * API rejected outright — the table showed an error rather than payslips.
   */
  const listQuery = {
    runId,
    page: params.page,
    limit: 100,
    sort: params.sort,
    order: params.order,
  };
  const payslips = useQuery({
    queryKey: [...payrollKeys.payslips(), listQuery],
    queryFn: () => payrollApi.payslips(listQuery),
  });
  const preflight = useQuery({
    queryKey: [...payrollKeys.run(runId), 'preflight'],
    queryFn: () => payrollApi.preflight(runId),
    enabled: can('payroll.process') && run.data?.status === 'DRAFT',
  });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: payrollKeys.all() });
    setSelected(new Set());
  };

  const act = useMutation({
    mutationFn: (action: (typeof ACTIONS)[number]['action']) =>
      payrollApi.actOnRun(runId, { action }),
    onSuccess: (updated) => {
      toast.success(`Payroll is now ${updated.status.toLowerCase().replace('_', ' ')}`);
      refresh();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const pay = useMutation({
    mutationFn: (status: 'PROCESSING' | 'PAID' | 'FAILED') =>
      payrollApi.updatePayment({
        payslipIds: [...selected],
        status,
        failureReason: status === 'FAILED' ? 'Bank transfer rejected' : null,
      }),
    onSuccess: (result) => {
      toast.success(`${result.updated} payslip(s) marked ${result.status.toLowerCase()}`);
      refresh();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  if (run.isError) return <ErrorState onRetry={() => run.refetch()} />;
  if (!run.data) return <Skeleton className="h-64 w-full rounded-xl" />;

  const current = run.data;
  const stepIndex = STEPS.indexOf(current.status);
  const rows = payslips.data?.data ?? [];
  const allSelected = rows.length > 0 && selected.size === rows.length;

  const columns: Column<PayslipRow>[] = [
    ...(can('payroll.pay') && current.status === 'PUBLISHED'
      ? [
          {
            key: 'select',
            header: '',
            alwaysVisible: true,
            className: 'w-10',
            render: (row: PayslipRow) => (
              <Checkbox
                checked={selected.has(row.id)}
                aria-label={`Select ${row.employeeName}`}
                onCheckedChange={() =>
                  setSelected((prev) => {
                    const next = new Set(prev);
                    if (!next.delete(row.id)) next.add(row.id);
                    return next;
                  })
                }
              />
            ),
          } satisfies Column<PayslipRow>,
        ]
      : []),
    {
      key: 'employeeName',
      header: 'Employee',
      sortable: true,
      alwaysVisible: true,
      render: (row) => (
        <Link href={`/payroll/payslips/${row.id}`} className="font-medium hover:underline">
          {row.employeeName}
          <span className="block text-muted-foreground text-xs">{row.employeeCode}</span>
        </Link>
      ),
    },
    {
      key: 'department',
      header: 'Department',
      className: 'hidden lg:table-cell',
      render: (row) => row.department ?? '—',
    },
    {
      key: 'payableDays',
      header: 'Days',
      className: 'hidden sm:table-cell tabular-nums',
      render: (row) => (
        <span>
          {row.payableDays}
          {row.lopDays > 0 && <span className="text-warning-text"> · {row.lopDays} LOP</span>}
        </span>
      ),
    },
    {
      key: 'grossEarnings',
      header: 'Gross',
      className: 'hidden md:table-cell tabular-nums',
      render: (row) => formatMoney(row.grossEarnings),
    },
    {
      key: 'totalDeductions',
      header: 'Deductions',
      className: 'hidden md:table-cell tabular-nums',
      render: (row) => formatMoney(row.totalDeductions),
    },
    {
      key: 'netPay',
      header: 'Net pay',
      sortable: true,
      className: 'tabular-nums',
      render: (row) => (
        <span className="font-medium">
          {formatMoney(row.netPay)}
          {row.carriedShortfall > 0 && (
            <span
              className="block text-warning-text text-xs"
              title="Deductions exceeded gross; the remainder is carried"
            >
              {formatMoney(row.carriedShortfall)} carried
            </span>
          )}
        </span>
      ),
    },
    {
      key: 'paymentStatus',
      header: 'Payment',
      render: (row) => <PaymentStatusBadge status={row.paymentStatus} />,
    },
  ];

  return (
    <section className="space-y-5">
      <Button variant="ghost" size="sm" className="-ml-2" render={<Link href="/payroll" />}>
        <ArrowLeft className="size-4" aria-hidden /> All runs
      </Button>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-3">
            {formatMonth(current.month)}
            <RunStatusBadge status={current.status} />
          </h2>
          <p className="mt-0.5 text-muted-foreground text-sm">
            {current.employeeCount} employees · net {formatMoney(current.netPayable)} · employer
            cost {formatMoney(current.totalEmployerCost)}
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          {ACTIONS.filter((a) => a.from.includes(current.status) && can(a.permission as never)).map(
            (a) => (
              <Button
                key={a.action}
                variant={a.variant ?? 'default'}
                disabled={act.isPending}
                onClick={() => act.mutate(a.action)}
              >
                <a.icon className="size-4" aria-hidden /> {a.label}
              </Button>
            ),
          )}
        </div>
      </div>

      {/* Progress rail — where the run is, and what it cannot go back past. */}
      {current.status !== 'CANCELLED' && (
        <ol className="flex flex-wrap items-center gap-1.5 text-sm" aria-label="Payroll progress">
          {STEPS.map((step, index) => (
            <li key={step} className="flex items-center gap-1.5">
              <span
                className={
                  index <= stepIndex
                    ? 'rounded-lg bg-primary px-2.5 py-1 font-medium text-primary-foreground'
                    : 'rounded-lg bg-muted px-2.5 py-1 text-muted-foreground'
                }
                aria-current={index === stepIndex ? 'step' : undefined}
              >
                {step.replace('_', ' ').toLowerCase()}
              </span>
              {index < STEPS.length - 1 && (
                <span aria-hidden className="text-muted-foreground">
                  →
                </span>
              )}
            </li>
          ))}
        </ol>
      )}

      {(current.status === 'LOCKED' || current.status === 'PUBLISHED') && (
        <Alert variant="info">
          <Lock aria-hidden />
          <AlertTitle>This payroll is final</AlertTitle>
          <AlertDescription>
            Locked payroll cannot be recalculated or reopened. Correct anything wrong with an
            adjustment in the next run.
          </AlertDescription>
        </Alert>
      )}

      {preflight.data && !preflight.data.canCalculate && (
        <Alert variant="error">
          <TriangleAlert aria-hidden />
          <AlertTitle>Not ready to calculate</AlertTitle>
          <AlertDescription>
            {preflight.data.blocking.noSalary.length > 0 && (
              <span className="block">
                No salary assigned: {preflight.data.blocking.noSalary.map((e) => e.name).join(', ')}
              </span>
            )}
            {preflight.data.blocking.emptyStructure.length > 0 && (
              <span className="block">
                Empty salary structure:{' '}
                {preflight.data.blocking.emptyStructure.map((e) => e.name).join(', ')}
              </span>
            )}
          </AlertDescription>
        </Alert>
      )}

      {preflight.data && preflight.data.warnings.noBank.length > 0 && (
        <Alert variant="warning">
          <TriangleAlert aria-hidden />
          <AlertTitle>Missing bank details</AlertTitle>
          <AlertDescription>
            {preflight.data.warnings.noBank.map((e) => e.name).join(', ')} will be calculated but
            cannot be included in a bank transfer file.
          </AlertDescription>
        </Alert>
      )}

      {can('payroll.read') && (
        <AdjustmentsPanel
          month={current.month}
          // Mirrors the API rather than replacing it: a settled month refuses
          // the write, so the panel does not offer a button that would 400.
          editable={
            can('payroll.process') && current.status !== 'LOCKED' && current.status !== 'PUBLISHED'
          }
        />
      )}

      {selected.size > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">
              {selected.size} payslip{selected.size === 1 ? '' : 's'} selected
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap items-center gap-2">
            <Button size="sm" disabled={pay.isPending} onClick={() => pay.mutate('PROCESSING')}>
              <CircleDollarSign className="size-4" aria-hidden /> Mark processing
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={pay.isPending}
              onClick={() => pay.mutate('PAID')}
            >
              Mark paid
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={pay.isPending}
              onClick={() => pay.mutate('FAILED')}
            >
              Mark failed
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
              Clear
            </Button>
          </CardContent>
        </Card>
      )}

      {can('payroll.pay') && current.status === 'PUBLISHED' && rows.length > 0 && (
        <div className="flex w-fit items-center gap-2 text-muted-foreground text-sm">
          <Checkbox
            id="select-all-payslips"
            checked={allSelected}
            onCheckedChange={() =>
              setSelected(allSelected ? new Set() : new Set(rows.map((r) => r.id)))
            }
          />
          <label htmlFor="select-all-payslips">
            Select all {rows.length} on this page
            {payslips.data && payslips.data.meta.total > rows.length && (
              <span className="text-muted-foreground"> of {payslips.data.meta.total}</span>
            )}
          </label>
        </div>
      )}

      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(row) => row.id}
        loading={payslips.isLoading}
        error={payslips.isError}
        onRetry={() => payslips.refetch()}
        meta={payslips.data?.meta}
        onPageChange={params.setPage}
        sort={params.sort}
        order={params.order}
        onSortChange={params.toggleSort}
        emptyTitle="No payslips yet"
        emptyHint={
          current.status === 'DRAFT'
            ? 'Calculate this run to produce payslips.'
            : 'Nobody was eligible for this month.'
        }
        emptyAction={
          current.status === 'DRAFT' && can('payroll.process') ? (
            <Button size="sm" onClick={() => act.mutate('calculate')} disabled={act.isPending}>
              <Calculator className="size-4" aria-hidden /> Calculate now
            </Button>
          ) : undefined
        }
      />
    </section>
  );
}
