'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import {
  type Control,
  type FieldValues,
  type UseFormProps,
  type UseFormReturn,
  useForm,
} from 'react-hook-form';
import type { z } from 'zod';

/**
 * `useForm` with the schema kept where the fields can reach it.
 *
 * Every form here already pairs `useForm` with `zodResolver(schema)`. The
 * schema is then sealed inside the resolver closure, so `FormField` — which
 * knows the field's `name` and nothing else — cannot ask whether that field is
 * required, and 127 required fields rendered without an asterisk.
 *
 * The schema rides on `control` under a symbol. Considered and rejected:
 *
 * - **A context provider.** Correct, and it means every form grows a wrapper
 *   element whose only job is to carry one value the form already has.
 * - **Reading `control._options.resolver`.** No provider, but it holds the
 *   resolver function, not the schema — and `_options` is react-hook-form's
 *   private field, which is a dependency on someone else's implementation.
 *
 * A symbol on an object this hook creates is neither: nothing else can collide
 * with it, and nothing outside this file needs to know it is there.
 */

const SCHEMA = Symbol.for('hrms.form.schema');

type WithSchema = { [SCHEMA]?: z.ZodType };

/*
 * `TValues` is named by the caller rather than inferred from the schema, which
 * is what `useForm<BankDetailInput>(…)` already did — and it has to be: a
 * schema with `.default()` has an input type that differs from its output, and
 * inferring the wrong one puts the error on the form rather than on the field.
 */
export function useZodForm<TValues extends FieldValues>(
  schema: z.ZodType,
  options?: Omit<UseFormProps<TValues>, 'resolver'>,
): UseFormReturn<TValues> {
  const form = useForm<TValues>({
    ...options,
    // biome-ignore lint/suspicious/noExplicitAny: the resolver's generics do not survive the wrapper
    resolver: zodResolver(schema as any) as any,
  });

  (form.control as Control<TValues> & WithSchema)[SCHEMA] = schema;
  return form;
}

/** The schema a `useZodForm` control carries, if it came from one. */
export function schemaOf<TValues extends FieldValues>(
  control: Control<TValues>,
): z.ZodType | undefined {
  return (control as Control<TValues> & WithSchema)[SCHEMA];
}
