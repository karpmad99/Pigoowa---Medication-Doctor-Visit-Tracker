import { useEffect, useId, useRef, type ReactNode } from 'react';
import { Button } from './Button';
import { Icon } from './Icon';

interface DialogProps {
  open: boolean;
  /** Called when the user dismisses the dialog (Escape key, close button, click outside). */
  onClose: () => void;
  title: string;
  children: ReactNode;
  /** Buttons shown at the bottom. */
  footer?: ReactNode;
}

/**
 * A modal dialog built on the browser's native `<dialog>` element. `showModal()` gives, for free
 * and correctly: focus moves into the dialog and is trapped there, the page behind becomes
 * inert, Escape closes it, and focus returns to the element that opened it.
 * The title names the dialog for screen readers, and the body describes it.
 */
export function Dialog({ open, onClose, title, children, footer }: DialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  // Closing from code (the `open` prop turned false) also fires a "close" event. This flag stops
  // that echo from being reported as if the user had dismissed the dialog.
  const closedFromCode = useRef(false);
  const titleId = useId();
  const bodyId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
      // An element marked data-autofocus gets focus first (e.g. "Anuluj" in a destructive dialog).
      dialog.querySelector<HTMLElement>('[data-autofocus]')?.focus();
    } else if (!open && dialog.open) {
      closedFromCode.current = true;
      dialog.close();
    }
  }, [open]);

  // Clicking the dark backdrop dismisses the dialog. The backdrop belongs to the <dialog>
  // element itself, while the visible panel is a child, so only backdrop clicks hit the target.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const handleClick = (event: MouseEvent) => {
      if (event.target === dialog) dialog.close();
    };
    dialog.addEventListener('click', handleClick);
    return () => {
      dialog.removeEventListener('click', handleClick);
    };
  }, []);

  const handleClose = () => {
    if (closedFromCode.current) {
      closedFromCode.current = false;
      return;
    }
    onClose();
  };

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      aria-describedby={bodyId}
      onClose={handleClose}
      className="m-auto w-[calc(100%-2rem)] max-w-md rounded-card border border-line bg-surface p-0 text-ink shadow-xl backdrop:bg-ink/50"
    >
      <div className="p-5 sm:p-6">
        <div className="flex items-start justify-between gap-4">
          <h2 id={titleId} className="text-lg font-semibold">
            {title}
          </h2>
          <Button
            variant="ghost"
            size="sm"
            className="-mr-2 -mt-1 px-2"
            aria-label="Zamknij okno"
            onClick={() => dialogRef.current?.close()}
          >
            <Icon name="close" />
          </Button>
        </div>
        <div id={bodyId} className="mt-3 space-y-3 text-ink-muted">
          {children}
        </div>
        {footer && (
          <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-end">{footer}</div>
        )}
      </div>
    </dialog>
  );
}
