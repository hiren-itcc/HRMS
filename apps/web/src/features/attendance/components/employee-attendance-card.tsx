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
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useState } from 'react';
import { IconAction } from '@/components/icon-action';
import { attendanceApi } from '@/features/attendance/api';
import { AttendanceCalendar } from '@/features/attendance/components/attendance-calendar';
import { AttendanceStatusBadge } from '@/features/attendance/components/status-badge';

/**
 * One employee's attendance month, on their HR record — the tab docs/05 lists
 * on screen 10.
 *
 * `GET /attendance/employees/:id` has existed since the attendance module
 * shipped and nothing called it, so the record showed contracts and salary but
 * not whether the person turns up.
 *
 * Read-only on purpose. There is no admin attendance editor anywhere, and the
 * API has no endpoint for one — corrections go through the request-and-approve
 * flow so the change carries a reason and an approver.
 */

function monthKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function shiftMonth(month: string, by: number): string {
  const [y, m] = month.split('-').map(Number);
  return monthKey(new Date(y ?? 1970, (m ?? 1) - 1 + by, 1));
}

function monthLabel(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return new Date(y ?? 1970, (m ?? 1) - 1, 1).toLocaleDateString(undefined, {
    month: 'long',
    year: 'numeric',
  });
}

export function EmployeeAttendanceCard({ employeeId }: { employeeId: string }) {
  const [month, setMonth] = useState(() => monthKey(new Date()));
  const [selected, setSelected] = useState<string | undefined>();

  const query = useQuery({
    queryKey: ['attendance', 'employee', employeeId, month],
    queryFn: () => attendanceApi.employeeMonth(employeeId, month),
  });

  const day = query.data?.days.find((d) => d.date === selected);
  const isCurrentMonth = month === monthKey(new Date());

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle>Attendance</CardTitle>
            <CardDescription>
              Corrections are raised and approved by the employee and their manager, not edited here
            </CardDescription>
          </div>
          <div className="flex items-center gap-1">
            <IconAction
              label="Previous month"
              icon={ChevronLeft}
              size="icon-sm"
              onClick={() => {
                setMonth(shiftMonth(month, -1));
                setSelected(undefined);
              }}
            />
            <span className="min-w-32 text-center font-medium text-sm">{monthLabel(month)}</span>
            <IconAction
              label="Next month"
              icon={ChevronRight}
              size="icon-sm"
              onClick={() => {
                setMonth(shiftMonth(month, 1));
                setSelected(undefined);
              }}
              disabled={isCurrentMonth}
            />
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {query.isPending ? (
          <Skeleton className="h-64 w-full" />
        ) : query.isError ? (
          <p className="text-destructive-text text-sm">
            Could not load attendance.{' '}
            <button type="button" className="underline" onClick={() => query.refetch()}>
              Try again
            </button>
          </p>
        ) : (
          <>
            <AttendanceCalendar
              days={query.data.days}
              selected={selected}
              onSelect={(d) => setSelected(d.date === selected ? undefined : d.date)}
            />
            {day && (
              <div className="rounded-xl border p-3 text-sm">
                <div className="flex items-center justify-between gap-3">
                  <span className="font-medium">
                    {new Date(day.date).toLocaleDateString(undefined, {
                      weekday: 'long',
                      day: 'numeric',
                      month: 'long',
                    })}
                  </span>
                  <AttendanceStatusBadge
                    status={day.status}
                    isLate={day.isLate}
                    remoteApproved={day.remoteApproved}
                  />
                </div>
                {day.sessions.length > 0 ? (
                  <ul className="mt-2 space-y-1 text-muted-foreground text-xs tabular-nums">
                    {day.sessions.map((s) => (
                      <li key={s.id}>
                        {s.checkIn.slice(11, 16)} – {s.checkOut ? s.checkOut.slice(11, 16) : 'open'}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-2 text-muted-foreground text-xs">No sessions recorded.</p>
                )}
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
