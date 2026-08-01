'use client';

import type { DropdownProps } from '@daypicker/react';
import { Button } from '@hrms/ui/components/button';
import { Calendar } from '@hrms/ui/components/calendar';
import {
  Combobox,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxPopup,
} from '@hrms/ui/components/combobox';
import { Popover, PopoverPopup, PopoverTrigger } from '@hrms/ui/components/popover';
import { cn } from '@hrms/ui/lib/utils';
import { CalendarIcon } from 'lucide-react';
import * as React from 'react';

/*
 * coss ships `Calendar` (a DayPicker wrapper) but no date *field*, so this is
 * the documented Popover + Calendar composition packaged as one control.
 *
 * It speaks ISO `yyyy-mm-dd` strings rather than Date objects on purpose:
 * every form, zod schema and API payload in this app already uses that shape,
 * and a picker that handed back Date objects would push conversion into
 * eighteen call sites.
 */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * `new Date('2026-08-01')` is parsed as UTC midnight, which renders as
 * 31 July anywhere west of Greenwich. Building the date from its parts keeps
 * it local, so the day shown is the day stored.
 */
export function parseISODate(value?: string | null): Date | undefined {
  if (!value) return undefined;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!match) return undefined;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(year, month - 1, day);
  // The Date constructor rolls impossible dates over — 2026-02-29 becomes
  // 1 March — so a date that did not survive the trip is rejected rather than
  // silently shown as a different day.
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    return undefined;
  }
  return date;
}

/** Local calendar date as `yyyy-mm-dd` — never `toISOString`, which shifts. */
export function toISODate(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * `1 Aug 2026`, not the browser's locale format.
 *
 * The native input rendered `01/08/2026`, which is genuinely ambiguous — the
 * 1st of August to most of the world and the 8th of January to some of it.
 * A named month cannot be misread. A fixed format also avoids the hydration
 * mismatch a locale-dependent one would cause, since the server and the
 * browser need not agree on a locale.
 */
export function formatDisplayDate(value?: string | null): string {
  const date = parseISODate(value);
  if (!date) return '';
  return `${date.getDate()} ${MONTHS[date.getMonth()]} ${date.getFullYear()}`;
}

interface DropdownItem {
  value: string;
  label: string;
  disabled?: boolean;
}

/**
 * Month and year navigation as searchable comboboxes rather than a native
 * `<select>` or a pair of arrows.
 *
 * Arrows are fine for "next month" and hopeless for a date of birth — reaching
 * 1987 from today is 460 clicks. Typing "1987" is one. DayPicker's own
 * `Dropdown` renders the entire dropdown root, so replacing it swaps the whole
 * control rather than nesting one inside another.
 */
function CalendarDropdown({ options, value, onChange, 'aria-label': ariaLabel }: DropdownProps) {
  const items: DropdownItem[] =
    options?.map((option) => ({
      value: option.value.toString(),
      label: option.label,
      disabled: option.disabled,
    })) ?? [];
  const selected = items.find((item) => item.value === value?.toString());

  return (
    <Combobox
      aria-label={ariaLabel}
      autoHighlight
      items={items}
      value={selected}
      onValueChange={(next: DropdownItem | null) => {
        if (!next) return;
        // DayPicker expects a change event off a <select>, which is what it
        // would have rendered. Nothing downstream reads any other field.
        onChange?.({
          target: { value: next.value },
        } as React.ChangeEvent<HTMLSelectElement>);
      }}
    >
      <ComboboxInput
        className="**:[input]:w-0 **:[input]:flex-1"
        // Select-on-focus so typing replaces the month rather than appending
        // to it — the field is pre-filled with the current one.
        onFocus={(event) => event.currentTarget.select()}
      />
      <ComboboxPopup aria-label={ariaLabel}>
        <ComboboxEmpty>Nothing matches that.</ComboboxEmpty>
        <ComboboxList>
          {(item: DropdownItem) => (
            <ComboboxItem key={item.value} value={item} disabled={item.disabled}>
              {item.label}
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxPopup>
    </Combobox>
  );
}

export interface DatePickerProps {
  /** ISO `yyyy-mm-dd`, or empty/null for no selection. */
  value?: string | null;
  onValueChange: (value: string) => void;
  /** Earliest selectable date, ISO. */
  min?: string | null;
  /** Latest selectable date, ISO. */
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

export function DatePicker({
  value,
  onValueChange,
  min,
  max,
  placeholder = 'Pick a date',
  disabled,
  id,
  className,
  ...aria
}: DatePickerProps): React.ReactElement {
  const [open, setOpen] = React.useState(false);
  const selected = parseISODate(value);
  const minDate = parseISODate(min);
  const maxDate = parseISODate(max);

  const outOfRange = [
    ...(minDate ? [{ before: minDate }] : []),
    ...(maxDate ? [{ after: maxDate }] : []),
  ];

  /*
   * The year list the dropdown offers. Bounded by min/max where a field has
   * them, and otherwise generous in both directions — the same control is used
   * for a date of birth (decades back) and a payroll effective date (this
   * year). A long list costs nothing here because the dropdown is searchable;
   * a list that is too short makes a date unreachable, which is worse.
   */
  const today = new Date();
  const startMonth = minDate ?? new Date(today.getFullYear() - 100, 0);
  const endMonth = maxDate ?? new Date(today.getFullYear() + 10, 11);

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
          {selected ? formatDisplayDate(value) : placeholder}
        </span>
      </PopoverTrigger>
      <PopoverPopup className="w-auto p-0" align="start">
        <Calendar
          mode="single"
          autoFocus
          captionLayout="dropdown"
          components={{ Dropdown: CalendarDropdown }}
          startMonth={startMonth}
          endMonth={endMonth}
          selected={selected}
          defaultMonth={selected ?? minDate}
          disabled={outOfRange.length ? outOfRange : undefined}
          onSelect={(date: Date | undefined) => {
            // Re-picking the selected day clears it in DayPicker; the fields
            // here are either required or cleared elsewhere, so treat that as
            // "no change" rather than silently emptying the field.
            if (!date) return;
            onValueChange(toISODate(date));
            setOpen(false);
          }}
        />
      </PopoverPopup>
    </Popover>
  );
}
