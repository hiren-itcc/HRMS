'use client';

import { Avatar, AvatarFallback, AvatarImage } from '@hrms/ui/components/avatar';
import { Button } from '@hrms/ui/components/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@hrms/ui/components/select';
import { useQuery } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Suspense } from 'react';
import { CrudShell } from '@/components/crud/crud-shell';
import { DataTable } from '@/components/data-table';
import { useSession } from '@/components/session-provider';
import { employeesApi } from '@/features/employees/api';
import { EmployeeStatusBadge } from '@/features/employees/components/status-badge';
import { fullName, initials } from '@/features/employees/types';
import { departmentsApi, locationsApi } from '@/features/organization/api';
import { useCrudList } from '@/hooks/use-crud';
import { useListParams } from '@/hooks/use-list-params';

const KEY = 'employees';
const ALL = 'all';

const joinFmt = new Intl.DateTimeFormat(undefined, {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
});

function EmployeesView() {
  const router = useRouter();
  const { can } = useSession();
  const params = useListParams('firstName');
  const departmentId = params.get('departmentId');
  const locationId = params.get('locationId');
  const status = params.get('status');

  const list = useCrudList(KEY, employeesApi, {
    page: params.page,
    limit: 10,
    search: params.search,
    sort: params.sort,
    order: params.order,
    departmentId,
    locationId,
    status,
  });
  const departments = useQuery({
    queryKey: ['org-departments', 'options'],
    queryFn: departmentsApi.options,
    staleTime: 60_000,
    enabled: can('org.read'),
  });
  const locations = useQuery({
    queryKey: ['org-locations', 'options'],
    queryFn: locationsApi.options,
    staleTime: 60_000,
    enabled: can('org.read'),
  });

  return (
    <div className="space-y-6">
      <CrudShell
        headingLevel="h1"
        title="Employees"
        description="Directory of everyone in the organization"
        search={params.search}
        onSearchChange={params.setSearch}
        onAdd={() => router.push('/employees/new')}
        addLabel="Add employee"
        managePerm="employee.create"
        filters={
          <>
            <Select
              value={departmentId ?? ALL}
              onValueChange={(v) => params.setFilter('departmentId', v === ALL ? undefined : v)}
            >
              <SelectTrigger className="w-44" aria-label="Filter by department">
                <SelectValue placeholder="All departments" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All departments</SelectItem>
                {departments.data?.map((d) => (
                  <SelectItem key={d.id} value={d.id}>
                    {d.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={locationId ?? ALL}
              onValueChange={(v) => params.setFilter('locationId', v === ALL ? undefined : v)}
            >
              <SelectTrigger className="w-40" aria-label="Filter by location">
                <SelectValue placeholder="All locations" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All locations</SelectItem>
                {locations.data?.map((l) => (
                  <SelectItem key={l.id} value={l.id}>
                    {l.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={status ?? ALL}
              onValueChange={(v) => params.setFilter('status', v === ALL ? undefined : v)}
            >
              <SelectTrigger className="w-36" aria-label="Filter by status">
                <SelectValue placeholder="All statuses" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All statuses</SelectItem>
                <SelectItem value="ACTIVE">Active</SelectItem>
                <SelectItem value="ON_NOTICE">On notice</SelectItem>
                <SelectItem value="EXITED">Exited</SelectItem>
              </SelectContent>
            </Select>
          </>
        }
      >
        <DataTable
          columns={[
            {
              key: 'firstName',
              header: 'Employee',
              sortable: true,
              render: (e) => (
                <Link
                  href={`/employees/${e.id}`}
                  className="flex items-center gap-3 hover:underline"
                >
                  <Avatar className="size-8">
                    {e.avatarUrl && <AvatarImage src={e.avatarUrl} alt="" />}
                    <AvatarFallback className="text-xs">{initials(e)}</AvatarFallback>
                  </Avatar>
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{fullName(e)}</span>
                    <span className="block truncate text-muted-foreground text-xs">
                      {e.designation?.title ?? e.workEmail}
                    </span>
                  </span>
                </Link>
              ),
            },
            {
              key: 'employeeCode',
              header: 'ID',
              sortable: true,
              className: 'hidden sm:table-cell',
              render: (e) => <span className="font-mono text-xs">{e.employeeCode}</span>,
            },
            {
              key: 'department',
              header: 'Department',
              className: 'hidden md:table-cell',
              render: (e) => e.department?.name ?? '—',
            },
            {
              key: 'joinDate',
              header: 'Joined',
              sortable: true,
              className: 'hidden lg:table-cell',
              render: (e) => (
                <span className="tabular-nums">{joinFmt.format(new Date(e.joinDate))}</span>
              ),
            },
            {
              key: 'status',
              header: 'Status',
              sortable: true,
              render: (e) => <EmployeeStatusBadge status={e.status} />,
            },
          ]}
          rows={list.data?.data}
          rowKey={(e) => e.id}
          loading={list.isLoading}
          sort={params.sort}
          order={params.order}
          onSortChange={params.toggleSort}
          meta={list.data?.meta}
          onPageChange={params.setPage}
          emptyTitle="No employees found"
          emptyHint="Adjust the filters, or add the first employee."
          emptyAction={
            can('employee.create') ? (
              <Button asChild size="sm">
                <Link href="/employees/new">
                  <Plus className="size-4" aria-hidden /> Add employee
                </Link>
              </Button>
            ) : undefined
          }
          error={list.isError}
          onRetry={() => list.refetch()}
        />
      </CrudShell>
    </div>
  );
}

export default function EmployeesPage() {
  return (
    <Suspense>
      <EmployeesView />
    </Suspense>
  );
}
