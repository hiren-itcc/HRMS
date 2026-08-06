'use client';

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@hrms/ui/components/card';
import { Skeleton } from '@hrms/ui/components/skeleton';
import { useQuery } from '@tanstack/react-query';
import { CalendarOff, ChevronLeft, ChevronRight, Palmtree } from 'lucide-react';
import { useState } from 'react';
import { IconAction } from '@/components/icon-action';
import { FadeInItem, Stagger } from '@/components/motion';
import { useSession } from '@/components/session-provider';
import { currentMonth, shiftMonth } from '@/features/attendance/api';
import { formatDays, formatRange, leaveApi } from '@/features/leave/api';
import { LeaveStatusChip } from '@/features/leave/components/request-row';
import { holidaysApi } from '@/features/organization/api';

const monthLabel = (month: string) =>
  new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(
    new Date(`${month}-01T00:00:00.000Z`),
  );

const dayFmt = new Intl.DateTimeFormat(undefined, {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  timeZone: 'UTC',
});

export default function LeaveCalendarPage() {
  const { can } = useSession();
  const [month, setMonth] = useState(currentMonth);

  const calendar = useQuery({
    queryKey: ['leave', 'calendar', month],
    queryFn: () => leaveApi.calendar(month),
  });

  const holidays = useQuery({
    queryKey: ['org-holidays', 'month', month],
    queryFn: () =>
      holidaysApi.list({ page: 1, limit: 50, year: Number(month.slice(0, 4)), sort: 'date' }),
    enabled: can('org.read'),
    staleTime: 60_000,
  });

  const monthHolidays = holidays.data?.data.filter((h) => h.date.slice(0, 7) === month) ?? [];

  return (
    <Stagger className="space-y-6">
      <FadeInItem>
        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <CardTitle>Who's off · {monthLabel(month)}</CardTitle>
                <CardDescription>Approved leave visible to you</CardDescription>
              </div>
              <div className="flex items-center gap-1">
                <IconAction
                  label="Previous month"
                  icon={ChevronLeft}
                  variant="outline"
                  size="icon"
                  onClick={() => setMonth(shiftMonth(month, -1))}
                />
                <IconAction
                  label="Next month"
                  icon={ChevronRight}
                  variant="outline"
                  size="icon"
                  onClick={() => setMonth(shiftMonth(month, 1))}
                />
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-2">
            {calendar.isLoading && <Skeleton className="h-24 w-full rounded-xl" />}
            {!calendar.isLoading && calendar.data?.requests.length === 0 && (
              <div className="flex flex-col items-center gap-2 py-10 text-center">
                <CalendarOff className="size-8 text-muted-foreground/50" aria-hidden />
                <p className="font-medium text-sm">Nobody is off this month</p>
              </div>
            )}
            {calendar.data?.requests.map((r) => (
              <div
                key={r.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl border p-3"
              >
                <div className="min-w-0">
                  <p className="truncate font-medium text-sm">
                    {r.employee ? `${r.employee.firstName} ${r.employee.lastName}` : 'You'}
                  </p>
                  <p className="text-muted-foreground text-xs tabular-nums">
                    {formatRange(r.startDate, r.endDate)} · {formatDays(r.days)} ·{' '}
                    {r.leaveType?.name}
                  </p>
                </div>
                <LeaveStatusChip status={r.status} />
              </div>
            ))}
          </CardContent>
        </Card>
      </FadeInItem>

      {can('org.read') && (
        <FadeInItem>
          <Card>
            <CardHeader>
              <CardTitle>Company holidays · {monthLabel(month)}</CardTitle>
              <CardDescription>These days never consume leave balance</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {monthHolidays.length === 0 && (
                <p className="py-6 text-center text-muted-foreground text-sm">
                  No holidays this month.
                </p>
              )}
              {monthHolidays.map((h) => (
                <div key={h.id} className="flex items-center gap-3 rounded-xl border p-3">
                  <span className="gradient-primary flex size-9 shrink-0 items-center justify-center rounded-lg text-white">
                    <Palmtree className="size-4.5" aria-hidden />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium text-sm">{h.name}</p>
                    <p className="text-muted-foreground text-xs">
                      {h.location?.name ?? 'Entire organization'}
                      {h.isOptional && ' · optional'}
                    </p>
                  </div>
                  <span className="shrink-0 rounded-lg bg-muted px-2.5 py-1 font-medium text-xs tabular-nums">
                    {dayFmt.format(new Date(h.date))}
                  </span>
                </div>
              ))}
            </CardContent>
          </Card>
        </FadeInItem>
      )}
    </Stagger>
  );
}
