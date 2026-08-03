'use client';

import { Badge } from '@hrms/ui/components/badge';
import { Button } from '@hrms/ui/components/button';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { CrudShell } from '@/components/crud/crud-shell';
import { type Column, DataTable } from '@/components/data-table';
import { NoAccess } from '@/components/no-access';
import { PageHeader } from '@/components/page-header';
import { useSession } from '@/components/session-provider';
import {
  type OnboardingRecord,
  type OnboardingStatus,
  onboardingApi,
  onboardingKeys,
} from '@/features/onboarding/api';
import { useListParams } from '@/hooks/use-list-params';

const PAGE_SIZE = 20;

const dateFmt = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});

function StatusBadge({ status }: { status: OnboardingStatus }) {
  if (status === 'APPROVED') return <Badge variant="success">Approved</Badge>;
  if (status === 'SUBMITTED') return <Badge variant="warning">Awaiting review</Badge>;
  return <Badge variant="secondary">In progress</Badge>;
}

/** HR's queue: who has been invited, who is stuck, who is waiting on a check. */
function ReviewQueue() {
  const params = useListParams('createdAt');
  const status = params.get('status') as OnboardingStatus | undefined;

  const list = useQuery({
    queryKey: [...onboardingKeys.list(status), params.page],
    queryFn: () => onboardingApi.list({ status, page: params.page, limit: PAGE_SIZE }),
    placeholderData: keepPreviousData,
  });

  const columns: Column<OnboardingRecord>[] = [
    {
      key: 'employee',
      header: 'New hire',
      alwaysVisible: true,
      render: (r) => (
        <Link href={`/employees/onboarding/${r.id}`} className="min-w-0 hover:underline">
          <span className="block truncate font-medium">
            {r.employee.firstName} {r.employee.lastName}
          </span>
          <span className="block truncate font-mono text-muted-foreground text-xs">
            {r.employee.employeeCode}
          </span>
        </Link>
      ),
    },
    {
      key: 'workEmail',
      header: 'Sign-in',
      className: 'hidden md:table-cell',
      render: (r) => r.employee.workEmail,
    },
    {
      key: 'joinDate',
      header: 'Joins',
      className: 'hidden sm:table-cell',
      render: (r) => (
        <span className="tabular-nums">{dateFmt.format(new Date(r.employee.joinDate))}</span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (r) => <StatusBadge status={r.status} />,
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Onboarding"
        description="New hires who have been invited but are not yet active"
      />
      <CrudShell
        title="Submissions"
        description="Check the details against the documents before approving"
        search=""
        onSearchChange={() => undefined}
        filters={
          <div className="flex gap-1">
            {(['SUBMITTED', 'IN_PROGRESS', 'APPROVED'] as const).map((s) => (
              <Button
                key={s}
                size="sm"
                variant={status === s ? 'default' : 'outline'}
                onClick={() => params.setFilter('status', status === s ? undefined : s)}
              >
                {s === 'SUBMITTED'
                  ? 'Awaiting review'
                  : s === 'IN_PROGRESS'
                    ? 'In progress'
                    : 'Approved'}
              </Button>
            ))}
          </div>
        }
      >
        <DataTable
          columns={columns}
          rows={list.data?.data}
          rowKey={(r) => r.id}
          loading={list.isLoading}
          meta={list.data?.meta}
          onPageChange={params.setPage}
          emptyTitle="Nothing here"
          emptyHint="Invite a new hire from the Employees screen."
          error={list.isError}
          onRetry={() => list.refetch()}
        />
      </CrudShell>
    </div>
  );
}

export default function OnboardingReviewPage() {
  const { can, status } = useSession();
  if (status === 'authenticated' && !can('employee.read')) {
    return <NoAccess what="onboarding" />;
  }
  return <ReviewQueue />;
}
