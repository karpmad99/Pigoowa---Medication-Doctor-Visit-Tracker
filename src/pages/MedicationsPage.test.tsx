import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { ServicesProvider } from '@/app/ServicesProvider';
import { routes } from '@/app/routes';
import { RepositoryError } from '@/services/errors';
import { STORAGE_KEYS } from '@/services/local/collections';
import { createFakeStorage, createQuotaError } from '@/test/fakeStorage';
import { makeDoseLog, makeMedication, scheduleTime } from '@/test/fixtures';
import { createTestServices } from '@/test/services';
import { asLocalDate, asLocalTime, asTimestamp } from '@/utils/date';

// The test clock says 12:00 on 15 October 2026 in Warsaw, so "today" is 2026-10-15.

type Services = ReturnType<typeof createTestServices>;

function renderApp(
  services: Services = createTestServices(),
  entry: string | object = '/medications',
) {
  const router = createMemoryRouter(routes, { initialEntries: [entry] });
  render(
    <ServicesProvider services={services}>
      <RouterProvider router={router} />
    </ServicesProvider>,
  );
  return { router, services };
}

async function seed(services: Services, ...overrides: Parameters<typeof makeMedication>[0][]) {
  for (const override of overrides)
    await services.repositories.medications.create(makeMedication(override));
}

const card = (name: string) => within(screen.getByRole('article', { name }));
/** Like `card`, but waits for the medication to appear first (the page loads asynchronously). */
const findCard = async (name: string) => within(await screen.findByRole('article', { name }));
const logsOf = (services: Services, medicationId: string) =>
  services.repositories.doseLogs
    .listByDateRange(asLocalDate('2000-01-01'), asLocalDate('2999-12-31'))
    .then((logs) => logs.filter((log) => log.medicationId === medicationId));

function addLogs(services: Services, medicationId: string, count: number) {
  return Promise.all(
    Array.from({ length: count }, (_value, index) =>
      services.repositories.doseLogs.upsert(
        makeDoseLog({
          id: `${medicationId}-log-${String(index)}`,
          medicationId,
          scheduledDate: asLocalDate(`2026-10-${String(1 + index).padStart(2, '0')}`),
          doseAmount: 2,
          doseUnit: 'tabletka',
        }),
      ),
    ),
  );
}

describe('medication list: states', () => {
  it('shows loading, then the medications', async () => {
    const services = createTestServices();
    await seed(services, { id: 'm-1', name: 'Demoxal' });

    renderApp(services);

    expect(screen.getByText('Wczytywanie leków…')).toBeVisible();
    expect(await screen.findByRole('article', { name: 'Demoxal' })).toBeVisible();
    expect(screen.getByRole('heading', { level: 1, name: 'Leki' })).toBeVisible();
  });

  it('explains what to do when there are no medications, with a working way to add one', async () => {
    const user = userEvent.setup();
    const { router } = renderApp();

    expect(
      await screen.findByRole('heading', { name: 'Nie dodano jeszcze żadnego leku' }),
    ).toBeVisible();
    await user.click(screen.getByRole('link', { name: 'Dodaj pierwszy lek' }));

    expect(router.state.location.pathname).toBe('/medications/new');
    expect(await screen.findByRole('heading', { level: 1, name: 'Dodaj lek' })).toBeVisible();
  });

  it('always offers "Dodaj lek" in the page header', async () => {
    const services = createTestServices();
    await seed(services, { id: 'm-1' });
    renderApp(services);

    await screen.findByRole('article', { name: 'Lek A' });

    expect(screen.getByRole('link', { name: 'Dodaj lek' })).toHaveAttribute(
      'href',
      '/medications/new',
    );
  });

  it('shows a failure as an error with a retry that works once the problem is gone, never as an empty list', async () => {
    const user = userEvent.setup();
    const services = createTestServices(
      createFakeStorage({ [STORAGE_KEYS.medications]: '{broken' }),
    );
    renderApp(services);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Nie udało się wczytać leków');
    expect(alert).toHaveTextContent('Zapisane dane są uszkodzone');
    expect(screen.queryByText('Nie dodano jeszcze żadnego leku')).not.toBeInTheDocument();
    expect(services.storage.data.get(STORAGE_KEYS.medications)).toBe('{broken');

    services.storage.data.delete(STORAGE_KEYS.medications);
    await user.click(screen.getByRole('button', { name: 'Spróbuj ponownie' }));

    expect(
      await screen.findByRole('heading', { name: 'Nie dodano jeszcze żadnego leku' }),
    ).toBeVisible();
  });

  it('shows unreadable storage as an error too', async () => {
    const services = createTestServices();
    services.storage.failReads();

    renderApp(services);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Nie można uzyskać dostępu do pamięci przeglądarki',
    );
  });
});

describe('medication list: what a medication shows', () => {
  it('shows name, period, each time with its dose, and the stock estimate', async () => {
    const services = createTestServices();
    await seed(services, {
      id: 'm-1',
      name: 'Demoxal',
      doseUnit: 'tabletka',
      startDate: asLocalDate('2026-10-01'),
      scheduleEffectiveFrom: asLocalDate('2026-10-01'),
      scheduleTimes: [scheduleTime('t-2', '20:00', 0.5), scheduleTime('t-1', '08:00', 1)],
      stock: { quantity: 28, unit: 'tabletka', asOf: asTimestamp('2026-10-01T08:00:00Z') },
      notes: 'Po jedzeniu',
    });
    renderApp(services);

    const demoxal = await findCard('Demoxal');
    await waitFor(() => {
      expect(demoxal.getByText(/Pozostało ok\. 28 tabletka/)).toBeVisible();
    });
    expect(demoxal.getByText('Od 1 października 2026, bez daty zakończenia')).toBeVisible();
    const items = demoxal.getAllByRole('listitem').map((item) => item.textContent);
    expect(items).toEqual(['08:00 — 1 tabletka', '20:00 — 0,5 tabletka']);
    expect(demoxal.getByText(/wystarczy na ok\. 18 dni/)).toBeVisible();
    expect(demoxal.getByText('Po jedzeniu')).toBeVisible();
  });

  it('never invents a stock amount: an unavailable estimate says so and shows no number', async () => {
    const services = createTestServices();
    await seed(services, { id: 'm-1', name: 'Bez zapasu', stock: null });
    renderApp(services);

    const stock = (await (await findCard('Bez zapasu')).findByText(/Szacunek niedostępny/))
      .textContent;

    expect(stock).toBe('Szacunek niedostępny: nie podano zapasu.');
    expect(stock).not.toMatch(/\d/);
  });

  it('explains why the estimate is unavailable when units differ, and shows no number', async () => {
    const services = createTestServices();
    await seed(services, {
      id: 'm-1',
      name: 'Zmieniona jednostka',
      doseUnit: 'ml',
      stock: { quantity: 28, unit: 'tabletka', asOf: asTimestamp('2026-10-01T08:00:00Z') },
    });
    renderApp(services);

    const stock = (await (await findCard('Zmieniona jednostka')).findByText(/Szacunek niedostępny/))
      .textContent;

    expect(stock).toContain('jednostka zapasu różni się od jednostki dawki');
    expect(stock).not.toMatch(/28/);
  });

  it('marks a low stock in words, not only with colour', async () => {
    const services = createTestServices();
    await seed(services, {
      id: 'm-1',
      name: 'Kończy się',
      stock: { quantity: 3, unit: 'tabletka', asOf: asTimestamp('2026-10-01T08:00:00Z') },
    });
    renderApp(services);

    expect(await (await findCard('Kończy się')).findByText('Niski zapas')).toBeVisible();
  });

  it('counts only taken doses against the stock', async () => {
    const services = createTestServices();
    await seed(services, {
      id: 'm-1',
      name: 'Z historią',
      stock: { quantity: 10, unit: 'tabletka', asOf: asTimestamp('2026-10-01T08:00:00Z') },
    });
    await services.repositories.doseLogs.upsert(
      makeDoseLog({
        id: 'l-1',
        medicationId: 'm-1',
        status: 'taken',
        doseAmount: 4,
        recordedAt: asTimestamp('2026-10-05T08:00:00Z'),
      }),
    );
    await services.repositories.doseLogs.upsert(
      makeDoseLog({
        id: 'l-2',
        medicationId: 'm-1',
        status: 'skipped',
        scheduledTime: asLocalTime('20:00'),
        recordedAt: asTimestamp('2026-10-05T20:00:00Z'),
      }),
    );
    renderApp(services);

    expect(
      await (await findCard('Z historią')).findByText(/Pozostało ok\. 6 tabletka/),
    ).toBeVisible();
  });

  it('says the estimate is unavailable, rather than guessing, when the history it needs cannot be read', async () => {
    const services = createTestServices(createFakeStorage({ [STORAGE_KEYS.doseLogs]: '{broken' }));
    await seed(services, {
      id: 'm-1',
      name: 'Demoxal',
      stock: { quantity: 10, unit: 'tabletka', asOf: asTimestamp('2026-10-01T08:00:00Z') },
    });
    renderApp(services);

    const stock = (await (await findCard('Demoxal')).findByText(/nie udało się wczytać historii/))
      .textContent;

    expect(stock).toContain('Szacunek niedostępny');
    expect(stock).not.toMatch(/10/);
  });

  it('separates ended medications and labels each status in words', async () => {
    const services = createTestServices();
    await seed(
      services,
      { id: 'm-active', name: 'Aktywny lek' },
      {
        id: 'm-planned',
        name: 'Przyszły lek',
        startDate: asLocalDate('2026-11-01'),
        scheduleEffectiveFrom: asLocalDate('2026-11-01'),
      },
      { id: 'm-ended', name: 'Skończony lek', endDate: asLocalDate('2026-10-10') },
    );
    renderApp(services);

    await screen.findByRole('article', { name: 'Aktywny lek' });
    expect(
      screen.getByRole('heading', { level: 2, name: 'Aktywne i zaplanowane (2)' }),
    ).toBeVisible();
    expect(screen.getByRole('heading', { level: 2, name: 'Zakończone (1)' })).toBeVisible();
    expect(card('Aktywny lek').getByText('Aktywny')).toBeVisible();
    expect(card('Przyszły lek').getByText('Zaplanowany')).toBeVisible();
    expect(card('Skończony lek').getByText('Zakończony')).toBeVisible();
    expect(card('Skończony lek').getByText(/do 10 października 2026/)).toBeVisible();
  });

  it('offers no "end" action for an ended medication, but still edit and delete', async () => {
    const services = createTestServices();
    await seed(services, {
      id: 'm-ended',
      name: 'Skończony lek',
      endDate: asLocalDate('2026-10-10'),
    });
    renderApp(services);

    const ended = await findCard('Skończony lek');
    await ended.findByText('Zakończony');

    expect(ended.queryByRole('button', { name: /Zakończ lek/ })).not.toBeInTheDocument();
    expect(ended.getByRole('link', { name: 'Edytuj lek Skończony lek' })).toBeVisible();
    expect(ended.getByRole('button', { name: 'Usuń trwale… lek Skończony lek' })).toBeVisible();
  });

  it("marks fictional demo records as examples, and not the user's own", async () => {
    const services = createTestServices();
    await services.demoData.loadDemoData();
    await services.repositories.medications.create(
      makeMedication({ id: 'my-own-1', name: 'Mój własny lek' }),
    );
    renderApp(services);

    await screen.findByRole('article', { name: 'Mój własny lek' });

    expect(card('Demoxal').getByText('Przykład')).toBeVisible();
    expect(card('Mój własny lek').queryByText('Przykład')).not.toBeInTheDocument();
  });

  it('gives each action a name that says which medication it is about', async () => {
    const services = createTestServices();
    await seed(services, { id: 'm-1', name: 'Demoxal' }, { id: 'm-2', name: 'Inny' });
    renderApp(services);

    await screen.findByRole('article', { name: 'Demoxal' });

    expect(screen.getByRole('link', { name: 'Edytuj lek Demoxal' })).toHaveAttribute(
      'href',
      '/medications/m-1/edit',
    );
    expect(screen.getByRole('button', { name: 'Zakończ lek Demoxal' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Usuń trwale… lek Demoxal' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Usuń trwale… lek Inny' })).toBeVisible();
  });

  it('shows the date from which the current schedule applies once it has changed', async () => {
    const services = createTestServices();
    await seed(services, {
      id: 'm-1',
      name: 'Demoxal',
      startDate: asLocalDate('2026-01-01'),
      scheduleEffectiveFrom: asLocalDate('2026-10-05'),
    });
    renderApp(services);

    const demoxal = await findCard('Demoxal');

    expect(
      await demoxal.findByText('Obecny harmonogram obowiązuje od 5 października 2026.'),
    ).toBeVisible();
  });
});

describe('ending a medication', () => {
  it('ends it from today by default, keeps every intake record, and says so', async () => {
    const user = userEvent.setup();
    const services = createTestServices();
    await seed(services, { id: 'm-1', name: 'Demoxal' });
    await addLogs(services, 'm-1', 3);
    const logsBefore = await logsOf(services, 'm-1');
    renderApp(services);

    await user.click(await screen.findByRole('button', { name: 'Zakończ lek Demoxal' }));
    const dialog = screen.getByRole('dialog', { name: 'Zakończyć lek „Demoxal”?' });
    expect(within(dialog).getByLabelText(/Ostatni dzień przyjmowania/)).toHaveValue('2026-10-15');
    expect(dialog).toHaveTextContent('Historia przyjmowania zostanie zachowana');
    await user.click(within(dialog).getByRole('button', { name: 'Zakończ lek' }));

    expect(
      await screen.findByText('Zakończono lek „Demoxal”. Historia przyjmowania została zachowana.'),
    ).toBeVisible();
    expect((await services.repositories.medications.get('m-1')).endDate).toBe('2026-10-15');
    expect(await logsOf(services, 'm-1')).toEqual(logsBefore);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('moves the medication to the ended group once the last day has passed', async () => {
    const user = userEvent.setup();
    const services = createTestServices();
    await seed(services, { id: 'm-1', name: 'Demoxal' });
    renderApp(services);

    await user.click(await screen.findByRole('button', { name: 'Zakończ lek Demoxal' }));
    fireEvent.change(screen.getByLabelText(/Ostatni dzień przyjmowania/), {
      target: { value: '2026-10-14' },
    });
    await user.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Zakończ lek' }),
    );

    expect(await screen.findByRole('heading', { level: 2, name: 'Zakończone (1)' })).toBeVisible();
    expect(card('Demoxal').getByText('Zakończony')).toBeVisible();
  });

  it('refuses a last day before the start date, with a message at the field, and writes nothing', async () => {
    const user = userEvent.setup();
    const services = createTestServices();
    await seed(services, {
      id: 'm-1',
      name: 'Demoxal',
      startDate: asLocalDate('2026-10-01'),
      scheduleEffectiveFrom: asLocalDate('2026-10-01'),
    });
    renderApp(services);

    await user.click(await screen.findByRole('button', { name: 'Zakończ lek Demoxal' }));
    fireEvent.change(screen.getByLabelText(/Ostatni dzień przyjmowania/), {
      target: { value: '2026-09-30' },
    });
    await user.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Zakończ lek' }),
    );

    const field = screen.getByLabelText(/Ostatni dzień przyjmowania/);
    expect(field).toBeInvalid();
    expect(field).toHaveAccessibleDescription(/nie może być wcześniejszy niż data rozpoczęcia/);
    expect((await services.repositories.medications.get('m-1')).endDate).toBeNull();
    expect(screen.getByRole('dialog')).toBeVisible();
  });

  it('refuses a date that is not a date', async () => {
    const user = userEvent.setup();
    const services = createTestServices();
    await seed(services, { id: 'm-1', name: 'Demoxal' });
    renderApp(services);

    await user.click(await screen.findByRole('button', { name: 'Zakończ lek Demoxal' }));
    fireEvent.change(screen.getByLabelText(/Ostatni dzień przyjmowania/), {
      target: { value: '' },
    });
    await user.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Zakończ lek' }),
    );

    expect(screen.getByLabelText(/Ostatni dzień przyjmowania/)).toHaveAccessibleDescription(
      /Wybierz poprawną datę/,
    );
    expect((await services.repositories.medications.get('m-1')).endDate).toBeNull();
  });

  it('offers the start date first for a medication that has not started yet', async () => {
    const user = userEvent.setup();
    const services = createTestServices();
    await seed(services, {
      id: 'm-1',
      name: 'Przyszły',
      startDate: asLocalDate('2026-11-01'),
      scheduleEffectiveFrom: asLocalDate('2026-11-01'),
    });
    renderApp(services);

    await user.click(await screen.findByRole('button', { name: 'Zakończ lek Przyszły' }));

    expect(screen.getByLabelText(/Ostatni dzień przyjmowania/)).toHaveValue('2026-11-01');
  });

  it('does not change anything when cancelled', async () => {
    const user = userEvent.setup();
    const services = createTestServices();
    await seed(services, { id: 'm-1', name: 'Demoxal' });
    const before = await services.repositories.medications.get('m-1');
    renderApp(services);

    await user.click(await screen.findByRole('button', { name: 'Zakończ lek Demoxal' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Anuluj' }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(await services.repositories.medications.get('m-1')).toEqual(before);
  });

  it('says it failed, keeps the dialog open and shows no success message, when saving fails', async () => {
    const user = userEvent.setup();
    const services = createTestServices();
    await seed(services, { id: 'm-1', name: 'Demoxal' });
    renderApp(services);
    await user.click(await screen.findByRole('button', { name: 'Zakończ lek Demoxal' }));

    services.storage.failWrites(createQuotaError(), (key) => key === STORAGE_KEYS.medications);
    await user.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Zakończ lek' }),
    );

    expect(await within(screen.getByRole('dialog')).findByRole('alert')).toHaveTextContent(
      'brakuje miejsca',
    );
    expect(screen.queryByText(/Zakończono lek/)).not.toBeInTheDocument();
    services.storage.heal();
    expect((await services.repositories.medications.get('m-1')).endDate).toBeNull();
  });
});

describe('deleting a medication permanently', () => {
  it('states the consequences and the number of history records before asking, and focuses "Anuluj"', async () => {
    const user = userEvent.setup();
    const services = createTestServices();
    await seed(services, { id: 'm-1', name: 'Demoxal' });
    await addLogs(services, 'm-1', 3);
    renderApp(services);

    await user.click(await screen.findByRole('button', { name: 'Usuń trwale… lek Demoxal' }));

    const dialog = await screen.findByRole('dialog', { name: 'Trwale usunąć lek „Demoxal”?' });
    expect(dialog).toHaveTextContent(
      'lek, jego harmonogram i cała historia przyjmowania: 3 zapisy',
    );
    expect(dialog).toHaveTextContent('Tej operacji nie można cofnąć');
    expect(
      within(dialog).getByRole('button', { name: 'Zakończ lek zamiast usuwać' }),
    ).toBeVisible();
    expect(within(dialog).getByRole('button', { name: 'Anuluj' })).toHaveFocus();
  });

  it.each([
    [0, '0 zapisów'],
    [1, '1 zapis'],
    [5, '5 zapisów'],
  ])('uses the right Polish word for %s records', async (count, expected) => {
    const user = userEvent.setup();
    const services = createTestServices();
    await seed(services, { id: 'm-1', name: 'Demoxal' });
    await addLogs(services, 'm-1', count);
    renderApp(services);

    await user.click(await screen.findByRole('button', { name: 'Usuń trwale… lek Demoxal' }));

    expect(await screen.findByRole('dialog')).toHaveTextContent(
      `historia przyjmowania: ${expected}`,
    );
  });

  it('counts only the records of this medication', async () => {
    const user = userEvent.setup();
    const services = createTestServices();
    await seed(services, { id: 'm-1', name: 'Demoxal' }, { id: 'm-2', name: 'Inny' });
    await addLogs(services, 'm-1', 2);
    await addLogs(services, 'm-2', 4);
    renderApp(services);

    await user.click(await screen.findByRole('button', { name: 'Usuń trwale… lek Demoxal' }));

    expect(await screen.findByRole('dialog')).toHaveTextContent('2 zapisy');
  });

  it('changes nothing when cancelled', async () => {
    const user = userEvent.setup();
    const services = createTestServices();
    await seed(services, { id: 'm-1', name: 'Demoxal' });
    await addLogs(services, 'm-1', 3);
    const medicationBefore = await services.repositories.medications.get('m-1');
    const logsBefore = await logsOf(services, 'm-1');
    const writesBefore = services.storage.writes.length;
    renderApp(services);

    await user.click(await screen.findByRole('button', { name: 'Usuń trwale… lek Demoxal' }));
    await user.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Anuluj' }),
    );

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(await services.repositories.medications.get('m-1')).toEqual(medicationBefore);
    expect(await logsOf(services, 'm-1')).toEqual(logsBefore);
    expect(services.storage.writes.length).toBe(writesBefore);
    expect(screen.getByRole('article', { name: 'Demoxal' })).toBeVisible();
  });

  it('deletes the medication and its history on confirmation, leaving other medications alone', async () => {
    const user = userEvent.setup();
    const services = createTestServices();
    await seed(services, { id: 'm-1', name: 'Demoxal' }, { id: 'm-2', name: 'Inny' });
    await addLogs(services, 'm-1', 3);
    await addLogs(services, 'm-2', 2);
    const otherLogs = await logsOf(services, 'm-2');
    renderApp(services);

    await user.click(await screen.findByRole('button', { name: 'Usuń trwale… lek Demoxal' }));
    await user.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Usuń trwale' }),
    );

    expect(
      await screen.findByText('Usunięto lek „Demoxal” razem z historią przyjmowania (3 zapisy).'),
    ).toBeVisible();
    expect(screen.queryByRole('article', { name: 'Demoxal' })).not.toBeInTheDocument();
    expect(await services.repositories.medications.list()).toHaveLength(1);
    expect(await logsOf(services, 'm-1')).toEqual([]);
    expect(await logsOf(services, 'm-2')).toEqual(otherLogs);
  });

  it('choosing "end instead" ends the medication and preserves its whole history', async () => {
    const user = userEvent.setup();
    const services = createTestServices();
    await seed(services, { id: 'm-1', name: 'Demoxal' });
    await addLogs(services, 'm-1', 3);
    const logsBefore = await logsOf(services, 'm-1');
    renderApp(services);

    await user.click(await screen.findByRole('button', { name: 'Usuń trwale… lek Demoxal' }));
    await user.click(
      within(await screen.findByRole('dialog')).getByRole('button', {
        name: 'Zakończ lek zamiast usuwać',
      }),
    );
    const endDialog = await screen.findByRole('dialog', { name: 'Zakończyć lek „Demoxal”?' });
    await user.click(within(endDialog).getByRole('button', { name: 'Zakończ lek' }));

    expect(await screen.findByText(/Zakończono lek „Demoxal”/)).toBeVisible();
    expect((await services.repositories.medications.get('m-1')).endDate).toBe('2026-10-15');
    expect(await logsOf(services, 'm-1')).toEqual(logsBefore);
    expect(screen.queryByText(/Usunięto lek/)).not.toBeInTheDocument();
  });

  it('does not offer deletion, and says why, when the history cannot be counted', async () => {
    const user = userEvent.setup();
    const services = createTestServices();
    await seed(services, { id: 'm-1', name: 'Demoxal' });
    renderApp(services);
    await screen.findByRole('article', { name: 'Demoxal' });
    vi.spyOn(services.repositories.doseLogs, 'countForMedication').mockRejectedValue(
      new RepositoryError('data-corrupted'),
    );

    await user.click(screen.getByRole('button', { name: 'Usuń trwale… lek Demoxal' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Nie można rozpocząć usuwania');
    expect(alert).toHaveTextContent('Zapisane dane są uszkodzone');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(await services.repositories.medications.list()).toHaveLength(1);
  });

  it('reports a failed deletion without claiming success; the medication and history are still there', async () => {
    const user = userEvent.setup();
    const services = createTestServices();
    await seed(services, { id: 'm-1', name: 'Demoxal' });
    await addLogs(services, 'm-1', 3);
    renderApp(services);
    await user.click(await screen.findByRole('button', { name: 'Usuń trwale… lek Demoxal' }));
    const dialog = await screen.findByRole('dialog');

    services.storage.failWrites(createQuotaError(), (key) => key === STORAGE_KEYS.doseLogs);
    await user.click(within(dialog).getByRole('button', { name: 'Usuń trwale' }));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent('brakuje miejsca');
    expect(screen.queryByText(/Usunięto lek/)).not.toBeInTheDocument();
    services.storage.heal();
    expect(await services.repositories.medications.get('m-1')).toBeDefined();
    expect(await logsOf(services, 'm-1')).toHaveLength(3);
  });

  it('warns that data may be inconsistent when even the rollback failed', async () => {
    const user = userEvent.setup();
    const services = createTestServices();
    await seed(services, { id: 'm-1', name: 'Demoxal' });
    await addLogs(services, 'm-1', 2);
    renderApp(services);
    await user.click(await screen.findByRole('button', { name: 'Usuń trwale… lek Demoxal' }));
    const dialog = await screen.findByRole('dialog');

    let medicationWrites = 0;
    services.storage.failWrites(
      createQuotaError(),
      (key) => key === STORAGE_KEYS.doseLogs || ++medicationWrites > 1,
    );
    await user.click(within(dialog).getByRole('button', { name: 'Usuń trwale' }));

    const alert = await within(dialog).findByRole('alert');
    expect(alert).toHaveTextContent('Dane mogą być niespójne');
    expect(screen.queryByText(/Usunięto lek/)).not.toBeInTheDocument();
  });

  it('can be dismissed with the keyboard-standard close event, without deleting', async () => {
    const user = userEvent.setup();
    const services = createTestServices();
    await seed(services, { id: 'm-1', name: 'Demoxal' });
    renderApp(services);
    await user.click(await screen.findByRole('button', { name: 'Usuń trwale… lek Demoxal' }));

    (await screen.findByRole<HTMLDialogElement>('dialog')).close();

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    expect(await services.repositories.medications.list()).toHaveLength(1);
  });

  it('marks the destructive action in words ("trwale") and with an icon, not only with colour', async () => {
    const services = createTestServices();
    await seed(services, { id: 'm-1', name: 'Demoxal' });
    renderApp(services);

    const button = await screen.findByRole('button', { name: 'Usuń trwale… lek Demoxal' });

    expect(button).toHaveTextContent('Usuń trwale…');
    expect(button.querySelector('svg')).not.toBeNull();
  });
});

describe('persistence and messages', () => {
  it('shows the result of ending and deleting again after a reload', async () => {
    const user = userEvent.setup();
    const storage = createFakeStorage();
    const first = createTestServices(storage);
    await seed(
      first,
      { id: 'm-1', name: 'Do zakończenia' },
      { id: 'm-2', name: 'Do usunięcia' },
      { id: 'm-3', name: 'Zostaje' },
    );
    renderApp(first);

    await user.click(await screen.findByRole('button', { name: 'Zakończ lek Do zakończenia' }));
    fireEvent.change(screen.getByLabelText(/Ostatni dzień przyjmowania/), {
      target: { value: '2026-10-14' },
    });
    await user.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Zakończ lek' }),
    );
    await screen.findByText(/Zakończono lek/);
    await user.click(screen.getByRole('button', { name: 'Usuń trwale… lek Do usunięcia' }));
    await user.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Usuń trwale' }),
    );
    await screen.findByText(/Usunięto lek/);

    cleanup(); // the page is gone, as after closing the tab
    renderApp(createTestServices(storage));

    expect(await screen.findByRole('article', { name: 'Zostaje' })).toBeVisible();
    expect(card('Do zakończenia').getByText('Zakończony')).toBeVisible();
    expect(screen.queryByRole('article', { name: 'Do usunięcia' })).not.toBeInTheDocument();
    expect(screen.queryByText(/Zakończono lek/)).not.toBeInTheDocument();
  });

  it('shows a message handed over by the previous page once, and not again after the page is reloaded', async () => {
    const services = createTestServices();
    await seed(services, { id: 'm-1', name: 'Demoxal' });

    const { router } = renderApp(services, {
      pathname: '/medications',
      state: { notice: 'Dodano lek „Demoxal”.' },
    });

    expect(await screen.findByText('Dodano lek „Demoxal”.')).toBeVisible();
    await waitFor(() => {
      expect(router.state.location.state).toBeNull();
    });
  });

  it('lets the message be closed', async () => {
    const user = userEvent.setup();
    const services = createTestServices();
    await seed(services, { id: 'm-1', name: 'Demoxal' });
    renderApp(services, { pathname: '/medications', state: { notice: 'Dodano lek „Demoxal”.' } });

    await user.click(await screen.findByRole('button', { name: 'Zamknij komunikat' }));

    expect(screen.queryByText('Dodano lek „Demoxal”.')).not.toBeInTheDocument();
  });
});
