import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { STORAGE_KEYS } from '@/services/local/collections';
import { createQuotaError } from '@/test/fakeStorage';
import { makeMedication } from '@/test/fixtures';
import { createTestServices, servicesWrapper } from '@/test/services';
import { DevDataPage } from './DevDataPage';

function renderPage(services = createTestServices()) {
  render(<DevDataPage />, { wrapper: servicesWrapper(services) });
  return services;
}

const section = (name: string) => screen.getByRole('region', { name });

describe('DevDataPage', () => {
  it('shows loading, then clear empty states for empty storage', async () => {
    renderPage();

    expect(within(section('Leki')).getByRole('status')).toHaveTextContent('Ładowanie');
    expect(await within(section('Leki')).findByText('Brak zapisanych leków.')).toBeVisible();
    expect(within(section('Wizyty')).getByText('Brak zapisanych wizyt.')).toBeVisible();
  });

  it('warns that browser storage is not a safe place for real medical data', () => {
    renderPage();

    expect(
      screen.getByText(/To nie jest bezpieczne miejsce na prawdziwe dane medyczne/),
    ).toBeVisible();
  });

  it('loads the demo data on request, marking every item as an example', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('Brak zapisanych leków.');

    await user.click(screen.getByRole('button', { name: 'Wczytaj dane demonstracyjne' }));

    expect(await within(section('Leki')).findByText('Demoxal')).toBeVisible();
    expect(screen.getByText('Wczytano dane demonstracyjne.')).toBeVisible();
    expect(within(section('Leki')).getByRole('heading', { name: 'Leki (4)' })).toBeVisible();
    expect(within(section('Leki')).getAllByText('Przykład')).toHaveLength(4);
    expect(within(section('Leki')).getByText('Zakończony')).toBeVisible();
    expect(within(section('Wizyty')).getByRole('heading', { name: 'Wizyty (5)' })).toBeVisible();
    expect(within(section('Wizyty')).getAllByText('Przykład')).toHaveLength(5);
  });

  it('refuses to load demo data over existing data and says so, changing nothing', async () => {
    const user = userEvent.setup();
    const services = createTestServices();
    await services.repositories.medications.create(
      makeMedication({ id: 'mine-1', name: 'Mój lek' }),
    );
    renderPage(services);
    await screen.findByText('Mój lek');

    await user.click(screen.getByRole('button', { name: 'Wczytaj dane demonstracyjne' }));

    expect(
      await screen.findByText(/Dane demonstracyjne można wczytać tylko do pustej pamięci/),
    ).toBeVisible();
    expect(within(section('Leki')).getByText('Mój lek')).toBeVisible();
    expect(within(section('Leki')).queryByText('Przykład')).not.toBeInTheDocument();
  });

  it('shows corrupted data as an error, and lets the user recover by resetting after confirming', async () => {
    const user = userEvent.setup();
    const services = createTestServices();
    services.storage.data.set(STORAGE_KEYS.medications, '{damaged');
    renderPage(services);

    const alert = await within(section('Leki')).findByRole('alert');
    expect(alert).toHaveTextContent('Zapisane dane są uszkodzone');
    expect(services.storage.data.get(STORAGE_KEYS.medications)).toBe('{damaged');

    await user.click(screen.getByRole('button', { name: 'Przywróć dane demonstracyjne…' }));
    const dialog = screen.getByRole('dialog', { name: 'Przywrócić dane demonstracyjne?' });
    expect(within(dialog).getByRole('button', { name: 'Anuluj' })).toHaveFocus();
    expect(dialog).toHaveTextContent('kopii zapasowej');
    await user.click(within(dialog).getByRole('button', { name: 'Przywróć dane demonstracyjne' }));

    expect(await screen.findByText('Przywrócono dane demonstracyjne.')).toBeVisible();
    expect(await within(section('Leki')).findByText('Demoxal')).toBeVisible();
    const backup = JSON.parse(services.storage.data.get(STORAGE_KEYS.backup) ?? 'null') as {
      entries: Record<string, string | null>;
    };
    expect(backup.entries[STORAGE_KEYS.medications]).toBe('{damaged');
  });

  it('does nothing to the data when the reset confirmation is cancelled', async () => {
    const user = userEvent.setup();
    const services = createTestServices();
    await services.repositories.medications.create(
      makeMedication({ id: 'mine-1', name: 'Mój lek' }),
    );
    renderPage(services);
    await screen.findByText('Mój lek');

    await user.click(screen.getByRole('button', { name: 'Przywróć dane demonstracyjne…' }));
    await user.click(screen.getByRole('button', { name: 'Anuluj' }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(services.storage.data.has(STORAGE_KEYS.backup)).toBe(false);
    expect(within(section('Leki')).getByText('Mój lek')).toBeVisible();
  });

  it('reports a failed reset in Polish without technical details, and the data stays as it was', async () => {
    const user = userEvent.setup();
    const services = createTestServices();
    await services.repositories.medications.create(
      makeMedication({ id: 'mine-1', name: 'Mój lek' }),
    );
    renderPage(services);
    await screen.findByText('Mój lek');

    services.storage.failWrites(createQuotaError(), (key) => key === STORAGE_KEYS.backup);
    await user.click(screen.getByRole('button', { name: 'Przywróć dane demonstracyjne…' }));
    await user.click(screen.getByRole('button', { name: 'Przywróć dane demonstracyjne' }));

    await waitFor(() => {
      expect(
        screen.getByText(/Nie udało się: W pamięci przeglądarki brakuje miejsca/),
      ).toBeVisible();
    });
    expect(within(section('Leki')).getByText('Mój lek')).toBeVisible();
  });

  it('offers a retry for a failed section that works once the problem is gone', async () => {
    const user = userEvent.setup();
    const services = createTestServices();
    services.storage.failReads();
    renderPage(services);
    const alert = await within(section('Wizyty')).findByRole('alert');
    expect(alert).toHaveTextContent('Nie można uzyskać dostępu do pamięci przeglądarki');

    services.storage.heal();
    await user.click(within(alert).getByRole('button', { name: 'Spróbuj ponownie' }));

    expect(await within(section('Wizyty')).findByText('Brak zapisanych wizyt.')).toBeVisible();
  });
});
