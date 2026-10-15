import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { ComponentsPreviewPage } from './ComponentsPreviewPage';

describe('ComponentsPreviewPage', () => {
  describe('example form', () => {
    it('shows an accessible error for an empty required field and no success message', async () => {
      render(<ComponentsPreviewPage />);

      await userEvent.setup().click(screen.getByRole('button', { name: 'Sprawdź formularz' }));

      const form = screen.getByRole('region', { name: 'Pola formularza' });
      const name = within(form).getByRole('textbox', { name: 'Nazwa leku' });
      expect(name).toBeInvalid();
      expect(name).toHaveAccessibleDescription(/Wpisz nazwę leku\./);
      expect(within(form).getByRole('alert')).toHaveTextContent('Wpisz nazwę leku.');
      expect(within(form).queryByRole('status')).not.toBeInTheDocument();
    });

    it('treats a name of only spaces as empty', async () => {
      render(<ComponentsPreviewPage />);
      const user = userEvent.setup();

      await user.type(screen.getByRole('textbox', { name: 'Nazwa leku' }), '   ');
      await user.click(screen.getByRole('button', { name: 'Sprawdź formularz' }));

      expect(screen.getByRole('textbox', { name: 'Nazwa leku' })).toBeInvalid();
    });

    it('clears the error and says the example is valid, without claiming anything was saved', async () => {
      render(<ComponentsPreviewPage />);
      const user = userEvent.setup();
      await user.click(screen.getByRole('button', { name: 'Sprawdź formularz' }));

      await user.type(screen.getByRole('textbox', { name: 'Nazwa leku' }), 'Lek A');
      await user.click(screen.getByRole('button', { name: 'Sprawdź formularz' }));

      const form = screen.getByRole('region', { name: 'Pola formularza' });
      expect(within(form).getByRole('textbox', { name: 'Nazwa leku' })).toBeValid();
      expect(within(form).queryByRole('alert')).not.toBeInTheDocument();
      expect(within(form).getByRole('status')).toHaveTextContent(
        'Formularz jest poprawny. To tylko podgląd: nic nie zostało zapisane.',
      );
    });
  });

  describe('loading button', () => {
    it('toggles into a busy, disabled state and back', async () => {
      render(<ComponentsPreviewPage />);
      const user = userEvent.setup();

      await user.click(screen.getByRole('button', { name: 'Pokaż stan ładowania' }));
      const busy = screen.getByRole('button', { name: 'Zapisywanie…' });
      expect(busy).toBeDisabled();
      expect(busy).toHaveAttribute('aria-busy', 'true');

      await user.click(screen.getByRole('button', { name: 'Zakończ ładowanie' }));
      expect(screen.getByRole('button', { name: 'Zapisz' })).toBeEnabled();
    });
  });

  describe('error state', () => {
    it('retry button really counts the retries', async () => {
      render(<ComponentsPreviewPage />);
      const user = userEvent.setup();

      await user.click(screen.getByRole('button', { name: 'Spróbuj ponownie' }));
      await user.click(screen.getByRole('button', { name: 'Spróbuj ponownie' }));

      expect(screen.getByText('Liczba ponownych prób: 2')).toBeInTheDocument();
    });
  });

  describe('dialogs', () => {
    it('opens a destructive confirmation focused on Cancel, and cancelling reports it', async () => {
      render(<ComponentsPreviewPage />);
      const user = userEvent.setup();

      await user.click(screen.getByRole('button', { name: 'Okno usuwania' }));
      const dialog = screen.getByRole('dialog', { name: 'Usunąć przykładowy element?' });
      expect(within(dialog).getByRole('button', { name: 'Anuluj' })).toHaveFocus();

      await user.click(within(dialog).getByRole('button', { name: 'Anuluj' }));

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(screen.getByText('Wynik: Anulowano usuwanie.')).toBeInTheDocument();
    });

    it('confirming closes the dialog and reports exactly the confirmation', async () => {
      render(<ComponentsPreviewPage />);
      const user = userEvent.setup();

      await user.click(screen.getByRole('button', { name: 'Okno usuwania' }));
      await user.click(screen.getByRole('button', { name: 'Usuń na stałe' }));

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(screen.getByText('Wynik: Potwierdzono usunięcie.')).toBeInTheDocument();
    });

    it('can be opened again after it was closed', async () => {
      render(<ComponentsPreviewPage />);
      const user = userEvent.setup();

      await user.click(screen.getByRole('button', { name: 'Okno potwierdzenia' }));
      await user.click(screen.getByRole('button', { name: 'Potwierdź' }));
      await user.click(screen.getByRole('button', { name: 'Okno potwierdzenia' }));

      expect(screen.getByRole('dialog', { name: 'Potwierdzić akcję?' })).toBeInTheDocument();
    });
  });

  it('shows Polish formatting of dates, times and numbers', () => {
    render(<ComponentsPreviewPage />);

    expect(screen.getByText('czwartek, 15 października 2026')).toBeInTheDocument();
    expect(screen.getByText('15 października 2026 12:30')).toBeInTheDocument();
    expect(screen.getByText('1,5')).toBeInTheDocument();
  });
});
