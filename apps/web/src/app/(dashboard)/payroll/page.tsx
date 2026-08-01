'use client';

import { Button } from '@hrms/ui/components/button';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarPlus, Wallet } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { FormDialog } from '@/components/crud/form-dialog';
import { type Column, DataTable } from '@/components/data-table';
import { Field } from '@/components/field';
import { useSession } from '@/components/session-provider';
import { StatCard } from '@/components/stat-card';
import { formatMoney, formatMonth, payrollApi, payrollKeys } from '@/features/payroll/api';
import { RunStatusBadge } from '@/features/payroll/components/status-badge';
import type { PayrollRun } from '@/features/payroll/types';
import { useListParams } from '@/hooks/use-list-params';

/** Default to last month: payroll is run after the month it pays for. */
function previousMonth(): string {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString().slice(0, 7);
}

export default function PayrollRunsPage() {
  const params = useListParams('month');
  const router = useRouter();
  const queryClient = useQueryClient();
  const { can } = useSession();
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState(previousMonth());

  const listQuery = {
    page: params.page,
    limit: 10,
    sort: params.sort,
    order: params.order,
  };
  const runs = useQuery({
    queryKey: [...payrollKeys.runs(), listQuery],
    queryFn: () => payrollApi.runs(listQuery),
  });

  const create = useMutation({
    mutationFn: () => payrollApi.createRun({ month }),
    onSuccess: (run) => {
      toast.success(`Payroll opened for ${formatMonth(run.month)}`);
      setOpen(false);
      queryClient.invalidateQueries({ queryKey: payrollKeys.runs() });
      router.push(`/payroll/${run.id}`);
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const latest = runs.data?.data[0];

  const columns: Column<PayrollRun>[] = [
    {
      key: 'month',
      header: 'Month',
      sortable: true,
      alwaysVisible: true,
      render: (row) => (
        <button
          type="button"
          className="text-left font-medium hover:underline"
          onClick={() => router.push(`/payroll/${row.id}`)}
        >
          {formatMonth(row.month)}
        </button>
      ),
    },
    { key: 'status', header: 'Status', render: (row) => <RunStatusBadge status={row.status} /> },
    {
      key: 'employeeCount',
      header: 'Employees',
      className: 'hidden sm:table-cell tabular-nums',
      render: (row) => row.employeeCount,
    },
    {
      key: 'totalEarnings',
      header: 'Gross',
      className: 'hidden md:table-cell tabular-nums',
      render: (row) => formatMoney(row.totalEarnings),
    },
    {
      key: 'netPayable',
      header: 'Net payable',
      sortable: true,
      className: 'tabular-nums',
      render: (row) => <span className="font-medium">{formatMoney(row.netPayable)}</span>,
    },
    {
      key: 'payDate',
      header: 'Pay date',
      className: 'hidden lg:table-cell',
      render: (row) => row.payDate ?? '—',
    },
  ];

  return (
    <section className="space-y-4">
      {latest && (
        <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,14rem),1fr))] gap-4">
          <StatCard
            label="Latest payroll"
            value={formatMonth(latest.month)}
            hint={latest.status.toLowerCase().replace('_', ' ')}
            icon={Wallet}
            gradient="primary"
          />
          <StatCard
            label="Net payable"
            value={formatMoney(latest.netPayable)}
            hint={`${latest.employeeCount} employees`}
            icon={Wallet}
            gradient="emerald"
          />
          <StatCard
            label="Employer cost"
            value={formatMoney(latest.totalEmployerCost)}
            hint="PF and ESI contributions"
            icon={Wallet}
            gradient="sky"
          />
        </div>
      )}

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2>Payroll runs</h2>
          <p className="mt-0.5 text-muted-foreground text-sm">
            One run per month, from draft through to published
          </p>
        </div>
        {can('payroll.process') && (
          <Button onClick={() => setOpen(true)}>
            <CalendarPlus className="size-4" aria-hidden /> Open a month
          </Button>
        )}
      </div>

      <DataTable
        columns={columns}
        rows={runs.data?.data}
        rowKey={(row) => row.id}
        loading={runs.isLoading}
        error={runs.isError}
        onRetry={() => runs.refetch()}
        meta={runs.data?.meta}
        onPageChange={params.setPage}
        sort={params.sort}
        order={params.order}
        onSortChange={params.toggleSort}
        emptyTitle="No payroll has been run yet"
        emptyHint="Open a month to calculate its payslips."
      />

      <FormDialog
        open={open}
        onOpenChange={setOpen}
        title="Open payroll"
        description="Payroll is calculated for one month at a time."
        onSubmit={(e) => {
          e.preventDefault();
          create.mutate();
        }}
        submitting={create.isPending}
        submitLabel="Open month"
      >
        <Field label="Month" required hint="Payroll cannot be opened for a future month">
          {(a11y) => (
            <input
              {...a11y}
              type="month"
              value={month}
              max={new Date().toISOString().slice(0, 7)}
              onChange={(e) => setMonth(e.target.value)}
              className="flex h-9 w-full rounded-lg border border-input bg-background px-3 text-sm focus-visible:border-ring focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/24"
            />
          )}
        </Field>
      </FormDialog>
    </section>
  );
}
