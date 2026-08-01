import { Label } from '@hrms/ui/components/label';
import { cn } from '@hrms/ui/lib/utils';
import { useId } from 'react';

interface FormFieldProps {
  label: string;
  error?: string;
  hint?: string;
  /**
   * Required-ness was invisible across the whole product: `aria-required`
   * appeared zero times in 85 files and every form is `noValidate`, so
   * nothing told anyone which fields they had to fill.
   */
  required?: boolean;
  className?: string;
  children: (props: {
    id: string;
    'aria-invalid': boolean;
    'aria-required': boolean | undefined;
    'aria-describedby'?: string;
  }) => React.ReactNode;
}

/**
 * Field wrapper for controls the render-prop `Field` could not reach.
 *
 * `Field` is only ever used with Input and Textarea; every Select and
 * Checkbox in the app hand-rolls a bare `<Label>`, and 15 of those have no
 * `htmlFor` at all — so those controls have no accessible name, nowhere to
 * put an error, and no invalid state. This closes that gap and adds the
 * required marker.
 *
 * Hint and error are both described: `Field` referenced only the error when
 * both were present, which orphaned the hint from assistive tech.
 */
export function FormField({ label, error, hint, required, className, children }: FormFieldProps) {
  const id = useId();
  const describedBy =
    [hint ? `${id}-hint` : null, error ? `${id}-error` : null].filter(Boolean).join(' ') ||
    undefined;

  return (
    <div className={cn('space-y-2', className)}>
      <Label htmlFor={id}>
        {label}
        {required && (
          <span className="text-destructive-text" aria-hidden>
            *
          </span>
        )}
        {required && <span className="sr-only">(required)</span>}
      </Label>

      {children({
        id,
        'aria-invalid': Boolean(error),
        'aria-required': required || undefined,
        'aria-describedby': describedBy,
      })}

      {hint && (
        <p id={`${id}-hint`} className="text-muted-foreground text-xs">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} role="alert" className="text-destructive-text text-sm">
          {error}
        </p>
      )}
    </div>
  );
}
