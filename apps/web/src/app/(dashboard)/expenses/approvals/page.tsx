'use client';

import { Button } from '@hrms/ui/components/button';
import { Input } from '@hrms/ui/components/input';
import { MonthPicker } from '@hrms/ui/components/month-picker';
import { useQuery } from '@tanstack/react-query';
import { Check, Eye, X } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { type Column, DataTable } from '@/components/data-table';
import { IconAction } from '@/components/icon-action';
import { useSession } from '@/components/session-provider';
import { type ExpenseClaim, expenseKeys, expensesApi } from '@/features/expenses/api';
import { ClaimStatusBadge } from '@/features/expenses/components/expense-badges';
import { formatMoney } from '@/features/payroll/api';
import { useApiMutation } from '@/hooks/use-crud';

/** Next month, in local parts — `toISOString()` on a local Date shifts the day. */
function nextMonth(): string {
  const now = new Date();
  const then = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  return `${then.getFullYear()}-${String(then.getMonth() + 1).padStart(2, '0')}`;
}

export default function ExpenseApprovalsPage() {
  const { can } = useSession();
  // Finance sees everything; a manager sees the people who report to them.
  const scope: 'all' | 'team' = can('expense.approve') ? 'all' : 'team';
  const [deciding, setDeciding] = useState<ExpenseClaim | null>(null);
  const [month, setMonth] = useState(nextMonth);
  const [note, setNote] = useState('');

  const params = {
    page: 1,
    limit: 50,
    order: 'desc' as const,
    scope,
    status: 'SUBMITTED' as const,
  };
  const query = useQuery({
    queryKey: expenseKeys.list(params),
    queryFn: () => expensesApi.list(params),
  });

  const close = () => {
    setDeciding(null);
    setNote('');
  };

  const approve = useApiMutation({
    mutationFn: (claim: ExpenseClaim) =>
      expensesApi.approve(claim.id, { payrollMonth: month, note: note || undefined }),
    invalidate: [expenseKeys.all()],
    success: 'Claim approved',
    onSuccess: close,
  });

  const reject = useApiMutation({
    mutationFn: (claim: ExpenseClaim) => expensesApi.reject(claim.id, { note: note || undefined }),
    invalidate: [expenseKeys.all()],
    success: 'Claim declined',
    onSuccess: close,
  });

  const columns: Column<ExpenseClaim>[] = [
    {
      key: 'who',
      header: 'Who',
      alwaysVisible: true,
      render: (row) => (row.employee ? `${row.employee.firstName} ${row.employee.lastName}` : '—'),
    },
    {
      key: 'title',
      header: 'Claim',
      render: (row) => (
        <Link href={`/expenses/${row.id}`} className="hover:underline">
          {row.title}
        </Link>
      ),
    },
    {
      key: 'total',
      header: 'Total',
      render: (row) => <span className="tabular-nums">{formatMoney(row.total)}</span>,
    },
    { key: 'status', header: 'Status', render: (row) => <ClaimStatusBadge status={row.status} /> },
  ];

  return (
    <div className="space-y-4">
      <DataTable
        columns={columns}
        rows={query.data?.data}
        rowKey={(row) => row.id}
        loading={query.isPending}
        error={query.isError}
        onRetry={() => query.refetch()}
        emptyTitle="Nothing waiting"
        emptyHint="Claims appear here the moment somebody submits one."
        actions={(row) => (
          /*
            An eye, like every other row action in the app — the word "Review"
            was the odd one out. It reads as a link to a detail page and is not
            one: it opens the decision panel below the table, which is why the
            label names the claim rather than saying "View".
          */
          <IconAction label={`Review ${row.title}`} icon={Eye} onClick={() => setDeciding(row)} />
        )}
      />

      {deciding && (
        <div className="space-y-4 rounded-lg border p-4">
          <div>
            <p className="font-medium">{deciding.title}</p>
            <p className="text-muted-foreground text-sm">
              {deciding.employee
                ? `${deciding.employee.firstName} ${deciding.employee.lastName} · `
                : ''}
              {formatMoney(deciding.total)} across {deciding.itemCount} line(s)
            </p>
          </div>

          <ul className="space-y-1 text-sm">
            {deciding.items.map((item) => (
              <li key={item.id} className="flex justify-between gap-4">
                <span className="truncate">
                  {item.spentOn} · {item.category?.name ?? '—'} · {item.description}
                </span>
                <span className="shrink-0 tabular-nums">{formatMoney(item.amount)}</span>
              </li>
            ))}
          </ul>

          <div className="space-y-1.5">
            {/*
              Required by the API, and deliberately the approver's choice: which
              month somebody is paid in is a judgement, and a claim filed on the
              31st is usually next month's.
            */}
            <label htmlFor="payroll-month" className="font-medium text-sm">
              Pay it with
            </label>
            <MonthPicker id="payroll-month" value={month} onValueChange={setMonth} />
          </div>

          <Input
            aria-label="Note for the claimant"
            placeholder="Optional — say why, especially when declining"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />

          <div className="flex flex-wrap gap-2">
            <Button
              disabled={approve.isPending || reject.isPending}
              onClick={() => approve.mutate(deciding)}
            >
              <Check className="size-4" aria-hidden /> Approve
            </Button>
            <Button
              variant="outline"
              className="text-destructive hover:text-destructive"
              disabled={approve.isPending || reject.isPending}
              onClick={() => reject.mutate(deciding)}
            >
              <X className="size-4" aria-hidden /> Decline
            </Button>
            <Button variant="ghost" onClick={close}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
