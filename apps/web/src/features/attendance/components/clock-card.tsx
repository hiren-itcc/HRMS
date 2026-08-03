'use client';

import { Button } from '@hrms/ui/components/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@hrms/ui/components/card';
import { Label } from '@hrms/ui/components/label';
import { Radio, RadioGroup } from '@hrms/ui/components/radio-group';
import { Skeleton } from '@hrms/ui/components/skeleton';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { motion, useReducedMotion } from 'framer-motion';
import { LogIn, LogOut, Timer } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { ApiError } from '@/lib/api-client';
import {
  attendanceApi,
  formatDuration,
  openSessionOf,
  sessionMinutes,
  timeIn,
  tryGetPosition,
  WORK_MODE_LABEL,
  type WorkMode,
} from '../api';
import { AttendanceStatusBadge } from './status-badge';
import { VerificationChip, WorkModeChip } from './work-mode-chip';

const MODES: WorkMode[] = ['OFFICE', 'REMOTE', 'CLIENT_SITE'];
/** Most people work the same way most days, so the last choice is the default. */
const MODE_STORAGE_KEY = 'hrms.workMode';

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
  const [mode, setMode] = useState<WorkMode>('OFFICE');

  // Read after mount: localStorage does not exist while this renders on the server.
  useEffect(() => {
    const saved = window.localStorage.getItem(MODE_STORAGE_KEY);
    if (saved && MODES.includes(saved as WorkMode)) setMode(saved as WorkMode);
  }, []);

  const chooseMode = (next: WorkMode) => {
    setMode(next);
    window.localStorage.setItem(MODE_STORAGE_KEY, next);
  };

  const today = useQuery({
    queryKey: ['attendance', 'today'],
    queryFn: attendanceApi.today,
    retry: false,
    refetchInterval: 60_000,
  });

  // A day is a series of sessions, so "am I in right now" is one open session
  // rather than the absence of a checkout — clocking out is never the end.
  const open = today.data ? openSessionOf(today.data) : null;
  const working = Boolean(open);

  // Tick only while the timer is actually visible
  useEffect(() => {
    if (!working) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [working]);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['attendance'] });
  };

  /*
   * The position is asked for when the button is pressed, never on page load.
   * A permission prompt that appears before the person has done anything is the
   * surest way to a permanent refusal — and `tryGetPosition` resolves to null on
   * every failure, so a refusal costs the punch nothing.
   */
  const clockIn = useMutation({
    mutationFn: async () => {
      const fix = await tryGetPosition();
      return attendanceApi.checkIn({ workMode: mode, ...(fix ?? {}) });
    },
    onSuccess: (entry) => {
      invalidate();
      toast.success(entry.isLate ? 'Clocked in — marked late' : 'Clocked in');
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : 'Could not clock in'),
  });

  const clockOut = useMutation({
    mutationFn: async () => {
      const fix = await tryGetPosition();
      return attendanceApi.checkOut(fix ?? {});
    },
    onSuccess: (entry) => {
      invalidate();
      toast.success(`Clocked out — ${formatDuration(entry.workMinutes)} logged today`);
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : 'Could not clock out'),
  });

  // No employee record linked (e.g. the bootstrap admin) — nothing to clock
  if (today.isError) return null;
  if (today.isLoading || !today.data) {
    return <Skeleton className="h-44 w-full rounded-2xl" />;
  }

  const state = today.data;

  return (
    <Card className="hover-lift overflow-hidden">
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <CardTitle>Today</CardTitle>
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
                {open ? (
                  <>
                    <motion.span
                      aria-hidden
                      className="inline-block size-2 rounded-full bg-success"
                      animate={reduceMotion ? undefined : { opacity: [1, 0.35, 1] }}
                      transition={{ duration: 2, repeat: Number.POSITIVE_INFINITY }}
                    />
                    <span aria-live="off">{elapsedLabel(open.checkIn, now)}</span>
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

          {/*
            Always one action, never a dead end: clocking out is a pause, so the
            way back in is the same button. Accidentally ending the day used to
            be unrecoverable until tomorrow.
          */}
          {open ? (
            <Button
              size="lg"
              variant="outline"
              className="min-h-11 w-full sm:w-auto"
              disabled={clockOut.isPending}
              onClick={() => clockOut.mutate()}
            >
              <LogOut className="size-4.5" aria-hidden /> Clock out
            </Button>
          ) : (
            <Button
              size="lg"
              className="min-h-11 w-full sm:w-auto"
              disabled={clockIn.isPending}
              onClick={() => clockIn.mutate()}
            >
              <LogIn className="size-4.5" aria-hidden />
              {state.sessions.length ? 'Clock back in' : 'Clock in'}
            </Button>
          )}
        </div>

        {/* Only when about to clock in — the mode belongs to the sitting you
            are opening, and you do not re-choose it on the way out. */}
        {!open && (
          <fieldset className="space-y-2 border-t pt-3">
            <legend className="mb-2 font-medium text-sm">Where are you working?</legend>
            <RadioGroup
              value={mode}
              onValueChange={(value) => chooseMode(value as WorkMode)}
              className="flex flex-wrap gap-x-5 gap-y-2"
            >
              {MODES.map((value) => (
                <div key={value} className="flex items-center gap-2">
                  <Radio id={`work-mode-${value}`} value={value} />
                  <Label htmlFor={`work-mode-${value}`} className="cursor-pointer text-sm">
                    {WORK_MODE_LABEL[value]}
                  </Label>
                </div>
              ))}
            </RadioGroup>
            <p className="text-muted-foreground text-xs">
              Your location is recorded at the moment you clock in or out, and never in between.
              {mode === 'REMOTE' && ' Remote days record no location at all.'}
            </p>
          </fieldset>
        )}

        {state.sessions.length > 0 && (
          <ul className="space-y-1.5 border-t pt-3 text-sm">
            {state.sessions.map((session, index) => (
              <li key={session.id} className="flex flex-wrap items-center justify-between gap-2">
                <span className="flex flex-wrap items-center gap-2 text-muted-foreground">
                  Session {index + 1}
                  <span className="tabular-nums">
                    {timeIn(session.checkIn, state.timeZone)} –{' '}
                    {session.checkOut ? timeIn(session.checkOut, state.timeZone) : 'now'}
                  </span>
                  <WorkModeChip mode={session.workMode} />
                  <VerificationChip session={session} />
                </span>
                <span className="tabular-nums">
                  {session.checkOut ? formatDuration(sessionMinutes(session)) : 'in progress'}
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
