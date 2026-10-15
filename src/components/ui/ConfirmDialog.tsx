import type { ReactNode } from 'react';
import { Button } from './Button';
import { Dialog } from './Dialog';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  /** Explains what will happen. For destructive actions, state the consequences plainly. */
  children: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  /** "danger" styles the confirm button red and puts initial focus on Cancel, so Enter cannot destroy by accident. */
  tone?: 'default' | 'danger';
  /** Shows a spinner on the confirm button and blocks repeated clicks. */
  isConfirming?: boolean;
  onConfirm: () => void;
  /** Called for Cancel, the close button, Escape and a click outside. */
  onCancel: () => void;
}

export function ConfirmDialog({
  open,
  title,
  children,
  confirmLabel,
  cancelLabel = 'Anuluj',
  tone = 'default',
  isConfirming = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const isDanger = tone === 'danger';
  return (
    <Dialog
      open={open}
      onClose={onCancel}
      title={title}
      footer={
        <>
          <Button variant="secondary" onClick={onCancel} data-autofocus={isDanger || undefined}>
            {cancelLabel}
          </Button>
          <Button
            variant={isDanger ? 'danger' : 'primary'}
            isLoading={isConfirming}
            onClick={onConfirm}
            data-autofocus={isDanger ? undefined : true}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      {children}
    </Dialog>
  );
}
