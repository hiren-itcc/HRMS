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
import { Loader2, LogIn, LogOut, MapPinOff, Timer } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { errorMessage } from '@/hooks/use-crud';
import {
  attendanceApi,
  formatDuration,
  getPosition,
  openSessionOf,
  punchBody,
  sessionMinutes,
  timeIn,
} from '../api';
import { AttendanceStatusBadge } from './status-badge';
import { VerificationChip, WorkModeChip } from './work-mode-chip';

/**
 * Thrown when the browser asked and got nothing back. Carried through the
 * mutation's error path so the card can say something the person can act on,
 * rather than the generic failure message an API error would produce.
 */
class PositionRefused extends Error {
  constructor() {
    super('Location is needed to clock in or out');
    this.name = 'PositionRefused';
  }
}

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
  const [refused, setRefused] = useState(false);

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

  /*
   * Awaited by both punches rather than fired and forgotten. React Query marks
   * a mutation settled only once `onSuccess` resolves, so waiting here keeps
   * the spinner up until the card can actually tell you which side of the
   * punch you are on — otherwise the button snaps back to "Clock in" for a
   * beat after you have already clocked in, which invites a second press.
   */
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['attendance'] });

  /*
   * The position is asked for when the button is pressed, never on page load.
   * A permission prompt that appears before the person has done anything is the
   * surest way to a permanent refusal — and a refusal now costs them the punch,
   * so the timing matters more than it did.
   */
  const requirePosition = async () => {
    const result = await getPosition();
    if (result.status === 'refused') throw new PositionRefused();
    setRefused(false);
    return punchBody(result);
  };

  const onPunchError = (err: unknown, fallback: string) => {
    if (err instanceof PositionRefused) {
      setRefused(true);
      return;
    }
    toast.error(errorMessage(err, fallback));
  };

  const clockIn = useMutation({
    mutationFn: async () => attendanceApi.checkIn(await requirePosition()),
    onSuccess: async (entry) => {
      toast.success(entry.isLate ? 'Clocked in — marked late' : 'Clocked in');
      await invalidate();
    },
    onError: (err) => onPunchError(err, 'Could not clock in'),
  });

  const clockOut = useMutation({
    mutationFn: async () => attendanceApi.checkOut(await requirePosition()),
    onSuccess: async (entry) => {
      toast.success(`Clocked out — ${formatDuration(entry.workMinutes)} logged today`);
      await invalidate();
    },
    onError: (err) => onPunchError(err, 'Could not clock out'),
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
              {clockOut.isPending ? (
                <Loader2 className="size-4.5 animate-spin" aria-hidden />
              ) : (
                <LogOut className="size-4.5" aria-hidden />
              )}
              Clock out
            </Button>
          ) : (
            <Button
              size="lg"
              className="min-h-11 w-full sm:w-auto"
              disabled={clockIn.isPending}
              onClick={() => clockIn.mutate()}
            >
              {clockIn.isPending ? (
                <Loader2 className="size-4.5 animate-spin" aria-hidden />
              ) : (
                <LogIn className="size-4.5" aria-hidden />
              )}
              {state.sessions.length ? 'Clock back in' : 'Clock in'}
            </Button>
          )}
        </div>

        {refused ? (
          <div
            role="alert"
            className="flex items-start gap-2 border-t pt-3 text-amber-600 text-xs dark:text-amber-500"
          >
            <MapPinOff className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            <span>
              Your location is needed to clock in or out, and the browser did not provide it. Allow
              location for this site and try again — you may need to check the address bar or your
              browser settings.
            </span>
          </div>
        ) : (
          <p className="border-t pt-3 text-muted-foreground text-xs">
            Where you are decides whether the day counts as office or remote. It is read at the
            moment you clock in or out, never in between, and a day away from the office keeps no
            coordinates.
          </p>
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
