'use client';

import { Button } from '@hrms/ui/components/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@hrms/ui/components/select';
import { Plus } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Suspense } from 'react';
import { CrudShell } from '@/components/crud/crud-shell';
import { DataTable } from '@/components/data-table';
import { EmployeeAvatar } from '@/components/employee-avatar';
import { NoAccess } from '@/components/no-access';
import { useSession } from '@/components/session-provider';
import { employeesApi } from '@/features/employees/api';
import { EmployeeStatusBadge } from '@/features/employees/components/status-badge';
import { fullName, initials } from '@/features/employees/types';
import { departmentsApi, locationsApi } from '@/features/organization/api';
import { useCrudList, useOptions } from '@/hooks/use-crud';
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
  const canReadOrg = { enabled: can('org.read') };
  const departments = useOptions(
    'org-departments',
    departmentsApi.options,
    (d) => d.name,
    canReadOrg,
  );
  const locations = useOptions('org-locations', locationsApi.options, (l) => l.name, canReadOrg);

  return (
    <div className="space-y-6">
      <CrudShell
        headingLevel="h1"
        title="Employees"
        description="Directory of everyone in the organization"
        search={params.search}
        onSearchChange={params.setSearch}
        onAdd={() => router.push('/employees/onboard')}
        addLabel="Onboard a hire"
        managePerm="employee.create"
        filters={
          <>
            {/*
             * Two ways in, on purpose. Onboarding is the normal path for
             * somebody who has not started; "Add directly" stays for records
             * HR is entering after the fact, where there is nobody to invite.
             */}
            {can('employee.read') && (
              <Button variant="outline" size="sm" render={<Link href="/employees/onboarding" />}>
                Onboarding
              </Button>
            )}
            {can('employee.create') && (
              <Button variant="ghost" size="sm" render={<Link href="/employees/new" />}>
                Add directly
              </Button>
            )}
            {/* Its own code, not `employee.create` — importing is adding four
                hundred people and optionally emailing all of them, which is a
                different decision from adding one. */}
            {can('employee.import') && (
              <Button variant="ghost" size="sm" render={<Link href="/employees/import" />}>
                Import
              </Button>
            )}
            <Select
              value={departmentId ?? ALL}
              onValueChange={(v) => params.setFilter('departmentId', v === ALL ? undefined : v)}
            >
              <SelectTrigger className="w-44" aria-label="Filter by department">
                <SelectValue placeholder="All departments" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All departments</SelectItem>
                {departments.options?.map((d) => (
                  <SelectItem key={d.id} value={d.id}>
                    {d.label}
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
                {locations.options?.map((l) => (
                  <SelectItem key={l.id} value={l.id}>
                    {l.label}
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
                  <EmployeeAvatar src={e.avatarUrl} fallback={initials(e)} />
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
              <Button size="sm" render={<Link href="/employees/new" />}>
                <Plus className="size-4" aria-hidden /> Add employee
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
  const { can, status } = useSession();

  /*
   * The HR roster, not the people list. Without this an employee who reached
   * the URL got a table that error-carded on the 403; the directory is the
   * screen they actually want, so point at it rather than dead-ending.
   */
  if (status === 'authenticated' && !can('employee.read') && !can('employee.read.team')) {
    return <NoAccess what="the employee records" />;
  }
  return (
    <Suspense>
      <EmployeesView />
    </Suspense>
  );
}
