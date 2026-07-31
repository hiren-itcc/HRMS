'use client';

import { Button } from '@hrms/ui/components/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@hrms/ui/components/card';
import { Skeleton } from '@hrms/ui/components/skeleton';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarPlus, ChevronLeft, ChevronRight, X } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { FadeInItem, Stagger } from '@/components/motion';
import {
  attendanceApi,
  currentMonth,
  type DayEntry,
  formatDuration,
  shiftMonth,
  timeIn,
} from '@/features/attendance/api';
import { AttendanceCalendar } from '@/features/attendance/components/attendance-calendar';
import { ClockCard } from '@/features/attendance/components/clock-card';
import { CorrectionDialog } from '@/features/attendance/components/correction-dialog';
import { RequestStatusChip } from '@/features/attendance/components/request-status-chip';
import { AttendanceStatusBadge } from '@/features/attendance/components/status-badge';
import { ApiError } from '@/lib/api-client';

const monthLabel = (month: string) =>
  new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(
    new Date(`${month}-01T00:00:00.000Z`),
  );

const dayLabel = (date: string) =>
  new Intl.DateTimeFormat(undefined, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  }).format(new Date(`${date}T00:00:00.000Z`));

function SummaryTile({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-xl border p-3">
      <p className="text-muted-foreground text-xs uppercase tracking-wider">{label}</p>
      <p className="font-semibold text-xl tabular-nums">{value}</p>
    </div>
  );
}

export default function MyAttendancePage() {
  const queryClient = useQueryClient();
  const [month, setMonth] = useState(currentMonth);
  const [selected, setSelected] = useState<DayEntry | null>(null);
  const [correctionFor, setCorrectionFor] = useState<string | null>(null);

  const data = useQuery({
    queryKey: ['attendance', 'me', month],
    queryFn: () => attendanceApi.myMonth(month),
    retry: false,
  });

  const requests = useQuery({
    queryKey: ['attendance', 'requests', 'own'],
    queryFn: () => attendanceApi.requests({ scope: 'own', limit: 10 }),
    retry: false,
  });

  const cancel = useMutation({
    mutationFn: attendanceApi.cancelRequest,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['attendance'] });
      toast.success('Request withdrawn');
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : 'Could not withdraw'),
  });

  const noEmployeeRecord = data.isError && data.error instanceof ApiError;

  return (
    <Stagger className="space-y-6">
      <FadeInItem>
        <ClockCard />
      </FadeInItem>

      {noEmployeeRecord ? (
        <FadeInItem>
          <Card>
            <CardContent className="py-10 text-center text-muted-foreground text-sm">
              No employee record is linked to this account, so there is no attendance to show.
            </CardContent>
          </Card>
        </FadeInItem>
      ) : (
        <>
          <FadeInItem>
            <Card>
              <CardHeader>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <CardTitle className="text-base">{monthLabel(month)}</CardTitle>
                    <CardDescription>
                      Tap a day for details or to raise a correction
                    </CardDescription>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="outline"
                      size="icon"
                      aria-label="Previous month"
                      onClick={() => {
                        setMonth(shiftMonth(month, -1));
                        setSelected(null);
                      }}
                    >
                      <ChevronLeft className="size-4" aria-hidden />
                    </Button>
                    <Button
                      variant="outline"
                      size="icon"
                      aria-label="Next month"
                      disabled={month >= currentMonth()}
                      onClick={() => {
                        setMonth(shiftMonth(month, 1));
                        setSelected(null);
                      }}
                    >
                      <ChevronRight className="size-4" aria-hidden />
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-5">
                {data.isLoading && <Skeleton className="h-72 w-full rounded-xl" />}
                {data.data && (
                  <>
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
                      <SummaryTile label="Present" value={data.data.summary.present} />
                      <SummaryTile label="Half days" value={data.data.summary.halfDay} />
                      <SummaryTile label="Absent" value={data.data.summary.absent} />
                      <SummaryTile label="Late marks" value={data.data.summary.lateMarks} />
                      <SummaryTile label="Holidays" value={data.data.summary.holidays} />
                      <SummaryTile
                        label="Hours"
                        value={formatDuration(data.data.summary.workedMinutes)}
                      />
                    </div>

                    <AttendanceCalendar
                      days={data.data.days}
                      selected={selected?.date}
                      onSelect={setSelected}
                    />

                    {selected && (
                      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-muted/40 p-4">
                        <div className="space-y-1">
                          <p className="flex flex-wrap items-center gap-2 font-medium text-sm">
                            {dayLabel(selected.date)}
                            <AttendanceStatusBadge
                              status={selected.status}
                              isLate={selected.isLate}
                            />
                          </p>
                          <p className="text-muted-foreground text-sm tabular-nums">
                            In {timeIn(selected.checkIn, data.data.timeZone)} · Out{' '}
                            {timeIn(selected.checkOut, data.data.timeZone)} ·{' '}
                            {formatDuration(selected.workMinutes)}
                          </p>
                          {selected.note && (
                            <p className="text-muted-foreground text-xs">{selected.note}</p>
                          )}
                        </div>
                        <div className="flex gap-2">
                          {selected.status !== 'FUTURE' && (
                            <Button size="sm" onClick={() => setCorrectionFor(selected.date)}>
                              <CalendarPlus className="size-4" aria-hidden /> Request correction
                            </Button>
                          )}
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label="Close day details"
                            onClick={() => setSelected(null)}
                          >
                            <X className="size-4" aria-hidden />
                          </Button>
                        </div>
                      </div>
                    )}
                  </>
                )}
              </CardContent>
            </Card>
          </FadeInItem>

          <FadeInItem>
            <Card>
              <CardHeader>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <CardTitle className="text-base">My correction requests</CardTitle>
                    <CardDescription>Regularizations you have raised</CardDescription>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setCorrectionFor(new Date().toISOString().slice(0, 10))}
                  >
                    <CalendarPlus className="size-4" aria-hidden /> New request
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                {requests.isLoading && <Skeleton className="h-20 w-full rounded-xl" />}
                {requests.data?.data.length === 0 && (
                  <p className="py-6 text-center text-muted-foreground text-sm">
                    No correction requests yet.
                  </p>
                )}
                <ul className="space-y-2">
                  {requests.data?.data.map((r) => (
                    <li
                      key={r.id}
                      className="flex flex-wrap items-center justify-between gap-3 rounded-xl border p-3"
                    >
                      <div className="min-w-0">
                        <p className="font-medium text-sm tabular-nums">{dayLabel(r.date)}</p>
                        <p className="truncate text-muted-foreground text-xs">{r.reason}</p>
                        {r.approverNote && (
                          <p className="truncate text-muted-foreground text-xs">
                            Reviewer: {r.approverNote}
                          </p>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <RequestStatusChip status={r.status} />
                        {r.status === 'PENDING' && (
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={cancel.isPending}
                            onClick={() => cancel.mutate(r.id)}
                          >
                            Withdraw
                          </Button>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          </FadeInItem>
        </>
      )}

      <CorrectionDialog
        open={correctionFor !== null}
        onOpenChange={(open) => !open && setCorrectionFor(null)}
        date={correctionFor ?? new Date().toISOString().slice(0, 10)}
      />
    </Stagger>
  );
}
