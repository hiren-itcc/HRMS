'use client';

import { Button } from '@hrms/ui/components/button';
import { Card, CardContent, CardHeader, CardTitle } from '@hrms/ui/components/card';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useEffect, useState } from 'react';
import { timesheetKeys, timesheetsApi } from '@/features/projects/api';
import { TimesheetStatusBadge } from '@/features/projects/components/project-badges';
import {
  type Cells,
  cellsFromEntries,
  cellsToEntries,
  WeekGrid,
} from '@/features/projects/components/week-grid';
import { useApiMutation } from '@/hooks/use-crud';

/**
 * My week.
 *
 * The week is chosen in the URL-free way — local state, because it is a cursor
 * rather than a location somebody links to. Every other date in this module is
 * a `YYYY-MM-DD` string and so is this one; there is no `Date` in the state.
 */

/** The Monday of the week containing today, computed the same way the API does. */
function currentWeekStart(): string {
  const now = new Date();
  const utc = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
  const day = utc.getUTCDay();
  utc.setUTCDate(utc.getUTCDate() - (day === 0 ? 6 : day - 1));
  return utc.toISOString().slice(0, 10);
}

function shiftWeek(weekStart: string, weeks: number): string {
  const date = new Date(`${weekStart}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + weeks * 7);
  return date.toISOString().slice(0, 10);
}

export default function MyTimesheetPage() {
  const [weekStart, setWeekStart] = useState(currentWeekStart);
  const [cells, setCells] = useState<Cells>(new Map());

  const query = useQuery({
    queryKey: timesheetKeys.week(weekStart),
    queryFn: () => timesheetsApi.week(weekStart),
  });

  const week = query.data;
  const sheet = week?.timesheet ?? null;
  const editable = !sheet || sheet.status === 'DRAFT' || sheet.status === 'REJECTED';

  // Server state seeds the grid whenever the week changes or a mutation
  // refetches. Typing after that is local until Save.
  useEffect(() => {
    setCells(cellsFromEntries(sheet?.entries ?? []));
  }, [sheet]);

  const invalidate = [timesheetKeys.all()];

  const save = useApiMutation({
    mutationFn: () => timesheetsApi.saveWeek({ weekStart, entries: cellsToEntries(cells) }),
    invalidate,
    success: 'Week saved',
  });

  const submit = useApiMutation({
    mutationFn: async () => {
      // Save first, unconditionally. Submitting what is on screen rather than
      // what was last saved is the only behaviour that is not surprising.
      const saved = await timesheetsApi.saveWeek({ weekStart, entries: cellsToEntries(cells) });
      return timesheetsApi.submit(saved.id);
    },
    invalidate,
    success: 'Week sent to your manager',
  });

  const withdraw = useApiMutation({
    mutationFn: (id: string) => timesheetsApi.withdraw(id),
    invalidate,
    success: 'Week pulled back',
  });

  const busy = save.isPending || submit.isPending || withdraw.isPending;

  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-center justify-between gap-3">
        <CardTitle className="flex items-center gap-3">
          <span className="tabular-nums">Week of {weekStart}</span>
          {sheet && <TimesheetStatusBadge status={sheet.status} />}
        </CardTitle>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="icon"
            aria-label="Previous week"
            onClick={() => setWeekStart(shiftWeek(weekStart, -1))}
          >
            <ChevronLeft className="size-4" aria-hidden />
          </Button>
          <Button variant="outline" size="sm" onClick={() => setWeekStart(currentWeekStart())}>
            This week
          </Button>
          <Button
            variant="outline"
            size="icon"
            aria-label="Next week"
            onClick={() => setWeekStart(shiftWeek(weekStart, 1))}
          >
            <ChevronRight className="size-4" aria-hidden />
          </Button>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {sheet?.status === 'REJECTED' && sheet.decisionNote && (
          <p className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">
            <span className="font-medium">Sent back:</span> {sheet.decisionNote}
          </p>
        )}

        {query.isError ? (
          <p className="text-destructive-text text-sm">
            That week could not be loaded.{' '}
            <button type="button" className="underline" onClick={() => query.refetch()}>
              Try again
            </button>
          </p>
        ) : (
          <WeekGrid
            days={week?.days ?? []}
            projects={week?.projects ?? []}
            cells={cells}
            readOnly={!editable || busy}
            onChange={setCells}
          />
        )}

        <div className="flex flex-wrap justify-end gap-2">
          {editable && (
            <>
              <Button variant="outline" disabled={busy} onClick={() => save.mutate(undefined)}>
                Save draft
              </Button>
              <Button disabled={busy} onClick={() => submit.mutate(undefined)}>
                Submit the week
              </Button>
            </>
          )}
          {sheet?.status === 'SUBMITTED' && (
            <Button variant="outline" disabled={busy} onClick={() => withdraw.mutate(sheet.id)}>
              Pull it back
            </Button>
          )}
          {sheet?.status === 'APPROVED' && (
            <p className="self-center text-muted-foreground text-sm">
              Approved — ask your manager to send it back if it needs changing.
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
