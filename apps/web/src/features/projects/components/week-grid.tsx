'use client';

import { Input } from '@hrms/ui/components/input';
import { cn } from '@hrms/ui/lib/utils';
import type { LoggableProject, TimesheetEntry } from '../api';

/**
 * The week, as a grid: projects down, days across.
 *
 * Held as a plain `Map` keyed `projectId:day` rather than react-hook-form,
 * because the field set is derived from data (a variable number of projects ×
 * seven) and a form library buys nothing for a sheet of numbers that validates
 * as a whole rather than per field.
 *
 * An empty cell is not zero. Zero hours on a project is a claim that somebody
 * worked none, and the API refuses it — a blank cell is simply absent, which is
 * what a day nobody touched that project actually is.
 */

export type Cells = Map<string, string>;

export function cellKey(projectId: string, day: string): string {
  return `${projectId}:${day}`;
}

export function cellsFromEntries(entries: TimesheetEntry[]): Cells {
  return new Map(
    entries.map((entry) => [cellKey(entry.projectId, entry.workedOn), String(entry.hours)]),
  );
}

/** Only cells with a real number become entries. Blanks and junk are dropped. */
export function cellsToEntries(
  cells: Cells,
): { projectId: string; workedOn: string; hours: number }[] {
  const entries: { projectId: string; workedOn: string; hours: number }[] = [];
  for (const [key, raw] of cells) {
    const value = Number(raw);
    if (!raw.trim() || Number.isNaN(value) || value <= 0) continue;
    const [projectId = '', workedOn = ''] = key.split(':');
    entries.push({ projectId, workedOn, hours: value });
  }
  return entries;
}

function sum(values: number[]): number {
  return Math.round(values.reduce((total, value) => total + value, 0) * 100) / 100;
}

function numeric(cells: Cells, key: string): number {
  const value = Number(cells.get(key));
  return Number.isFinite(value) && value > 0 ? value : 0;
}

/** "Mon 10" — short enough for seven columns on a laptop. */
function dayLabel(day: string): { weekday: string; date: string } {
  const date = new Date(`${day}T00:00:00.000Z`);
  return {
    weekday: date.toLocaleDateString('en-IN', { weekday: 'short', timeZone: 'UTC' }),
    date: String(date.getUTCDate()),
  };
}

function isWeekend(day: string): boolean {
  const weekday = new Date(`${day}T00:00:00.000Z`).getUTCDay();
  return weekday === 0 || weekday === 6;
}

/** Was this project loggable on this day, given the membership window? */
function outsideWindow(project: LoggableProject, day: string): boolean {
  if (day < project.startsOn) return true;
  if (project.endsOn && day > project.endsOn) return true;
  if (day < project.joinedOn) return true;
  if (project.leftOn && day > project.leftOn) return true;
  return false;
}

export function WeekGrid({
  days,
  projects,
  cells,
  readOnly,
  onChange,
}: {
  days: string[];
  projects: LoggableProject[];
  cells: Cells;
  readOnly: boolean;
  onChange: (next: Cells) => void;
}) {
  const setCell = (key: string, value: string) => {
    const next = new Map(cells);
    if (value.trim() === '') next.delete(key);
    else next.set(key, value);
    onChange(next);
  };

  const dayTotal = (day: string) =>
    sum(projects.map((project) => numeric(cells, cellKey(project.id, day))));

  const weekTotal = sum(days.map(dayTotal));

  if (projects.length === 0) {
    return (
      <p className="rounded-md border border-dashed p-6 text-center text-muted-foreground text-sm">
        You are not on an open project, so there is nothing to log against yet. Ask whoever runs the
        project to add you.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[44rem] border-collapse text-sm">
        <caption className="sr-only">
          Hours per project per day for the week beginning {days[0]}
        </caption>
        <thead>
          <tr>
            <th scope="col" className="p-2 text-left font-medium">
              Project
            </th>
            {days.map((day) => {
              const { weekday, date } = dayLabel(day);
              return (
                <th
                  key={day}
                  scope="col"
                  className={cn(
                    'p-2 text-center font-medium',
                    isWeekend(day) && 'text-muted-foreground',
                  )}
                >
                  <span className="block">{weekday}</span>
                  <span className="block font-normal text-muted-foreground text-xs">{date}</span>
                </th>
              );
            })}
            <th scope="col" className="p-2 text-right font-medium">
              Total
            </th>
          </tr>
        </thead>
        <tbody>
          {projects.map((project) => (
            <tr key={project.id} className="border-t">
              <th scope="row" className="p-2 text-left font-normal">
                <span className="block font-medium">{project.code}</span>
                <span className="block text-muted-foreground text-xs">{project.name}</span>
              </th>
              {days.map((day) => {
                const key = cellKey(project.id, day);
                const blocked = outsideWindow(project, day);
                return (
                  <td key={day} className="p-1">
                    <Input
                      type="number"
                      inputMode="decimal"
                      step="0.25"
                      min="0"
                      max="24"
                      className="w-full text-center tabular-nums"
                      // Blocked rather than merely refused on submit: a cell you
                      // cannot type in explains the membership window without a
                      // paragraph about it.
                      disabled={readOnly || blocked}
                      aria-label={`${project.code}, ${day}`}
                      title={blocked ? 'You were not on this project on this day' : undefined}
                      value={cells.get(key) ?? ''}
                      onChange={(event) => setCell(key, event.target.value)}
                    />
                  </td>
                );
              })}
              <td className="p-2 text-right tabular-nums">
                {sum(days.map((day) => numeric(cells, cellKey(project.id, day)))) || '—'}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t font-medium">
            <th scope="row" className="p-2 text-left">
              Total
            </th>
            {days.map((day) => {
              const total = dayTotal(day);
              return (
                <td
                  key={day}
                  className={cn(
                    'p-2 text-center tabular-nums',
                    // Over 24 is refused on submit; saying so here is what stops
                    // somebody discovering it after filling the whole week.
                    total > 24 && 'text-destructive-text',
                  )}
                >
                  {total || '—'}
                </td>
              );
            })}
            <td className="p-2 text-right tabular-nums">{weekTotal || '—'}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
