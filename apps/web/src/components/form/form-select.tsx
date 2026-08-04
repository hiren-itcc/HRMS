'use client';

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@hrms/ui/components/select';
import type { ReactNode } from 'react';
import type { FieldPath, FieldValues } from 'react-hook-form';
import { FormField, type FormFieldProps } from './form-base';

/**
 * Select is where copying a shadcn/Radix implementation would go wrong, in two
 * places.
 *
 * **The aria props belong on the trigger, not the root.** Base UI's Select root
 * renders no element — it is state and context — so `aria-invalid` and
 * `aria-describedby` handed to it go nowhere. Four call sites in the app pass
 * only `a11y.id` to `SelectTrigger` and drop the other three, which is how a
 * required select ends up announcing "invalid" without ever announcing why.
 *
 * **Empty is `null`, never `''`.** Base UI cannot hold an empty string as a
 * value, which is why two files each grew their own `NONE = 'none'` sentinel —
 * and mapped it back differently, one to `null` and one to `undefined`. That
 * belongs here once: pass `emptyLabel` to get the sentinel item, and
 * `emptyValue` to say which falsy value your schema wants back.
 */

const EMPTY = '__empty__';

interface FormSelectProps {
  /** Shown on the trigger before anything is chosen. */
  placeholder?: string;
  /** Renders a "none" option. Without it the select cannot be cleared. */
  emptyLabel?: string;
  /** What `emptyLabel` resolves to — your schema wants one or the other. */
  emptyValue?: null | undefined;
  disabled?: boolean;
  /** `SelectItem`s. */
  children: ReactNode;
  className?: string;
}

export function FormSelect<
  TValues extends FieldValues,
  TName extends FieldPath<TValues> = FieldPath<TValues>,
>({
  control,
  name,
  label,
  hint,
  required,
  placeholder,
  emptyLabel,
  emptyValue = null,
  disabled,
  className,
  children,
}: FormFieldProps<TValues, TName> & FormSelectProps) {
  return (
    <FormField control={control} name={name} label={label} hint={hint} required={required}>
      {({ field, a11y }) => (
        <Select
          value={field.value ?? (emptyLabel ? EMPTY : null)}
          onValueChange={(value) => field.onChange(value === EMPTY ? emptyValue : value)}
          disabled={disabled}
        >
          {/*
           * Every aria prop, on the trigger. `onBlur` too — without it the
           * field never becomes touched, and a form validating on blur stays
           * silent about a select the user opened and closed empty.
           */}
          <SelectTrigger {...a11y} onBlur={field.onBlur} className={className ?? 'w-full'}>
            <SelectValue placeholder={placeholder} />
          </SelectTrigger>
          <SelectContent>
            {emptyLabel && <SelectItem value={EMPTY}>{emptyLabel}</SelectItem>}
            {children}
          </SelectContent>
        </Select>
      )}
    </FormField>
  );
}
