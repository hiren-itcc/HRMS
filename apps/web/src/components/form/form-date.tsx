'use client';

import { DatePicker } from '@hrms/ui/components/date-picker';
import { TimePicker } from '@hrms/ui/components/time-picker';
import type { FieldPath, FieldValues, PathValue } from 'react-hook-form';
import { FormField, type FormFieldProps } from './form-base';

/**
 * The two pickers are closed components — hand-built on Popover and Combobox
 * rather than wrapping a Base UI primitive — so unlike Input they accept no
 * `name`, no `ref` and no arbitrary props. `field` cannot be spread onto them;
 * `value` and `onValueChange` are mapped by hand.
 *
 * **A limitation worth stating rather than leaving to be discovered:** neither
 * takes `onBlur`. `TimePicker` already uses its own to parse free text — typing
 * "930" and tabbing away is what turns it into "09:30" — so there is no blur to
 * borrow. `field.onBlur` therefore cannot be attached to either, and touched
 * state for these two fields comes from the change instead. In practice that is
 * the same moment for a picker, because there is no way to interact with one
 * without choosing something.
 *
 * Both store an ISO-ish string, not a `Date`: `yyyy-mm-dd` and `HH:MM`. Your
 * schema should expect that.
 */

interface PickerProps<TValues extends FieldValues, TName extends FieldPath<TValues>> {
  disabled?: boolean;
  className?: string;
  /**
   * Runs after the value is stored, for a date that has to move another one —
   * pushing a start date past the end date drags the end date with it.
   */
  onValueChange?: (value: PathValue<TValues, TName>) => void;
}

export function FormDatePicker<
  TValues extends FieldValues,
  TName extends FieldPath<TValues> = FieldPath<TValues>,
>({
  control,
  name,
  label,
  hint,
  required,
  min,
  max,
  placeholder,
  disabled,
  className,
  onValueChange,
}: FormFieldProps<TValues, TName> &
  PickerProps<TValues, TName> & {
    /** ISO `yyyy-mm-dd`. */
    min?: string | null;
    max?: string | null;
    placeholder?: string;
  }) {
  return (
    <FormField control={control} name={name} label={label} hint={hint} required={required}>
      {({ field, a11y }) => (
        <DatePicker
          {...a11y}
          value={field.value ?? ''}
          onValueChange={(next) => {
            field.onChange(next);
            onValueChange?.(next as PathValue<TValues, TName>);
          }}
          min={min}
          max={max}
          placeholder={placeholder}
          disabled={disabled}
          className={className}
        />
      )}
    </FormField>
  );
}

export function FormTimePicker<
  TValues extends FieldValues,
  TName extends FieldPath<TValues> = FieldPath<TValues>,
>({
  control,
  name,
  label,
  hint,
  required,
  step,
  placeholder,
  disabled,
  className,
  onValueChange,
}: FormFieldProps<TValues, TName> &
  PickerProps<TValues, TName> & {
    /** Minutes between offered times. 15 suits shifts; 5 suits corrections. */
    step?: number;
    placeholder?: string;
  }) {
  return (
    <FormField control={control} name={name} label={label} hint={hint} required={required}>
      {({ field, a11y }) => (
        <TimePicker
          {...a11y}
          value={field.value ?? ''}
          onValueChange={(next) => {
            field.onChange(next);
            onValueChange?.(next as PathValue<TValues, TName>);
          }}
          step={step}
          placeholder={placeholder}
          disabled={disabled}
          className={className}
        />
      )}
    </FormField>
  );
}
