'use client';

import {
  Combobox,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxPopup,
} from '@hrms/ui/components/combobox';
import { useMemo } from 'react';

/**
 * Timezone picker.
 *
 * Was an `<Input list>` + `<datalist>`: the browser's native combobox, which
 * offers no keyboard model worth the name, cannot be styled, and silently
 * accepts anything typed — including a timezone that does not exist.
 *
 * coss `Combobox` is the primitive for choosing from a fixed list that is too
 * long to scroll, which is exactly 400-odd IANA zones.
 */

/** `Asia/Kolkata` → `GMT+5:30`, for the secondary line on each row. */
function offsetLabel(timeZone: string): string {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      timeZoneName: 'shortOffset',
    }).formatToParts(new Date());
    return parts.find((part) => part.type === 'timeZoneName')?.value ?? '';
  } catch {
    return '';
  }
}

export interface TimezoneFieldProps {
  /** A location's timezone is optional, so this may be absent. */
  value: string | null | undefined;
  onValueChange: (value: string) => void;
  disabled?: boolean;
  placeholder?: string;
  id?: string;
  'aria-invalid'?: boolean;
  'aria-required'?: boolean;
  'aria-describedby'?: string;
}

export function TimezoneField({
  value,
  onValueChange,
  disabled,
  placeholder = 'Search timezones…',
  id,
  ...aria
}: TimezoneFieldProps) {
  // Both the zone list and every offset are computed once: building ~400
  // Intl.DateTimeFormat instances on each keystroke would make the field
  // stutter as you type.
  const zones = useMemo(
    () =>
      Intl.supportedValuesOf('timeZone').map((zone) => ({
        zone,
        offset: offsetLabel(zone),
      })),
    [],
  );
  const offsets = useMemo(() => new Map(zones.map(({ zone, offset }) => [zone, offset])), [zones]);
  const items = useMemo(() => zones.map(({ zone }) => zone), [zones]);

  return (
    <Combobox
      items={items}
      // Never undefined: Base UI decides controlled-ness on the first render,
      // and an absent location timezone would start this uncontrolled and then
      // flip it the moment someone picks a zone.
      value={value ?? ''}
      onValueChange={(next) => onValueChange(next ?? '')}
      disabled={disabled}
    >
      <ComboboxInput id={id} placeholder={placeholder} showClear {...aria} />
      <ComboboxPopup>
        <ComboboxEmpty>No timezone matches that.</ComboboxEmpty>
        <ComboboxList>
          {(zone: string) => (
            <ComboboxItem key={zone} value={zone}>
              <span className="flex-1 truncate">{zone}</span>
              <span className="shrink-0 text-muted-foreground text-xs tabular-nums">
                {offsets.get(zone)}
              </span>
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxPopup>
    </Combobox>
  );
}
