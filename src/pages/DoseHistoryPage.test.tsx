import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { ServicesProvider } from '@/app/ServicesProvider';
import { routes } from '@/app/routes';
import type { DoseLog } from '@/features/doses/types';
import { STORAGE_KEYS } from '@/services/local/collections';
import type { AppServices } from '@/services/repositories';
import { createFakeStorage } from '@/test/fakeStorage';
import { makeDoseLog, makeMedication, scheduleTime } from '@/test/fixtures';
import { createDeferred, createTestServices } from '@/test/services';
import { asLocalDate, asLocalTime, asTimestamp } from '@/utils/date';

function renderApp(services: AppServices = createTestServices(), entry = '/doses/history') {
  const router = createMemoryRouter(routes, { initialEntries: [entry] });
  render(
    <ServicesProvider services={services}>
      <RouterProvider router={router} />
    </ServicesProvider>,
  );
  return { router, services };
}

async function seedMedications(
  services: AppServices,
  ...overrides: Parameters<typeof makeMedication>[0][]
) {
  for (const override of overrides) {
    await services.repositories.medications.create(makeMedication(override));
  }
}

async function seedLogs(services: AppServices, ...logs: Partial<DoseLog>[]) {
  for (const entry of logs) {
    await services.repositories.doseLogs.upsert(makeDoseLog({ medicationId: 'm-1', ...entry }));
  }
}

/** [date, time, medication name, status word] of every record shown, top to bottom. */
function shownRecords() {
  return screen
    .getAllByRole('listitem')
    .filter((item) => item.querySelector('time'))
    .map((item) => {
      const section = item.closest('section');
      return [
        section?.querySelector('h3')?.textContent,
        item.querySelector('time')?.textContent,
        item.querySelector('p.font-medium')?.textContent,
        item.textContent.includes('Przyjęta') ? 'Przyjęta' : 'Pominięta',
      ];
    });
}

const d = asLocalDate;
const t = asLocalTime;

describe('history: states', () => {
  it('shows loading, then the records', async () => {
    const services = createTestServices();
    await seedMedications(services, { id: 'm-1', name: 'Demoxal' });
    await seedLogs(services, { id: 'l-1' });

    renderApp(services);

    expect(screen.getByText('Wczytywanie historii…')).toBeVisible();
    expect(await screen.findByText('Znaleziono 1 zapis')).toBeVisible();
    expect(screen.getByRole('heading', { level: 1, name: 'Historia przyjmowania' })).toBeVisible();
  });

  it('explains an empty history and points to the doses, without showing filters', async () => {
    const services = createTestServices();
    await seedMedications(services, { id: 'm-1' });

    renderApp(services);

    expect(await screen.findByRole('heading', { name: 'Historia jest pusta' })).toBeVisible();
    expect(screen.getByRole('link', { name: 'Przejdź do dawek' })).toHaveAttribute(
      'href',
      '/doses',
    );
    expect(screen.queryByRole('group', { name: 'Filtry' })).not.toBeInTheDocument();
  });

  it('shows a failure as an error with a retry that works, never as an empty history', async () => {
    const user = userEvent.setup();
    const services = createTestServices(createFakeStorage({ [STORAGE_KEYS.doseLogs]: '{broken' }));
    await seedMedications(services, { id: 'm-1' });

    renderApp(services);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Nie udało się wczytać historii');
    expect(screen.queryByText('Historia jest pusta')).not.toBeInTheDocument();
    expect(services.storage.data.get(STORAGE_KEYS.doseLogs)).toBe('{broken');

    services.storage.data.set(STORAGE_KEYS.doseLogs, JSON.stringify({ version: 1, items: [] }));
    await user.click(screen.getByRole('button', { name: 'Spróbuj ponownie' }));
    expect(await screen.findByRole('heading', { name: 'Historia jest pusta' })).toBeVisible();
  });
});

describe('history: what is shown', () => {
  it('lists only recorded doses, newest day first and earliest time first within a day', async () => {
    const services = createTestServices();
    await seedMedications(services, { id: 'm-1', name: 'Żyrafa' }, { id: 'm-2', name: 'Ąbc' });
    await seedLogs(
      services,
      { id: 'a', medicationId: 'm-1', scheduledDate: d('2026-10-13'), scheduledTime: t('08:00') },
      {
        id: 'b',
        medicationId: 'm-1',
        scheduledDate: d('2026-10-14'),
        scheduledTime: t('20:00'),
        status: 'skipped',
      },
      { id: 'c', medicationId: 'm-2', scheduledDate: d('2026-10-14'), scheduledTime: t('08:00') },
      { id: 'e', medicationId: 'm-1', scheduledDate: d('2026-10-14'), scheduledTime: t('08:00') },
    );

    renderApp(services);

    await screen.findByText('Znaleziono 4 zapisy');
    expect(shownRecords()).toEqual([
      ['środa, 14 października 2026', '08:00', 'Ąbc', 'Przyjęta'],
      ['środa, 14 października 2026', '08:00', 'Żyrafa', 'Przyjęta'],
      ['środa, 14 października 2026', '20:00', 'Żyrafa', 'Pominięta'],
      ['wtorek, 13 października 2026', '08:00', 'Żyrafa', 'Przyjęta'],
    ]);
  });

  it('does not show planned doses that were never recorded', async () => {
    const services = createTestServices();
    // A schedule with three doses a day, from long ago: none of them is "history" until recorded.
    await seedMedications(services, {
      id: 'm-1',
      scheduleTimes: [
        scheduleTime('a', '08:00'),
        scheduleTime('b', '14:00'),
        scheduleTime('c', '20:00'),
      ],
    });
    await seedLogs(services, { id: 'only', scheduledTime: t('14:00') });

    renderApp(services);

    await screen.findByText('Znaleziono 1 zapis');
    expect(shownRecords()).toHaveLength(1);
  });

  it('shows the amount and unit as they were recorded, not the medication as it is now', async () => {
    const services = createTestServices();
    await seedMedications(services, {
      id: 'm-1',
      name: 'Nowa nazwa',
      doseUnit: 'ml',
      scheduleTimes: [scheduleTime('a', '08:00', 10)],
    });
    await seedLogs(services, { id: 'l-1', doseAmount: 2, doseUnit: 'tabletka' });

    renderApp(services);

    expect(await screen.findByText('Zapisana dawka: 2 tabletki')).toBeVisible();
    expect(screen.queryByText(/10 ml/)).not.toBeInTheDocument();
    expect(shownRecords().map((row) => row[2])).toEqual(['Nowa nazwa']);
  });

  it('tells taken from skipped with words, and shows when each was recorded', async () => {
    const services = createTestServices();
    await seedMedications(services, { id: 'm-1' });
    await seedLogs(
      services,
      {
        id: 'a',
        scheduledTime: t('08:00'),
        status: 'taken',
        recordedAt: asTimestamp('2026-10-15T06:05:00Z'),
      },
      {
        id: 'b',
        scheduledTime: t('20:00'),
        status: 'skipped',
        recordedAt: asTimestamp('2026-10-15T18:30:00Z'),
      },
    );

    renderApp(services);

    await screen.findByText('Znaleziono 2 zapisy');
    expect(screen.getByText('Przyjęta')).toBeVisible();
    expect(screen.getByText('Pominięta')).toBeVisible();
    expect(screen.getByText('Zapisano 15 października 2026 08:05.')).toBeVisible();
    expect(screen.getByText('Zapisano 15 października 2026 20:30.')).toBeVisible();
  });

  it('labels records outside the current schedule and says why, without hiding them', async () => {
    const services = createTestServices();
    await seedMedications(services, {
      id: 'm-1',
      name: 'Demoxal',
      scheduleEffectiveFrom: d('2026-10-10'),
      scheduleTimes: [scheduleTime('a', '08:00')],
    });
    await seedLogs(
      services,
      { id: 'in', scheduledDate: d('2026-10-12'), scheduledTime: t('08:00') },
      { id: 'old', scheduledDate: d('2026-10-05'), scheduledTime: t('08:00') },
      { id: 'time', scheduledDate: d('2026-10-12'), scheduledTime: t('12:30') },
    );

    renderApp(services);

    await screen.findByText('Znaleziono 3 zapisy');
    expect(screen.getAllByText('Poza aktualnym harmonogramem')).toHaveLength(2);
    expect(screen.getByText(/Zapis pochodzi sprzed zmiany harmonogramu/)).toBeVisible();
    expect(screen.getByText('Obecny harmonogram nie ma dawki o tej godzinie.')).toBeVisible();
  });

  it('shows records of a deleted medication as belonging to a deleted medication', async () => {
    const services = createTestServices();
    await seedMedications(services, { id: 'm-1', name: 'Demoxal' });
    services.storage.data.set(
      STORAGE_KEYS.doseLogs,
      JSON.stringify({
        version: 1,
        items: [makeDoseLog({ id: 'orphan', medicationId: 'm-gone' })],
      }),
    );

    renderApp(services);

    expect(await screen.findByText('Usunięty lek')).toBeVisible();
    expect(screen.getByText('Poza aktualnym harmonogramem')).toBeVisible();
  });
});

describe('history: filters', () => {
  async function setup() {
    const services = createTestServices();
    await seedMedications(services, { id: 'm-1', name: 'Lek A' }, { id: 'm-2', name: 'Lek B' });
    await seedLogs(
      services,
      { id: '1', medicationId: 'm-1', scheduledDate: d('2026-10-01'), status: 'taken' },
      { id: '2', medicationId: 'm-1', scheduledDate: d('2026-10-05'), status: 'skipped' },
      { id: '3', medicationId: 'm-2', scheduledDate: d('2026-10-05'), status: 'taken' },
      { id: '4', medicationId: 'm-2', scheduledDate: d('2026-10-10'), status: 'taken' },
    );
    return services;
  }
  const names = () =>
    shownRecords().map(([day, , name, status]) => `${day ?? ''} ${name ?? ''} ${status ?? ''}`);

  it('filters by medication', async () => {
    const user = userEvent.setup();
    renderApp(await setup());
    await screen.findByText('Znaleziono 4 zapisy');

    await user.selectOptions(screen.getByLabelText('Lek'), 'Lek B');

    expect(await screen.findByText('Znaleziono 2 zapisy dla wybranych filtrów')).toBeVisible();
    expect(shownRecords().map((row) => row[2])).toEqual(['Lek B', 'Lek B']);
  });

  it('filters by status', async () => {
    const user = userEvent.setup();
    renderApp(await setup());
    await screen.findByText('Znaleziono 4 zapisy');

    await user.selectOptions(screen.getByLabelText('Status'), 'Pominięte');

    expect(await screen.findByText('Znaleziono 1 zapis dla wybranych filtrów')).toBeVisible();
    expect(names()).toEqual(['poniedziałek, 5 października 2026 Lek A Pominięta']);
  });

  it('filters by date range, both ends included', async () => {
    renderApp(await setup());
    await screen.findByText('Znaleziono 4 zapisy');

    fireEvent.change(screen.getByLabelText('Od dnia'), { target: { value: '2026-10-05' } });
    fireEvent.change(screen.getByLabelText('Do dnia'), { target: { value: '2026-10-10' } });

    expect(await screen.findByText('Znaleziono 3 zapisy dla wybranych filtrów')).toBeVisible();
    expect(shownRecords().map((row) => row[0])).toEqual([
      'sobota, 10 października 2026',
      'poniedziałek, 5 października 2026',
      'poniedziałek, 5 października 2026',
    ]);
  });

  it('combines filters', async () => {
    const user = userEvent.setup();
    renderApp(await setup());
    await screen.findByText('Znaleziono 4 zapisy');

    await user.selectOptions(screen.getByLabelText('Lek'), 'Lek A');
    await user.selectOptions(screen.getByLabelText('Status'), 'Przyjęte');

    expect(await screen.findByText('Znaleziono 1 zapis dla wybranych filtrów')).toBeVisible();
    expect(shownRecords().map((row) => row[0])).toEqual(['czwartek, 1 października 2026']);
  });

  it('says when nothing matches, keeps the filters visible, and clears them on request', async () => {
    const user = userEvent.setup();
    renderApp(await setup());
    await screen.findByText('Znaleziono 4 zapisy');

    await user.selectOptions(screen.getByLabelText('Lek'), 'Lek A');
    fireEvent.change(screen.getByLabelText('Od dnia'), { target: { value: '2026-10-08' } });

    expect(
      await screen.findByRole('heading', { name: 'Brak zapisów dla wybranych filtrów' }),
    ).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Brak zapisów' })).toBeVisible();
    expect(screen.getByLabelText('Lek')).toHaveValue('m-1');
    expect(screen.queryByText('Historia jest pusta')).not.toBeInTheDocument();

    // The filters have a "Wyczyść filtry" button too; the one in the empty state is the last.
    const clearButton = screen.getAllByRole('button', { name: 'Wyczyść filtry' }).at(-1);
    if (clearButton === undefined) throw new Error('No "Wyczyść filtry" button');
    await user.click(clearButton);

    expect(await screen.findByText('Znaleziono 4 zapisy')).toBeVisible();
    expect(screen.getByLabelText('Lek')).toHaveValue('');
    expect(screen.getByLabelText('Od dnia')).toHaveValue('');
  });

  it('warns when the range ends before it starts, instead of silently showing nothing', async () => {
    renderApp(await setup());
    await screen.findByText('Znaleziono 4 zapisy');

    fireEvent.change(screen.getByLabelText('Od dnia'), { target: { value: '2026-10-10' } });
    fireEvent.change(screen.getByLabelText('Do dnia'), { target: { value: '2026-10-01' } });

    expect(await screen.findByText('Data początkowa jest późniejsza niż końcowa.')).toBeVisible();
    expect(screen.getByLabelText('Od dnia')).toBeInvalid();
    expect(screen.getByText(/więc żaden zapis nie pasuje/)).toBeVisible();
  });

  it('keeps the filters in the address, so a reload shows the same view', async () => {
    const services = await setup();
    const { router } = renderApp(services);
    await screen.findByText('Znaleziono 4 zapisy');
    fireEvent.change(screen.getByLabelText('Od dnia'), { target: { value: '2026-10-05' } });
    await screen.findByText('Znaleziono 3 zapisy dla wybranych filtrów');
    expect(router.state.location.search).toBe('?from=2026-10-05');
    cleanup();

    renderApp(services, '/doses/history?from=2026-10-05&status=taken');

    expect(await screen.findByText('Znaleziono 2 zapisy dla wybranych filtrów')).toBeVisible();
    expect(screen.getByLabelText('Status')).toHaveValue('taken');
  });

  it('ignores unusable filters from the address, and says so', async () => {
    renderApp(await setup(), '/doses/history?from=2026-02-30&status=missed&medication=nope');

    expect(await screen.findByText('Znaleziono 4 zapisy')).toBeVisible();
    expect(screen.getByText('Pominięto nieprawidłowe filtry z adresu strony.')).toBeVisible();
  });

  it('labels every filter and can be reached with the keyboard', async () => {
    const user = userEvent.setup();
    renderApp(await setup());
    await screen.findByText('Znaleziono 4 zapisy');

    const group = screen.getByRole('group', { name: 'Filtry' });
    for (const label of ['Od dnia', 'Do dnia', 'Lek', 'Status']) {
      expect(within(group).getByLabelText(label)).toBeVisible();
    }
    await user.click(screen.getByRole('link', { name: 'Widok dnia' }));
    await user.tab();
    expect(document.activeElement).not.toBe(document.body);
  });
});

describe('history: deleting a record outside the current schedule', () => {
  // The schedule took effect on 10 October: the record of 5 October is outside it, the one of
  // 12 October is inside it.
  async function setup() {
    const services = createTestServices();
    await seedMedications(services, {
      id: 'm-1',
      name: 'Demoxal',
      startDate: d('2026-09-01'),
      scheduleEffectiveFrom: d('2026-10-10'),
      scheduleTimes: [scheduleTime('a', '08:00'), scheduleTime('b', '20:00')],
    });
    await seedLogs(
      services,
      { id: 'outside', scheduledDate: d('2026-10-05'), scheduledTime: t('08:00'), status: 'taken' },
      {
        id: 'same-day',
        scheduledDate: d('2026-10-05'),
        scheduledTime: t('20:00'),
        status: 'skipped',
      },
      { id: 'inside', scheduledDate: d('2026-10-12'), scheduledTime: t('08:00') },
    );
    return services;
  }
  const deleteButton = (name = 'Demoxal, 5 października 2026, 08:00') =>
    screen.findByRole('button', { name: `Usuń zapis…: ${name}` });
  const idsLeft = async (services: AppServices) =>
    (await services.repositories.doseLogs.listByDateRange(d('2000-01-01'), d('2999-12-31'))).map(
      (entry) => entry.id,
    );

  it('offers deletion only for records that no longer match the schedule', async () => {
    renderApp(await setup());

    await screen.findByText('Znaleziono 3 zapisy');

    // Both records of 5 October are outside the schedule; the one of 12 October is not.
    expect(screen.getAllByRole('button', { name: /^Usuń zapis…: / })).toHaveLength(2);
    expect(await deleteButton('Demoxal, 5 października 2026, 08:00')).toBeVisible();
    expect(await deleteButton('Demoxal, 5 października 2026, 20:00')).toBeVisible();
    expect(screen.queryByRole('button', { name: /12 października/ })).not.toBeInTheDocument();
  });

  it('asks first, says exactly what will go and what will not, and focuses Cancel', async () => {
    const user = userEvent.setup();
    const services = await setup();
    renderApp(services);

    await user.click(await deleteButton());

    const dialog = await screen.findByRole('dialog', { name: 'Usunąć ten zapis z historii?' });
    expect(dialog).toHaveTextContent('Demoxal, 5 października 2026, 08:00: przyjęta, 1 tabletka.');
    expect(dialog).toHaveTextContent('Zapis jest poza aktualnym harmonogramem.');
    expect(dialog).toHaveTextContent('trwale usunięty');
    expect(dialog).toHaveTextContent('Tej operacji nie można cofnąć');
    expect(dialog).toHaveTextContent('Harmonogram i inne zapisy pozostaną bez zmian');
    expect(dialog).toHaveTextContent('szacunkowy zapas leku może się zwiększyć');
    expect(within(dialog).getByRole('button', { name: 'Anuluj' })).toHaveFocus();
    expect(await idsLeft(services)).toHaveLength(3); // nothing happened yet
  });

  it('Cancel, the close button and an outside click change nothing', async () => {
    const user = userEvent.setup();
    const services = await setup();
    renderApp(services);

    await user.click(await deleteButton());
    await user.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Anuluj' }),
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    await user.click(await deleteButton());
    await user.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Zamknij okno' }),
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    expect(await idsLeft(services)).toHaveLength(3);
    expect(screen.queryByText(/Usunięto zapis/)).not.toBeInTheDocument();
  });

  it('deletes exactly the confirmed record, says so, and moves focus to the results', async () => {
    const user = userEvent.setup();
    const services = await setup();
    renderApp(services);

    await user.click(await deleteButton());
    await user.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Usuń zapis' }),
    );

    const notice = await screen.findByText('Usunięto zapis: Demoxal, 5 października 2026, 08:00.');
    expect(notice.closest('[role="status"]')).toHaveAttribute('aria-live', 'polite');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect((await idsLeft(services)).sort()).toEqual(['inside', 'same-day']);
    expect(await screen.findByText('Znaleziono 2 zapisy')).toBeVisible();
    expect(screen.queryByRole('button', { name: /8:00.*Usuń/ })).not.toBeInTheDocument();
    expect(await deleteButton('Demoxal, 5 października 2026, 20:00')).toBeVisible();
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Znaleziono 2 zapisy' })).toHaveFocus();
    });
  });

  it('a double click on the confirm button deletes once', async () => {
    const user = userEvent.setup();
    const services = await setup();
    const gate = createDeferred<undefined>();
    const remove = services.repositories.doseLogs.remove.bind(services.repositories.doseLogs);
    const spy = vi
      .spyOn(services.repositories.doseLogs, 'remove')
      .mockImplementation(async (slot) => {
        await gate.promise;
        return remove(slot);
      });
    renderApp(services);
    await user.click(await deleteButton());
    const confirm = within(await screen.findByRole('dialog')).getByRole('button', {
      name: 'Usuń zapis',
    });

    await user.dblClick(confirm);
    gate.resolve(undefined);

    await screen.findByText(/Usunięto zapis/);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(await idsLeft(services)).toHaveLength(2);
  });

  it('keeps the dialog open with the reason when storage fails, and the record stays', async () => {
    const user = userEvent.setup();
    const services = await setup();
    renderApp(services);
    await user.click(await deleteButton());
    const dialog = await screen.findByRole('dialog');
    services.storage.failWrites();

    await user.click(within(dialog).getByRole('button', { name: 'Usuń zapis' }));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Nie usunięto zapisu.');
    expect(within(dialog).getByRole('alert')).toHaveTextContent('Zmiany nie zostały zapisane');
    expect(screen.queryByText(/Usunięto zapis/)).not.toBeInTheDocument();
    services.storage.heal();
    expect(await idsLeft(services)).toHaveLength(3);

    // After the problem is gone the same dialog works.
    await user.click(within(dialog).getByRole('button', { name: 'Usuń zapis' }));
    expect(await screen.findByText(/Usunięto zapis/)).toBeVisible();
    expect(await idsLeft(services)).toHaveLength(2);
  });

  it('refuses, explains and refreshes when the record was changed elsewhere meanwhile', async () => {
    const user = userEvent.setup();
    const services = await setup();
    renderApp(services);
    await user.click(await deleteButton());
    const dialog = await screen.findByRole('dialog');
    // In another tab the record's status is changed after the dialog was opened.
    await services.repositories.doseLogs.upsert(
      makeDoseLog({
        id: 'outside',
        medicationId: 'm-1',
        scheduledDate: d('2026-10-05'),
        scheduledTime: t('08:00'),
        status: 'skipped',
      }),
    );

    await user.click(within(dialog).getByRole('button', { name: 'Usuń zapis' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Nie usunięto zapisu');
    expect(alert).toHaveTextContent('został w międzyczasie zmieniony');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(await idsLeft(services)).toHaveLength(3);
    expect(await screen.findByText('Znaleziono 3 zapisy')).toBeVisible();
  });

  it('can delete a leftover record of a deleted medication, and shows the empty history afterwards', async () => {
    const user = userEvent.setup();
    const services = createTestServices();
    await seedMedications(services, { id: 'm-1', name: 'Demoxal' });
    services.storage.data.set(
      STORAGE_KEYS.doseLogs,
      JSON.stringify({
        version: 2,
        items: [
          makeDoseLog({ id: 'orphan', medicationId: 'm-gone', scheduledDate: d('2026-10-05') }),
        ],
      }),
    );
    renderApp(services);

    await user.click(
      await screen.findByRole('button', {
        name: 'Usuń zapis…: Usunięty lek, 5 października 2026, 08:00',
      }),
    );
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('Ten lek został usunięty, a jego zapis pozostał.');
    await user.click(within(dialog).getByRole('button', { name: 'Usuń zapis' }));

    expect(await screen.findByRole('heading', { name: 'Historia jest pusta' })).toBeVisible();
    expect(screen.getByText(/Usunięto zapis: Usunięty lek/)).toBeVisible();
    await waitFor(() => {
      expect(document.getElementById('main-content')).toHaveFocus();
    });
  });

  it('can be done with the keyboard alone', async () => {
    const user = userEvent.setup();
    const services = await setup();
    renderApp(services);
    (await deleteButton()).focus();

    await user.keyboard('{Enter}');
    // Initial focus is on Cancel, so a second Enter cannot delete by accident.
    await user.keyboard('{Enter}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(await idsLeft(services)).toHaveLength(3);

    (await deleteButton()).focus();
    await user.keyboard('{Enter}');
    await user.tab();
    expect(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Usuń zapis' }),
    ).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(await screen.findByText(/Usunięto zapis/)).toBeVisible();
  });
});
