'use client';

import { Input, type InputProps } from '@hrms/ui/components/input';
import { Textarea, type TextareaProps } from '@hrms/ui/components/textarea';
import type { FieldPath, FieldValues } from 'react-hook-form';
import { FormField, type FormFieldProps } from './form-base';

/**
 * Input and Textarea are the easy two: both are native elements underneath, so
 * the whole `field` bag — value, onChange, onBlur, name, ref — spreads straight
 * on. The pickers and Select below are where it stops being that simple.
 *
 * `value ?? ''` matters. An optional field starts `undefined`, and React treats
 * a `value={undefined}` input as uncontrolled — it warns, and then the first
 * keystroke flips it to controlled and the cursor jumps.
 */

/** Props the wrapper owns; a caller setting these by hand would fight it. */
type Owned = 'value' | 'onChange' | 'onBlur' | 'name' | 'id' | 'aria-invalid';

export function FormInput<
  TValues extends FieldValues,
  TName extends FieldPath<TValues> = FieldPath<TValues>,
>({
  control,
  name,
  label,
  hint,
  required,
  ...rest
}: FormFieldProps<TValues, TName> & Omit<InputProps, Owned>) {
  return (
    <FormField control={control} name={name} label={label} hint={hint} required={required}>
      {({ field, a11y }) => <Input {...a11y} {...field} value={field.value ?? ''} {...rest} />}
    </FormField>
  );
}

export function FormTextarea<
  TValues extends FieldValues,
  TName extends FieldPath<TValues> = FieldPath<TValues>,
>({
  control,
  name,
  label,
  hint,
  required,
  ...rest
}: FormFieldProps<TValues, TName> & Omit<TextareaProps, Owned>) {
  return (
    <FormField control={control} name={name} label={label} hint={hint} required={required}>
      {({ field, a11y }) => <Textarea {...a11y} {...field} value={field.value ?? ''} {...rest} />}
    </FormField>
  );
}
