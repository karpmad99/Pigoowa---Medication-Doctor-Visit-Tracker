import { useId, type ReactNode } from 'react';

/** The attributes a form control needs to be connected to its label, hint and error. */
export interface FormControlProps {
  id: string;
  'aria-describedby'?: string;
  'aria-invalid'?: true;
  'aria-required'?: true;
}

interface FormFieldProps {
  label: string;
  hint?: string;
  /** Error message; when present the control is marked invalid. */
  error?: string;
  required?: boolean;
  /** Receives the attributes to spread onto the control: `{(control) => <Input {...control} />}`. */
  children: (control: FormControlProps) => ReactNode;
}

/**
 * A visible label, an optional hint and an optional error around one form control. The label
 * is tied to the control with `htmlFor`/`id`, and the hint and error with `aria-describedby`,
 * so screen readers announce all of them. Placeholders are never used as labels.
 */
export function FormField({ label, hint, error, required = false, children }: FormFieldProps) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(' ');

  const control: FormControlProps = {
    id,
    'aria-describedby': describedBy || undefined,
    'aria-invalid': error ? true : undefined,
    'aria-required': required ? true : undefined,
  };

  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-sm font-semibold text-ink">
        {label}
        {required && (
          <span aria-hidden="true" className="text-danger-700">
            {' '}
            *
          </span>
        )}
      </label>
      {hint && (
        <p id={hintId} className="text-sm text-ink-muted">
          {hint}
        </p>
      )}
      {children(control)}
      {error && (
        <p id={errorId} role="alert" className="text-sm font-medium text-danger-700">
          {error}
        </p>
      )}
    </div>
  );
}
