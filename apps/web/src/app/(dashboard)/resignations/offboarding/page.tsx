'use client';

import {
  OFFBOARDING_REASON_LABELS,
  OFFBOARDING_STATUS_LABELS,
  type OffboardingStatusCode,
} from '@hrms/shared';
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
import { UserMinus } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { type Column, DataTable } from '@/components/data-table';
import { type Offboarding, offboardingKeys, offboardingsApi } from '@/features/offboarding/api';
import { clearanceProgress } from '@/features/offboarding/components/clearance-checklist';
import { StartOffboardingDialog } from '@/features/offboarding/components/start-offboarding-dialog';

const dateFmt = new Intl.DateTimeFormat('en-IN', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});
const showDate = (iso: string) => dateFmt.format(new Date(iso));
const relative = (iso: string, todayMs: number) => {
  const days = Math.round((new Date(iso).getTime() - todayMs) / 86_400_000);
  return new Intl.RelativeTimeFormat('en', { numeric: 'auto' }).format(days, 'day');
};

const TONE: Record<OffboardingStatusCode, string> = {
  IN_PROGRESS: 'bg-warning/15 text-warning-text',
  COMPLETED: 'bg-muted text-muted-foreground',
  CANCELLED: 'bg-muted text-muted-foreground',
};

const PAGE_SIZE = 20;

export default function OffboardingPage() {
  const [status, setStatus] = useState<OffboardingStatusCode | 'ALL'>('IN_PROGRESS');
  const [page, setPage] = useState(1);
  const [starting, setStarting] = useState(false);
  // Read once per render so every row's "in 12 days" is measured from the same
  // instant rather than drifting down the list.
  const todayMs = new Date().setHours(0, 0, 0, 0);

  const params = { page, limit: PAGE_SIZE, ...(status === 'ALL' ? {} : { status }) };
  const query = useQuery({
    queryKey: offboardingKeys.list(params),
    queryFn: () => offboardingsApi.list(params),
  });

  const columns: Column<Offboarding>[] = [
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
      key: 'reason',
      header: 'Reason',
      render: (row) => OFFBOARDING_REASON_LABELS[row.reason],
    },
    {
      key: 'snapshotDepartment',
      header: 'Department',
      className: 'hidden md:table-cell',
      // The frozen value, not a live join: the record has to still read true
      // after the department it names has been reorganised away.
      render: (row) => row.snapshotDepartment ?? '—',
    },
    {
      key: 'lastWorkingDate',
      header: 'Last working day',
      sortable: true,
      render: (row) => (
        <span>
          {showDate(row.lastWorkingDate)}
          {row.status === 'IN_PROGRESS' && (
            <span className="block text-muted-foreground text-xs">
              {relative(row.lastWorkingDate, todayMs)}
            </span>
          )}
        </span>
      ),
    },
    {
      key: 'clearance',
      header: 'Clearance',
      className: 'hidden sm:table-cell',
      render: (row) => {
        const { done, total } = clearanceProgress(row.tasks);
        if (total === 0) return <span className="text-muted-foreground">—</span>;
        return (
          <span className={done < total ? 'text-warning-text' : undefined}>
            {done} of {total}
          </span>
        );
      },
    },
    {
      key: 'status',
      header: 'Status',
      render: (row) => (
        <Badge className={cn('border-transparent', TONE[row.status])}>
          {OFFBOARDING_STATUS_LABELS[row.status]}
        </Badge>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Select
          value={status}
          onValueChange={(v) => {
            setStatus(v as OffboardingStatusCode | 'ALL');
            setPage(1);
          }}
        >
          <SelectTrigger className="w-52" aria-label="Filter by status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="IN_PROGRESS">Serving notice</SelectItem>
            <SelectItem value="COMPLETED">Completed</SelectItem>
            <SelectItem value="CANCELLED">Cancelled</SelectItem>
            <SelectItem value="ALL">All</SelectItem>
          </SelectContent>
        </Select>

        <Button onClick={() => setStarting(true)}>
          <UserMinus className="size-4" aria-hidden /> Start an exit
        </Button>
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
        emptyTitle={status === 'IN_PROGRESS' ? 'Nobody is serving notice' : 'Nothing here'}
        emptyHint="Approving a resignation starts one automatically. Use “Start an exit” for a termination or a contract ending."
        actions={(row) => (
          <Button
            variant="outline"
            size="sm"
            render={<Link href={`/resignations/offboarding/${row.id}`} />}
          >
            View
          </Button>
        )}
      />

      <StartOffboardingDialog open={starting} onOpenChange={setStarting} />
    </div>
  );
}
