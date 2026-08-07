'use client';

import { Button } from '@hrms/ui/components/button';
import { useQuery } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { type Column, DataTable } from '@/components/data-table';
import { useSession } from '@/components/session-provider';
import { type ExpenseClaim, expenseKeys, expensesApi } from '@/features/expenses/api';
import { ClaimFormDialog } from '@/features/expenses/components/claim-form';
import {
  ClaimStatusBadge,
  PaidBadge,
  ScheduledBadge,
} from '@/features/expenses/components/expense-badges';
import { formatMoney } from '@/features/payroll/api';

export default function MyExpenseClaimsPage() {
  const { can } = useSession();
  const [creating, setCreating] = useState(false);

  const query = useQuery({
    queryKey: expenseKeys.list({ page: 1, limit: 50, order: 'desc', scope: 'own' }),
    queryFn: () => expensesApi.list({ page: 1, limit: 50, order: 'desc', scope: 'own' }),
  });

  const columns: Column<ExpenseClaim>[] = [
    {
      key: 'title',
      header: 'Claim',
      alwaysVisible: true,
      render: (row) => (
        <Link href={`/expenses/${row.id}`} className="font-medium hover:underline">
          {row.title}
        </Link>
      ),
    },
    {
      key: 'lines',
      header: 'Lines',
      render: (row) => <span className="tabular-nums">{row.itemCount}</span>,
    },
    {
      key: 'total',
      header: 'Total',
      render: (row) => <span className="tabular-nums">{formatMoney(row.total)}</span>,
    },
    {
      key: 'status',
      header: 'Status',
      render: (row) => (
        <span className="flex flex-wrap items-center gap-1.5">
          <ClaimStatusBadge status={row.status} />
          {/* Two separate answers: whether it was agreed, and whether the
              money has actually gone out. */}
          {row.paid && <PaidBadge month={row.payrollMonth} />}
          {row.status === 'APPROVED' && !row.paid && row.payrollMonth && (
            <ScheduledBadge month={row.payrollMonth} />
          )}
        </span>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      {can('expense.submit.own') && (
        <div className="flex justify-end">
          <Button onClick={() => setCreating(true)}>
            <Plus className="size-4" aria-hidden /> New claim
          </Button>
        </div>
      )}

      <DataTable
        columns={columns}
        rows={query.data?.data}
        rowKey={(row) => row.id}
        loading={query.isPending}
        error={query.isError}
        onRetry={() => query.refetch()}
        emptyTitle="No claims yet"
        emptyHint="Spent something on the company's behalf? Raise a claim and attach the receipt."
      />

      <ClaimFormDialog open={creating} onOpenChange={setCreating} />
    </div>
  );
}
