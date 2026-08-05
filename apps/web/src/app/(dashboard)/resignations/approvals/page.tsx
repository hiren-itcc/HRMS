'use client';

import { RESIGNATION_REASON_LABELS } from '@hrms/shared';
import { Badge } from '@hrms/ui/components/badge';
import { Button } from '@hrms/ui/components/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@hrms/ui/components/select';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import { type Column, DataTable } from '@/components/data-table';
import { useSession } from '@/components/session-provider';
import { resignationKeys, resignationsApi } from '@/features/resignations/api';
import { ResignationStatusBadge } from '@/features/resignations/components/resignation-status';
import type { Resignation } from '@/features/resignations/types';

const dateFmt = new Intl.DateTimeFormat('en-IN', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});
const showDate = (iso: string) => dateFmt.format(new Date(iso));

const PAGE_SIZE = 20;

export default function ResignationApprovalsPage() {
  const { can } = useSession();
  // Awaiting-me first: the inbox exists to answer "what needs me", and an
  // unfiltered list of everything makes that the user's job.
  const [awaitingMe, setAwaitingMe] = useState(true);
  const [page, setPage] = useState(1);

  const params = { page, limit: PAGE_SIZE, ...(awaitingMe ? { awaitingMe: 'true' } : {}) };
  const query = useQuery({
    queryKey: resignationKeys.list(params),
    queryFn: () => resignationsApi.list(params),
  });

  const columns: Column<Resignation>[] = [
    {
      key: 'employee',
      header: 'Employee',
      alwaysVisible: true,
      render: (row) => (
        <Link href={`/resignations/${row.id}`} className="hover:underline">
          <span className="font-medium">
            {row.employee.firstName} {row.employee.lastName}
          </span>
          <span className="block text-muted-foreground text-xs">{row.employee.employeeCode}</span>
        </Link>
      ),
    },
    {
      key: 'department',
      header: 'Department',
      className: 'hidden md:table-cell',
      render: (row) => row.employee.department?.name ?? '—',
    },
    {
      key: 'reason',
      header: 'Reason',
      className: 'hidden lg:table-cell',
      render: (row) => RESIGNATION_REASON_LABELS[row.reason],
    },
    {
      key: 'lastWorkingDate',
      header: 'Last working day',
      sortable: true,
      render: (row) => (
        <span className="flex flex-wrap items-center gap-1.5">
          {showDate(row.lastWorkingDate)}
          {/* Short notice is the one thing an approver must not miss, and it
              is not visible from the date alone. */}
          {row.isShortNotice && (
            <Badge className="border-transparent bg-warning/15 text-warning-text">
              Short notice
            </Badge>
          )}
        </span>
      ),
    },
    {
      key: 'submittedAt',
      header: 'Submitted',
      sortable: true,
      className: 'hidden sm:table-cell',
      render: (row) => showDate(row.submittedAt),
    },
    {
      key: 'status',
      header: 'Status',
      render: (row) => <ResignationStatusBadge status={row.status} />,
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Select
          value={awaitingMe ? 'mine' : 'all'}
          onValueChange={(v) => {
            setAwaitingMe(v === 'mine');
            setPage(1);
          }}
        >
          <SelectTrigger className="w-56" aria-label="Which resignations to show">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="mine">Waiting on me</SelectItem>
            <SelectItem value="all">
              {can('resignation.read') ? 'Everyone' : 'My whole team'}
            </SelectItem>
          </SelectContent>
        </Select>
      </div>

      <DataTable
        columns={columns}
        rows={query.data?.data}
        rowKey={(row) => row.id}
        loading={query.isPending}
        error={query.isError}
        onRetry={() => query.refetch()}
        meta={query.data?.meta}
        onPageChange={setPage}
        emptyTitle={awaitingMe ? 'Nothing waiting on you' : 'No resignations'}
        emptyHint={
          awaitingMe
            ? 'Requests appear here when they reach your step.'
            : 'Nobody has filed a resignation.'
        }
        actions={(row) => (
          <Button variant="outline" size="sm" render={<Link href={`/resignations/${row.id}`} />}>
            {row.awaitingDesk ? 'Review' : 'View'}
          </Button>
        )}
      />
    </div>
  );
}
