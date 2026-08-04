'use client';

import { Checkbox } from '@hrms/ui/components/checkbox';
import { Label } from '@hrms/ui/components/label';
import { Switch } from '@hrms/ui/components/switch';
import { useId } from 'react';
import { type Control, Controller, type FieldPath, type FieldValues } from 'react-hook-form';

/**
 * Checkbox and Switch do not go through `Field`, and that is deliberate rather
 * than an omission: `Field` stacks a label above its control, and a checkbox
 * wants its label beside it. Every one of the six checkbox sites in the app
 * works around that by hand — three re-deriving `useId`, three hardcoding an id
 * string like `id="create-login"`.
 *
 * The Base UI difference that a Radix implementation gets wrong:
 * **`onCheckedChange` receives two arguments**, `(checked, eventDetails)`.
 * Passing `field.onChange` straight in hands react-hook-form the event-details
 * object as a second argument. Wrapping it is not defensive noise — it is the
 * difference between storing a boolean and storing whatever RHF makes of that
 * pair.
 */

interface ToggleProps<TValues extends FieldValues, TName extends FieldPath<TValues>> {
  control: Control<TValues>;
  name: TName;
  label: string;
  /** Sits under the label, for the "what does this actually do" sentence. */
  hint?: string;
  disabled?: boolean;
  /**
   * Runs after the value is stored, for a toggle that governs another field.
   * Turning carry-forward off has to clear its cap, or the schema refuses a
   * limit on a feature that is switched off.
   */
  onValueChange?: (checked: boolean) => void;
}

function Toggle<TValues extends FieldValues, TName extends FieldPath<TValues>>({
  control,
  name,
  label,
  hint,
  disabled,
  onValueChange,
  variant,
}: ToggleProps<TValues, TName> & { variant: 'checkbox' | 'switch' }) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;

  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => {
        const errorId = fieldState.error ? `${id}-error` : undefined;
        const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined;
        const Control = variant === 'switch' ? Switch : Checkbox;

        return (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Control
                id={id}
                checked={Boolean(field.value)}
                // The wrap is the point — see the note above.
                onCheckedChange={(checked) => {
                  field.onChange(checked);
                  onValueChange?.(checked);
                }}
                onBlur={field.onBlur}
                disabled={disabled}
                aria-invalid={Boolean(fieldState.error)}
                aria-describedby={describedBy}
              />
              <Label htmlFor={id} className="font-normal">
                {label}
              </Label>
            </div>
            {hint && (
              <p id={hintId} className="text-muted-foreground text-xs">
                {hint}
              </p>
            )}
            {fieldState.error && (
              <p id={errorId} role="alert" className="text-destructive-text text-sm">
                {fieldState.error.message}
              </p>
            )}
          </div>
        );
      }}
    />
  );
}

export function FormCheckbox<
  TValues extends FieldValues,
  TName extends FieldPath<TValues> = FieldPath<TValues>,
>(props: ToggleProps<TValues, TName>) {
  return <Toggle {...props} variant="checkbox" />;
}

export function FormSwitch<
  TValues extends FieldValues,
  TName extends FieldPath<TValues> = FieldPath<TValues>,
>(props: ToggleProps<TValues, TName>) {
  return <Toggle {...props} variant="switch" />;
}
