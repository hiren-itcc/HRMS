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
import { motion, useReducedMotion } from 'framer-motion';
import { LogIn, LogOut, Timer } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { ApiError } from '@/lib/api-client';
import { attendanceApi, formatDuration, timeIn } from '../api';
import { AttendanceStatusBadge } from './status-badge';

/** mm:ss / h:mm:ss elapsed, ticking every second. */
function elapsedLabel(fromIso: string, now: number): string {
  const seconds = Math.max(0, Math.floor((now - new Date(fromIso).getTime()) / 1000));
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

export function ClockCard() {
  const queryClient = useQueryClient();
  const reduceMotion = useReducedMotion();
  const [now, setNow] = useState(() => Date.now());

  const today = useQuery({
    queryKey: ['attendance', 'today'],
    queryFn: attendanceApi.today,
    retry: false,
    refetchInterval: 60_000,
  });

  const working = Boolean(today.data?.checkIn && !today.data?.checkOut);

  // Tick only while the timer is actually visible
  useEffect(() => {
    if (!working) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [working]);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['attendance'] });
  };

  const clockIn = useMutation({
    mutationFn: attendanceApi.checkIn,
    onSuccess: (entry) => {
      invalidate();
      toast.success(entry.isLate ? 'Clocked in — marked late' : 'Clocked in');
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : 'Could not clock in'),
  });

  const clockOut = useMutation({
    mutationFn: attendanceApi.checkOut,
    onSuccess: (entry) => {
      invalidate();
      toast.success(`Clocked out — ${formatDuration(entry.workMinutes)} logged`);
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : 'Could not clock out'),
  });

  // No employee record linked (e.g. the bootstrap admin) — nothing to clock
  if (today.isError) return null;
  if (today.isLoading || !today.data) {
    return <Skeleton className="h-44 w-full rounded-2xl" />;
  }

  const state = today.data;
  const done = Boolean(state.checkOut);

  return (
    <Card className="hover-lift overflow-hidden">
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <CardTitle className="text-base">Today</CardTitle>
            <CardDescription>
              {state.shift
                ? `Shift ${state.shift.startTime}–${state.shift.endTime} · ${state.timeZone}`
                : state.timeZone}
            </CardDescription>
          </div>
          <AttendanceStatusBadge status={state.status} isLate={state.isLate} />
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-6">
            <div>
              <p className="text-muted-foreground text-xs uppercase tracking-wider">In</p>
              <p className="font-semibold text-lg tabular-nums">
                {timeIn(state.checkIn, state.timeZone)}
              </p>
            </div>
            <div>
              <p className="text-muted-foreground text-xs uppercase tracking-wider">Out</p>
              <p className="font-semibold text-lg tabular-nums">
                {timeIn(state.checkOut, state.timeZone)}
              </p>
            </div>
            <div>
              <p className="text-muted-foreground text-xs uppercase tracking-wider">
                {working ? 'Elapsed' : 'Worked'}
              </p>
              <p className="flex items-center gap-1.5 font-semibold text-lg tabular-nums">
                {working && state.checkIn ? (
                  <>
                    <motion.span
                      aria-hidden
                      className="inline-block size-2 rounded-full bg-success"
                      animate={reduceMotion ? undefined : { opacity: [1, 0.35, 1] }}
                      transition={{ duration: 2, repeat: Number.POSITIVE_INFINITY }}
                    />
                    <span aria-live="off">{elapsedLabel(state.checkIn, now)}</span>
                  </>
                ) : (
                  <>
                    <Timer className="size-4 text-muted-foreground" aria-hidden />
                    {formatDuration(state.workMinutes)}
                  </>
                )}
              </p>
            </div>
          </div>

          {!state.checkIn && (
            <Button
              size="lg"
              className="min-h-11 w-full sm:w-auto"
              disabled={clockIn.isPending}
              onClick={() => clockIn.mutate()}
            >
              <LogIn className="size-4.5" aria-hidden /> Clock in
            </Button>
          )}
          {working && (
            <Button
              size="lg"
              variant="outline"
              className="min-h-11 w-full sm:w-auto"
              disabled={clockOut.isPending}
              onClick={() => clockOut.mutate()}
            >
              <LogOut className="size-4.5" aria-hidden /> Clock out
            </Button>
          )}
          {done && (
            <p className="text-muted-foreground text-sm">Day complete — see you tomorrow 👋</p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
