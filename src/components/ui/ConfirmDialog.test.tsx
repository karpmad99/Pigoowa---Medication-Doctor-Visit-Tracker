import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ConfirmDialog } from './ConfirmDialog';

// jsdom cannot trap focus or react to Escape (see src/test/setup.ts); those are covered in
// e2e/dialog.spec.ts. Here we test what the component itself decides.

interface Handlers {
  onConfirm?: () => void;
  onCancel?: () => void;
}

function setup(props: Partial<Parameters<typeof ConfirmDialog>[0]> & Handlers = {}) {
  const onConfirm = props.onConfirm ?? vi.fn();
  const onCancel = props.onCancel ?? vi.fn();
  const view = render(
    <ConfirmDialog
      open
      title="Usunąć lek?"
      confirmLabel="Usuń"
      onConfirm={onConfirm}
      onCancel={onCancel}
      {...props}
    >
      <p>Tej operacji nie można cofnąć.</p>
    </ConfirmDialog>,
  );
  return { ...view, onConfirm, onCancel };
}

describe('ConfirmDialog', () => {
  it('is not exposed to the user while closed', () => {
    setup({ open: false });

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('is a labelled dialog: the title is its name and the body its description', () => {
    setup();

    const dialog = screen.getByRole('dialog', { name: 'Usunąć lek?' });
    expect(dialog).toHaveAccessibleDescription('Tej operacji nie można cofnąć.');
  });

  it('calls onConfirm, and only onConfirm, when confirmed', async () => {
    const { onConfirm, onCancel } = setup();

    await userEvent.setup().click(screen.getByRole('button', { name: 'Usuń' }));

    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('calls onCancel, and only onCancel, when cancelled', async () => {
    const { onConfirm, onCancel } = setup();

    await userEvent.setup().click(screen.getByRole('button', { name: 'Anuluj' }));

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('uses a custom cancel label', () => {
    setup({ cancelLabel: 'Zostaw lek' });

    expect(screen.getByRole('button', { name: 'Zostaw lek' })).toBeInTheDocument();
  });

  it('treats the close button as cancelling', async () => {
    const { onConfirm, onCancel } = setup();

    await userEvent.setup().click(screen.getByRole('button', { name: 'Zamknij okno' }));

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('treats the browser closing the dialog (Escape) as cancelling', () => {
    const { onCancel, onConfirm } = setup();
    const dialog = screen.getByRole('dialog');

    // What a real browser does after Escape: closes the dialog and fires "close".
    (dialog as HTMLDialogElement).close();

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('treats a click on the backdrop as cancelling, but not a click inside the panel', async () => {
    const { onCancel } = setup();
    const dialog = screen.getByRole('dialog');

    await userEvent.setup().click(screen.getByText('Tej operacji nie można cofnąć.'));
    expect(onCancel).not.toHaveBeenCalled();

    fireEvent.click(dialog);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('does not report a cancel when the parent closes it from code (e.g. after confirming)', () => {
    const { rerender, onCancel } = setup();

    rerender(
      <ConfirmDialog
        open={false}
        title="Usunąć lek?"
        confirmLabel="Usuń"
        onConfirm={vi.fn()}
        onCancel={onCancel}
      >
        <p>Tej operacji nie można cofnąć.</p>
      </ConfirmDialog>,
    );

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('can be opened again after being closed from code', () => {
    const { rerender, onCancel } = setup();
    const render = (open: boolean) => {
      rerender(
        <ConfirmDialog
          open={open}
          title="Usunąć lek?"
          confirmLabel="Usuń"
          onConfirm={vi.fn()}
          onCancel={onCancel}
        >
          <p>Tej operacji nie można cofnąć.</p>
        </ConfirmDialog>,
      );
    };

    render(false);
    render(true);

    expect(screen.getByRole('dialog', { name: 'Usunąć lek?' })).toBeInTheDocument();
  });

  it('puts initial focus on Cancel for a destructive dialog, so Enter cannot delete by accident', () => {
    setup({ tone: 'danger' });

    expect(screen.getByRole('button', { name: 'Anuluj' })).toHaveFocus();
  });

  it('puts initial focus on the confirm button for an ordinary dialog', () => {
    setup({ tone: 'default', confirmLabel: 'Potwierdź' });

    expect(screen.getByRole('button', { name: 'Potwierdź' })).toHaveFocus();
  });

  it('blocks repeated confirmation while confirming', async () => {
    const { onConfirm } = setup({ isConfirming: true });
    const confirm = screen.getByRole('button', { name: 'Usuń' });

    await userEvent.setup().click(confirm);

    expect(confirm).toBeDisabled();
    expect(confirm).toHaveAttribute('aria-busy', 'true');
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
