import { Label } from '@hrms/ui/components/label';
import { cn } from '@hrms/ui/lib/utils';
import { useId } from 'react';

interface FieldProps {
  label: string;
  error?: string;
  hint?: string;
  /** Marks the field visibly and for assistive tech. */
  required?: boolean;
  children: (props: {
    id: string;
    'aria-invalid': boolean;
    'aria-required'?: boolean;
    'aria-describedby'?: string;
  }) => React.ReactNode;
}

/**
 * Form field wrapper: visible label, error adjacent to the input, hint text —
 * per the forms rules in docs/06-design-system.md (never placeholder-as-label).
 */
export function Field({ label, error, hint, required, children }: FieldProps) {
  const id = useId();
  // Both are described. Previously the error replaced the hint in
  // aria-describedby, so the hint was orphaned from assistive tech exactly
  // when the user most needed it.
  const describedBy =
    [hint ? `${id}-hint` : null, error ? `${id}-error` : null].filter(Boolean).join(' ') ||
    undefined;
  return (
    <div className="space-y-2">
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
        <p id={`${id}-hint`} className={cn('text-muted-foreground text-xs')}>
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
