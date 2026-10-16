import { Button } from '@/components/ui/Button';
import { ErrorState } from '@/components/ui/ErrorState';
import { Icon } from '@/components/ui/Icon';
import type { DoseFeedback } from '../hooks/useDoseActions';

/**
 * The outcome of the last dose action: a success in a polite live region (announced, and
 * dismissible), a failure as an alert. A success is only ever shown after the write finished.
 */
export function DoseFeedbackMessage({
  feedback,
  onDismiss,
}: {
  feedback: DoseFeedback | null;
  onDismiss: () => void;
}) {
  return (
    <>
      <div role="status" aria-live="polite">
        {feedback?.kind === 'success' && (
          <p className="flex flex-wrap items-start gap-x-3 gap-y-1 rounded-card border border-success-800 bg-success-50 p-4 text-success-800">
            <Icon name="check" className="mt-0.5" />
            <span className="min-w-0 flex-1 basis-48 font-medium">{feedback.message}</span>
            <Button
              variant="ghost"
              size="sm"
              className="-my-1 text-success-800"
              onClick={onDismiss}
            >
              Zamknij komunikat
            </Button>
          </p>
        )}
      </div>
      {feedback?.kind === 'error' && (
        <ErrorState title={feedback.title} message={feedback.message} />
      )}
    </>
  );
}
