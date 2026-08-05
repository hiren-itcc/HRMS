'use client';

import { Avatar, AvatarFallback, AvatarImage } from '@hrms/ui/components/avatar';
import { Button } from '@hrms/ui/components/button';
import { DatePicker } from '@hrms/ui/components/date-picker';
import { Input } from '@hrms/ui/components/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@hrms/ui/components/select';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, Clock3, Timer, UserCheck, UserX } from 'lucide-react';
import Link from 'next/link';
import { Suspense } from 'react';
import { DataTable } from '@/components/data-table';
import { FadeInItem, Stagger } from '@/components/motion';
import { useSession } from '@/components/session-provider';
import { StatCard } from '@/components/stat-card';
import {
  attendanceApi,
  currentMonth,
  formatDuration,
  shiftMonth,
  timeIn,
} from '@/features/attendance/api';
import { AttendanceStatusBadge } from '@/features/attendance/components/status-badge';
import { VerificationChip, WorkModeChip } from '@/features/attendance/components/work-mode-chip';
import { initials } from '@/features/employees/types';
import { departmentsApi } from '@/features/organization/api';
import { useOptions } from '@/hooks/use-crud';
import { useListParams } from '@/hooks/use-list-params';

const ALL = 'all';

function shiftDay(dateKey: string, delta: number): string {
  const d = new Date(`${dateKey}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

function TeamAttendanceView() {
  const { can } = useSession();
  const params = useListParams('firstName');
  const today = new Date().toISOString().slice(0, 10);
  const date = params.get('date') ?? today;
  const month = params.get('month') ?? currentMonth();
  const departmentId = params.get('departmentId');
  const view = params.get('view') === 'monthly' ? 'monthly' : 'daily';

  const stats = useQuery({ queryKey: ['attendance', 'stats'], queryFn: attendanceApi.stats });
  const departments = useOptions('org-departments', departmentsApi.options, (d) => d.name, {
    enabled: can('org.read'),
  });

  const daily = useQuery({
    queryKey: ['attendance', 'day', date, departmentId, params.page, params.search],
    queryFn: () =>
      attendanceApi.dayView({
        date,
        departmentId,
        page: params.page,
        limit: 10,
        search: params.search,
      }),
    enabled: view === 'daily',
  });

  const monthly = useQuery({
    queryKey: ['attendance', 'summary', month, departmentId, params.page],
    queryFn: () => attendanceApi.summary({ month, departmentId, page: params.page, limit: 10 }),
    enabled: view === 'monthly',
  });

  return (
    <Stagger className="space-y-6">
      <FadeInItem>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,15rem),1fr))] gap-4">
          <StatCard
            label="Present today"
            value={stats.data ? `${stats.data.present}/${stats.data.headcount}` : undefined}
            hint={stats.data ? `${stats.data.stillIn} still clocked in` : undefined}
            icon={UserCheck}
            gradient="emerald"
            loading={stats.isLoading}
          />
          <StatCard
            label="Late today"
            value={stats.data?.late}
            hint="Arrived after grace period"
            icon={Clock3}
            gradient="amber"
            loading={stats.isLoading}
          />
          <StatCard
            label="Not marked"
            value={stats.data?.notMarked}
            hint="No clock-in yet"
            icon={UserX}
            gradient="rose"
            loading={stats.isLoading}
          />
          <StatCard
            label="Pending corrections"
            value={stats.data?.pendingRequests}
            hint="Awaiting your approval"
            icon={Timer}
            gradient="primary"
            loading={stats.isLoading}
          />
        </div>
      </FadeInItem>

      <FadeInItem className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex w-max gap-1 rounded-xl bg-muted p-1">
            {(['daily', 'monthly'] as const).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => params.setFilter('view', v === 'daily' ? undefined : v)}
                className={`rounded-lg px-3.5 py-1.5 text-sm capitalize transition-colors ${
                  view === v
                    ? 'bg-card font-medium text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {v}
              </button>
            ))}
          </div>

          {view === 'daily' ? (
            <div className="flex items-center gap-1">
              <Button
                variant="outline"
                size="icon"
                aria-label="Previous day"
                onClick={() => params.setFilter('date', shiftDay(date, -1))}
              >
                <ChevronLeft className="size-4" aria-hidden />
              </Button>
              <DatePicker
                value={date}
                max={today}
                onValueChange={(value) => params.setFilter('date', value || undefined)}
                className="w-44"
                aria-label="Attendance date"
              />
              <Button
                variant="outline"
                size="icon"
                aria-label="Next day"
                disabled={date >= today}
                onClick={() => params.setFilter('date', shiftDay(date, 1))}
              >
                <ChevronRight className="size-4" aria-hidden />
              </Button>
            </div>
          ) : (
            <div className="flex items-center gap-1">
              <Button
                variant="outline"
                size="icon"
                aria-label="Previous month"
                onClick={() => params.setFilter('month', shiftMonth(month, -1))}
              >
                <ChevronLeft className="size-4" aria-hidden />
              </Button>
              <Input
                type="month"
                value={month}
                max={currentMonth()}
                onChange={(e) => params.setFilter('month', e.target.value || undefined)}
                className="w-40"
                aria-label="Attendance month"
              />
              <Button
                variant="outline"
                size="icon"
                aria-label="Next month"
                disabled={month >= currentMonth()}
                onClick={() => params.setFilter('month', shiftMonth(month, 1))}
              >
                <ChevronRight className="size-4" aria-hidden />
              </Button>
            </div>
          )}

          {can('org.read') && (
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
          )}
        </div>

        {view === 'daily' ? (
          <DataTable
            columns={[
              {
                key: 'employee',
                header: 'Employee',
                render: (row) => (
                  <Link
                    href={`/employees/${row.employee.id}`}
                    className="flex items-center gap-3 hover:underline"
                  >
                    <Avatar className="size-8">
                      {row.employee.avatarUrl && (
                        <AvatarImage src={row.employee.avatarUrl} alt="" />
                      )}
                      <AvatarFallback className="text-xs">{initials(row.employee)}</AvatarFallback>
                    </Avatar>
                    <span className="min-w-0">
                      <span className="block truncate font-medium">
                        {row.employee.firstName} {row.employee.lastName}
                      </span>
                      <span className="block truncate text-muted-foreground text-xs">
                        {row.employee.department ?? row.employee.employeeCode}
                      </span>
                    </span>
                  </Link>
                ),
              },
              {
                key: 'in',
                header: 'In',
                render: (row) => <span className="tabular-nums">{timeIn(row.checkIn)}</span>,
              },
              {
                key: 'out',
                header: 'Out',
                render: (row) => <span className="tabular-nums">{timeIn(row.checkOut)}</span>,
              },
              {
                key: 'hours',
                header: 'Hours',
                className: 'hidden sm:table-cell',
                render: (row) => (
                  <span className="tabular-nums">
                    {formatDuration(row.workMinutes)}
                    {/* In and Out are the day's first and last; say so when the
                        person came and went more than once, or the gap between
                        them looks like unexplained missing hours. */}
                    {row.sessions.length > 1 && (
                      <span className="ml-1.5 text-muted-foreground text-xs">
                        ×{row.sessions.length}
                      </span>
                    )}
                  </span>
                ),
              },
              {
                key: 'where',
                header: 'Where',
                className: 'hidden md:table-cell',
                render: (row) => {
                  // Where the day was worked, and a marker when that rests on
                  // a reading the system could not confirm. Only the first
                  // uncertain sitting is shown — a row is a prompt to open the
                  // day, not the whole story.
                  const unsure = row.sessions.find((s) => s.verification === 'UNVERIFIED');
                  return (
                    <span className="flex flex-wrap items-center gap-1.5">
                      {row.workMode && <WorkModeChip mode={row.workMode} />}
                      {unsure && <VerificationChip session={unsure} />}
                    </span>
                  );
                },
              },
              {
                key: 'status',
                header: 'Status',
                render: (row) => (
                  <AttendanceStatusBadge
                    status={row.status}
                    isLate={row.isLate}
                    remoteApproved={row.remoteApproved}
                  />
                ),
              },
            ]}
            rows={daily.data?.data}
            rowKey={(row) => row.employee.id}
            loading={daily.isLoading}
            error={daily.isError}
            onRetry={() => daily.refetch()}
            meta={daily.data?.meta}
            onPageChange={params.setPage}
            emptyTitle="Nobody to show"
            emptyHint="Adjust the date or filters"
          />
        ) : (
          <DataTable
            columns={[
              {
                key: 'employee',
                header: 'Employee',
                render: (row) => (
                  <Link href={`/employees/${row.employee.id}`} className="hover:underline">
                    <span className="block font-medium">
                      {row.employee.firstName} {row.employee.lastName}
                    </span>
                    <span className="block text-muted-foreground text-xs">
                      {row.employee.department ?? row.employee.employeeCode}
                    </span>
                  </Link>
                ),
              },
              {
                key: 'present',
                header: 'Present',
                render: (row) => <span className="tabular-nums">{row.present}</span>,
              },
              {
                key: 'halfDay',
                header: 'Half',
                className: 'hidden sm:table-cell',
                render: (row) => <span className="tabular-nums">{row.halfDay}</span>,
              },
              {
                key: 'absent',
                header: 'Absent',
                render: (row) => <span className="tabular-nums">{row.absent}</span>,
              },
              {
                key: 'late',
                header: 'Late',
                className: 'hidden sm:table-cell',
                render: (row) => <span className="tabular-nums">{row.lateMarks}</span>,
              },
              {
                key: 'hours',
                header: 'Hours',
                className: 'hidden md:table-cell',
                render: (row) => (
                  <span className="tabular-nums">{formatDuration(row.workedMinutes)}</span>
                ),
              },
            ]}
            rows={monthly.data?.data}
            rowKey={(row) => row.employee.id}
            loading={monthly.isLoading}
            error={monthly.isError}
            onRetry={() => monthly.refetch()}
            meta={monthly.data?.meta}
            onPageChange={params.setPage}
            emptyTitle="No data for this month"
          />
        )}
      </FadeInItem>
    </Stagger>
  );
}

export default function TeamAttendancePage() {
  return (
    <Suspense>
      <TeamAttendanceView />
    </Suspense>
  );
}
