'use client';

import { Button } from '@hrms/ui/components/button';
import { Popover, PopoverPopup, PopoverTrigger } from '@hrms/ui/components/popover';
import { cn } from '@hrms/ui/lib/utils';
import { CalendarIcon, ChevronLeft, ChevronRight } from 'lucide-react';
import * as React from 'react';

/*
 * A month field, because `<input type="month">` is not one anywhere it matters.
 *
 * The native control renders the browser's own popup — its own accent colour,
 * its own type scale, its own Clear/This-month affordances — sitting inside a
 * form where every other control is ours. It cannot be styled, it differs
 * between browsers, and Safari has never implemented it at all, so on that
 * browser the field silently degrades to a plain text box.
 *
 * Built as `DatePicker`'s sibling and deliberately not as a variant of it: the
 * calendar's whole apparatus — day grid, week offsets, searchable year
 * combobox — answers questions a month field does not have. Twelve buttons and
 * a year stepper is the entire requirement.
 *
 * It speaks ISO `yyyy-mm` strings for the same reason `DatePicker` speaks
 * `yyyy-mm-dd`: that is what every schema, query string and API payload here
 * already uses.
 */

const MONTHS_SHORT = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

const MONTHS_LONG = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/** `{ year, month }` with month 1-12, or undefined when the string is not a month. */
export function parseISOMonth(value?: string | null): { year: number; month: number } | undefined {
  if (!value) return undefined;
  const match = /^(\d{4})-(\d{2})$/.exec(value);
  if (!match) return undefined;
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (month < 1 || month > 12) return undefined;
  return { year, month };
}

export function toISOMonth(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, '0')}`;
}

/**
 * `August 2026` — a named month, and a fixed one.
 *
 * Same reasoning as `formatDisplayDate`: a locale-dependent format is a
 * hydration mismatch waiting to happen, because the server and the browser need
 * not agree on a locale. `2026-08` is also not a thing to show somebody.
 */
export function formatDisplayMonth(value?: string | null): string {
  const parsed = parseISOMonth(value);
  if (!parsed) return '';
  return `${MONTHS_LONG[parsed.month - 1]} ${parsed.year}`;
}

/** Comparable as a number, so range checks are arithmetic rather than string maths. */
const ordinal = (year: number, month: number) => year * 12 + (month - 1);

export interface MonthPickerProps {
  /** ISO `yyyy-mm`, or empty/null for no selection. */
  value?: string | null;
  onValueChange: (value: string) => void;
  /** Earliest selectable month, ISO `yyyy-mm`. */
  min?: string | null;
  /** Latest selectable month, ISO `yyyy-mm`. */
  max?: string | null;
  placeholder?: string;
  disabled?: boolean;
  id?: string;
  className?: string;
  'aria-invalid'?: boolean;
  'aria-required'?: boolean;
  'aria-describedby'?: string;
  'aria-label'?: string;
}

export function MonthPicker({
  value,
  onValueChange,
  min,
  max,
  placeholder = 'Pick a month',
  disabled,
  id,
  className,
  ...aria
}: MonthPickerProps): React.ReactElement {
  const [open, setOpen] = React.useState(false);
  const selected = parseISOMonth(value);

  const minMonth = parseISOMonth(min);
  const maxMonth = parseISOMonth(max);
  const lowest = minMonth ? ordinal(minMonth.year, minMonth.month) : Number.NEGATIVE_INFINITY;
  const highest = maxMonth ? ordinal(maxMonth.year, maxMonth.month) : Number.POSITIVE_INFINITY;

  /*
   * Which year the grid is showing. Follows the selection while the popup is
   * closed, so re-opening always lands on the chosen month rather than wherever
   * the user last browsed to and abandoned.
   */
  const [year, setYear] = React.useState(() => selected?.year ?? new Date().getFullYear());
  React.useEffect(() => {
    if (!open) setYear(selected?.year ?? new Date().getFullYear());
  }, [open, selected?.year]);

  // A year with no selectable month in it is a dead end, so the arrow that
  // would reach it is disabled rather than leaving twelve greyed-out buttons.
  const hasAnyIn = (candidate: number) =>
    ordinal(candidate, 12) >= lowest && ordinal(candidate, 1) <= highest;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            variant="outline"
            id={id}
            disabled={disabled}
            className={cn(
              'w-full justify-start gap-2 px-3 font-normal',
              !selected && 'text-muted-foreground',
              className,
            )}
            {...aria}
          />
        }
      >
        <CalendarIcon className="size-4 shrink-0 opacity-70" aria-hidden />
        <span className="flex-1 truncate text-left">
          {selected ? formatDisplayMonth(value) : placeholder}
        </span>
      </PopoverTrigger>

      <PopoverPopup className="w-64 p-3" align="start">
        <div className="mb-2 flex items-center justify-between gap-2">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={`Show ${year - 1}`}
            disabled={!hasAnyIn(year - 1)}
            onClick={() => setYear(year - 1)}
          >
            <ChevronLeft className="size-4" aria-hidden />
          </Button>
          {/* Announced as a live region so stepping the year is audible to a
              screen reader — the grid below it changes without moving focus. */}
          <span aria-live="polite" className="font-medium text-sm tabular-nums">
            {year}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={`Show ${year + 1}`}
            disabled={!hasAnyIn(year + 1)}
            onClick={() => setYear(year + 1)}
          >
            <ChevronRight className="size-4" aria-hidden />
          </Button>
        </div>

        <div className="grid grid-cols-3 gap-1">
          {MONTHS_SHORT.map((label, index) => {
            const month = index + 1;
            const at = ordinal(year, month);
            const isSelected = selected?.year === year && selected.month === month;
            return (
              <Button
                key={label}
                type="button"
                variant={isSelected ? 'default' : 'ghost'}
                size="sm"
                // The full name and year, because "Aug" alone tells a screen
                // reader nothing about which year the grid is on.
                aria-label={`${MONTHS_LONG[index]} ${year}`}
                aria-current={isSelected ? 'true' : undefined}
                disabled={at < lowest || at > highest}
                onClick={() => {
                  onValueChange(toISOMonth(year, month));
                  setOpen(false);
                }}
              >
                {label}
              </Button>
            );
          })}
        </div>
      </PopoverPopup>
    </Popover>
  );
}
