import { Label } from '@hrms/ui/components/label';
import { cn } from '@hrms/ui/lib/utils';
import { useId } from 'react';

interface FieldProps {
  label: string;
  error?: string;
  hint?: string;
  children: (props: {
    id: string;
    'aria-invalid': boolean;
    'aria-describedby'?: string;
  }) => React.ReactNode;
}

/**
 * Form field wrapper: visible label, error adjacent to the input, hint text —
 * per the forms rules in docs/06-design-system.md (never placeholder-as-label).
 */
export function Field({ label, error, hint, children }: FieldProps) {
  const id = useId();
  const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined;
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      {children({ id, 'aria-invalid': Boolean(error), 'aria-describedby': describedBy })}
      {error ? (
        <p id={`${id}-error`} role="alert" className="text-destructive-text text-sm">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className={cn('text-muted-foreground text-xs')}>
          {hint}
        </p>
      ) : null}
    </div>
  );
}
