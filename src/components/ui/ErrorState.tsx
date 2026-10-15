import { Button } from './Button';
import { Icon } from './Icon';

interface ErrorStateProps {
  title?: string;
  /** What went wrong, in plain words, without technical details. */
  message: string;
  /** When given, a "try again" button is shown. */
  onRetry?: () => void;
}

export function ErrorState({ title = 'Coś poszło nie tak', message, onRetry }: ErrorStateProps) {
  return (
    <div
      role="alert"
      className="flex gap-3 rounded-card border border-danger-600 bg-danger-50 p-4 text-danger-700"
    >
      <Icon name="alert" className="mt-0.5" />
      <div className="space-y-3">
        <div>
          <p className="font-semibold">{title}</p>
          <p className="text-sm">{message}</p>
        </div>
        {onRetry && (
          <Button variant="secondary" size="sm" onClick={onRetry}>
            Spróbuj ponownie
          </Button>
        )}
      </div>
    </div>
  );
}
