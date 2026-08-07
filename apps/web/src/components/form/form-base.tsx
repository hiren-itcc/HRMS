'use client';

import type { ReactNode } from 'react';
import {
  type Control,
  Controller,
  type ControllerRenderProps,
  type FieldPath,
  type FieldValues,
} from 'react-hook-form';
import { Field } from '@/components/field';
import { schemaOf } from '@/hooks/use-zod-form';
import { isRequiredField } from '@/lib/zod-field';

/**
 * The react-hook-form binding `Field` has never had.
 *
 * `Field` already owns the hard part — a `useId`-generated id, and an
 * `aria-describedby` that names the hint *and* the error. What it does not do
 * is talk to a form: every call site passes `error={form.formState.errors.x?.message}`
 * by hand, and every non-native control is wired with `watch` + `setValue`.
 * There is not one `<Controller>` in the app.
 *
 * `FormField` supplies that half and nothing else. It renders the same `Field`,
 * so the markup and accessibility are unchanged; it just reads the error from
 * the field's own state instead of being told.
 *
 * Three things follow from using `Controller` rather than `watch`/`setValue`:
 *
 * - **`name` is checked.** `TName extends FieldPath<TValues>` means a typo is a
 *   compile error rather than a control that silently never registers.
 * - **The error path disappears.** `fieldState.error` resolves nested and array
 *   paths for free — no more `errors.emergencyContacts?.[i]?.name?.message`.
 * - **Dirty and touched are automatic.** `field.onChange` always marks the form
 *   dirty, so a submit button gated on `formState.isDirty` cannot be left
 *   disabled by a forgotten `{ shouldDirty: true }`.
 *
 * Export it directly for controls with no wrapper below — the auth
 * `PasswordInput`, `RichTextEditor`, `TimezoneField`. A wrapper per feature
 * component would point this shared module at feature code, which is the wrong
 * direction.
 */

/** Exactly the prop bag `Field` hands its child. */
export interface FieldA11y {
  id: string;
  'aria-invalid': boolean;
  'aria-required'?: boolean;
  'aria-describedby'?: string;
}

/** What every wrapper in this directory takes, on top of its own control props. */
export interface FormFieldProps<
  TValues extends FieldValues,
  TName extends FieldPath<TValues> = FieldPath<TValues>,
> {
  control: Control<TValues>;
  name: TName;
  label: string;
  hint?: string;
  /** Overrides the schema. Only for a control the schema cannot describe. */
  required?: boolean;
}

export function FormField<
  TValues extends FieldValues,
  TName extends FieldPath<TValues> = FieldPath<TValues>,
>({
  control,
  name,
  label,
  hint,
  required,
  children,
}: FormFieldProps<TValues, TName> & {
  children: (arg: { field: ControllerRenderProps<TValues, TName>; a11y: FieldA11y }) => ReactNode;
}) {
  /*
   * The schema decides, and the prop is only a fallback.
   *
   * It used to be the other way round — 27 fields said `required` by hand and
   * 127 required ones said nothing, so most of the app looked optional. The
   * schema is the thing that actually rejects the submit, so it is the honest
   * source; the prop stays for the handful of controls built on `FormField`
   * directly with no schema behind them.
   */
  const fromSchema = isRequiredField(schemaOf(control), name);

  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => (
        <Field
          label={label}
          hint={hint}
          required={required ?? fromSchema}
          error={fieldState.error?.message}
        >
          {(a11y) => children({ field, a11y })}
        </Field>
      )}
    />
  );
}
