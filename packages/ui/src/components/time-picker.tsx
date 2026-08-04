'use client';

import {
  Combobox,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxPopup,
} from '@hrms/ui/components/combobox';
import { cn } from '@hrms/ui/lib/utils';
import * as React from 'react';

/*
 * coss ships no time field, so this is its sibling to `date-picker.tsx` and
 * exists for the same reason that one does.
 *
 * It speaks `HH:MM` strings rather than Date objects, matching `timeHHmm` in
 * the shared schemas and every API payload that carries a clock time. A time
 * of day is not a moment — a shift starting at 09:30 starts at 09:30 in every
 * timezone — so putting it in a Date would invent an offset the domain does
 * not have, and the day-close job would read it back an hour out under DST.
 */

/** 24-hour `HH:MM`, the only shape the schemas accept. */
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

export function isValidTime(value?: string | null): boolean {
  return typeof value === 'string' && HHMM.test(value);
}

/** `09:30` → `9:30 am`. Fixed format, not locale — the same reasoning as
 *  formatDisplayDate: a locale format renders differently server and client
 *  and causes a hydration mismatch. */
export function formatDisplayTime(value?: string | null): string {
  if (!isValidTime(value)) return '';
  const [h, m] = (value as string).split(':').map(Number) as [number, number];
  const suffix = h < 12 ? 'am' : 'pm';
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:${String(m).padStart(2, '0')} ${suffix}`;
}

/**
 * Accepts what people actually type — `9`, `930`, `9:3`, `0930`, `9.30` — and
 * returns `HH:MM`, or undefined when it cannot be read as a time.
 *
 * Without this the control would be a dropdown only, and reaching 18:37 in a
 * list stepped every fifteen minutes is impossible.
 */
export function parseTimeInput(raw: string): string | undefined {
  const text = raw.trim().toLowerCase();
  if (!text) return undefined;

  const meridiem = text.endsWith('pm') ? 'pm' : text.endsWith('am') ? 'am' : undefined;
  const digits = text.replace(/[^0-9]/g, '');
  if (!digits) return undefined;

  let hours: number;
  let minutes: number;
  if (digits.length <= 2) {
    hours = Number(digits);
    minutes = 0;
  } else {
    minutes = Number(digits.slice(-2));
    hours = Number(digits.slice(0, -2));
  }

  if (meridiem === 'pm' && hours < 12) hours += 12;
  if (meridiem === 'am' && hours === 12) hours = 0;
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return undefined;
  if (hours > 23 || minutes > 59) return undefined;

  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

interface TimeOption {
  value: string;
  label: string;
}

function buildOptions(stepMinutes: number): TimeOption[] {
  const options: TimeOption[] = [];
  for (let minute = 0; minute < 24 * 60; minute += stepMinutes) {
    const value = `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(
      minute % 60,
    ).padStart(2, '0')}`;
    options.push({ value, label: formatDisplayTime(value) });
  }
  return options;
}

export interface TimePickerProps {
  /** `HH:MM`, or empty/null for no selection. */
  value?: string | null;
  onValueChange: (value: string) => void;
  /** Minutes between offered times. 15 covers shifts; 5 suits corrections. */
  step?: number;
  placeholder?: string;
  disabled?: boolean;
  id?: string;
  className?: string;
  'aria-invalid'?: boolean;
  'aria-required'?: boolean;
  'aria-describedby'?: string;
  'aria-label'?: string;
}

export function TimePicker({
  value,
  onValueChange,
  step = 15,
  placeholder = 'Pick a time',
  disabled,
  id,
  className,
  ...aria
}: TimePickerProps): React.ReactElement {
  const options = React.useMemo(() => buildOptions(step), [step]);

  /*
   * A time the user typed that is not on the step boundary still has to be
   * selectable, so it joins the list rather than being rejected — 09:07 is a
   * perfectly good clock-in.
   */
  const items = React.useMemo(() => {
    if (!isValidTime(value) || options.some((o) => o.value === value)) return options;
    const extra = { value: value as string, label: formatDisplayTime(value) };
    return [...options, extra].sort((a, b) => a.value.localeCompare(b.value));
  }, [options, value]);

  const selected = items.find((item) => item.value === value) ?? null;

  return (
    <Combobox
      items={items}
      value={selected}
      disabled={disabled}
      autoHighlight
      onValueChange={(next: TimeOption | null) => {
        if (next) onValueChange(next.value);
      }}
    >
      <ComboboxInput
        id={id}
        placeholder={placeholder}
        className={cn('w-full', className)}
        {...aria}
        onFocus={(event) => event.currentTarget.select()}
        /*
         * Committing on blur is what makes typing work at all: the combobox
         * only fires onValueChange when a *listed* item is chosen, so a typed
         * "9:07" would otherwise be discarded the moment focus left.
         */
        onBlur={(event) => {
          const parsed = parseTimeInput(event.currentTarget.value);
          if (parsed && parsed !== value) onValueChange(parsed);
        }}
      />
      <ComboboxPopup>
        <ComboboxEmpty>Type a time like 9:30 or 18:00.</ComboboxEmpty>
        <ComboboxList>
          {(item: TimeOption) => (
            <ComboboxItem key={item.value} value={item}>
              {item.label}
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxPopup>
    </Combobox>
  );
}
