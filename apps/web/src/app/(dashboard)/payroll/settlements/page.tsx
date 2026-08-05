'use client';

import { SETTLEMENT_STATUS_LABELS, type SettlementStatusCode } from '@hrms/shared';
import { Badge } from '@hrms/ui/components/badge';
import { Button } from '@hrms/ui/components/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@hrms/ui/components/select';
import { cn } from '@hrms/ui/lib/utils';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import { type Column, DataTable } from '@/components/data-table';
import {
  formatSettlementMoney,
  type Settlement,
  settlementKeys,
  settlementsApi,
} from '@/features/settlements/api';

const dateFmt = new Intl.DateTimeFormat('en-IN', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});
const showDate = (iso: string) => dateFmt.format(new Date(iso));

const TONE: Record<SettlementStatusCode, string> = {
  DRAFT: 'bg-warning/15 text-warning-text',
  APPROVED: 'bg-info/15 text-info-text',
  PAID: 'bg-success/15 text-success-text',
  CANCELLED: 'bg-muted text-muted-foreground',
};

const PAGE_SIZE = 20;

/**
 * Finance's queue. Drafts first, because a draft is the only state where
 * anybody is waiting on somebody.
 *
 * There is no "Prepare settlement" button here on purpose — a settlement is
 * started from the exit it belongs to, where whoever presses it can see the
 * last working day and the clearance it is priced against.
 */
export default function SettlementsPage() {
  const [status, setStatus] = useState<SettlementStatusCode | 'ALL'>('DRAFT');
  const [page, setPage] = useState(1);

  const params = { page, limit: PAGE_SIZE, ...(status === 'ALL' ? {} : { status }) };
  const query = useQuery({
    queryKey: settlementKeys.list(params),
    queryFn: () => settlementsApi.list(params),
  });

  const columns: Column<Settlement>[] = [
    {
      key: 'employee',
      header: 'Employee',
      alwaysVisible: true,
      render: (row) => (
        <Link href={`/employees/${row.employeeId}`} className="hover:underline">
          <span className="font-medium">
            {row.employee.firstName} {row.employee.lastName}
          </span>
          <span className="block text-muted-foreground text-xs">{row.employee.employeeCode}</span>
        </Link>
      ),
    },
    {
      key: 'lastWorkingDate',
      header: 'Last working day',
      sortable: true,
      render: (row) => showDate(row.lastWorkingDate),
    },
    {
      key: 'totalEarnings',
      header: 'Earnings',
      className: 'hidden md:table-cell',
      render: (row) => (
        <span className="tabular-nums">{formatSettlementMoney(row.totalEarnings)}</span>
      ),
    },
    {
      key: 'totalDeductions',
      header: 'Deductions',
      className: 'hidden md:table-cell',
      render: (row) => (
        <span className="tabular-nums">{formatSettlementMoney(row.totalDeductions)}</span>
      ),
    },
    {
      key: 'netPayable',
      header: 'Net payable',
      sortable: true,
      render: (row) => (
        <span
          className={cn('font-medium tabular-nums', row.netPayable < 0 && 'text-destructive-text')}
        >
          {formatSettlementMoney(row.netPayable)}
        </span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (row) => (
        <Badge className={cn('border-transparent', TONE[row.status])}>
          {SETTLEMENT_STATUS_LABELS[row.status]}
        </Badge>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <Select
        value={status}
        onValueChange={(v) => {
          setStatus(v as SettlementStatusCode | 'ALL');
          setPage(1);
        }}
      >
        <SelectTrigger className="w-52" aria-label="Filter by status">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="DRAFT">Draft</SelectItem>
          <SelectItem value="APPROVED">Approved</SelectItem>
          <SelectItem value="PAID">Paid</SelectItem>
          <SelectItem value="CANCELLED">Cancelled</SelectItem>
          <SelectItem value="ALL">All</SelectItem>
        </SelectContent>
      </Select>

      <DataTable
        columns={columns}
        rows={query.data?.data}
        rowKey={(row) => row.id}
        loading={query.isPending}
        error={query.isError}
        onRetry={() => query.refetch()}
        meta={query.data?.meta}
        onPageChange={setPage}
        emptyTitle={status === 'DRAFT' ? 'Nothing waiting to be settled' : 'Nothing here'}
        emptyHint="A settlement is prepared from the exit it belongs to, on the offboarding record."
        actions={(row) => (
          <Button
            variant="outline"
            size="sm"
            render={<Link href={`/payroll/settlements/${row.id}`} />}
          >
            View
          </Button>
        )}
      />
    </div>
  );
}
