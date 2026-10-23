import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';

/** The confirmation after a stock action, in a polite live region (the region stays when it is empty). */
export function StockFeedback({
  message,
  onDismiss,
}: {
  message: string | null;
  onDismiss: () => void;
}) {
  return (
    <div role="status" aria-live="polite">
      {message !== null && (
        <p className="flex items-start gap-3 rounded-card border border-success-800 bg-success-50 p-4 text-success-800">
          <Icon name="check" className="mt-0.5" />
          <span className="flex-1 font-medium">{message}</span>
          <Button variant="ghost" size="sm" className="-my-1 text-success-800" onClick={onDismiss}>
            Zamknij komunikat
          </Button>
        </p>
      )}
    </div>
  );
}
