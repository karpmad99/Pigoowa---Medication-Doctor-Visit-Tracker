import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { ServicesProvider } from '@/app/ServicesProvider';
import { routes } from '@/app/routes';
import { STORAGE_KEYS } from '@/services/local/collections';
import { createLocalServices } from '@/services/local/createLocalServices';
import type { AppServices } from '@/services/repositories';
import { createFakeStorage } from '@/test/fakeStorage';
import { makeDoseLog, makeMedication, scheduleTime } from '@/test/fixtures';
import { createDeferred, createTestServices } from '@/test/services';
import { createFixedClock } from '@/utils/clock';
import { asLocalDate, asLocalTime, asTimestamp } from '@/utils/date';
import type { DoseLog } from '@/features/doses/types';

// The test clock says 12:00 on Thursday 15 October 2026 in Warsaw, so "today" is 2026-10-15.

function renderApp(services: AppServices = createTestServices(), entry = '/doses') {
  const router = createMemoryRouter(routes, { initialEntries: [entry] });
  render(
    <ServicesProvider services={services}>
      <RouterProvider router={router} />
    </ServicesProvider>,
  );
  return { router, services };
}

async function seed(services: AppServices, ...overrides: Parameters<typeof makeMedication>[0][]) {
  for (const override of overrides) {
    await services.repositories.medications.create(makeMedication(override));
  }
}

const allLogs = (services: AppServices) =>
  services.repositories.doseLogs.listByDateRange(
    asLocalDate('2000-01-01'),
    asLocalDate('2999-12-31'),
  );

const taken = (name: string, time: string) =>
  screen.findByRole('button', { name: `Oznacz jako przyjętą: ${name}, ${time}` });
const skipped = (name: string, time: string) =>
  screen.findByRole('button', { name: `Oznacz jako pominiętą: ${name}, ${time}` });

/** An intake record of the medication `m-1` that the tests seed (the fixture's own default is `med-1`). */
function log(overrides: Partial<DoseLog>): DoseLog {
  return makeDoseLog({ medicationId: 'm-1', ...overrides });
}

/** The status text of one row, e.g. "Przyjęta". */
const statusOf = (name: string, time: string) =>
  screen.findByText(
    (_content, element) =>
      element?.tagName === 'P' && element.textContent.startsWith(`${name}, ${time}: `),
  );

describe('day view: states', () => {
  it('shows loading, then the doses of today', async () => {
    const services = createTestServices();
    await seed(services, { id: 'm-1', name: 'Demoxal' });

    renderApp(services);

    expect(screen.getByText('Wczytywanie dawek…')).toBeVisible();
    expect(await taken('Demoxal', '08:00')).toBeVisible();
    expect(screen.getByRole('heading', { level: 1, name: 'Dawki' })).toBeVisible();
    expect(screen.queryByText('Wczytywanie dawek…')).not.toBeInTheDocument();
  });

  it('explains that no medication exists yet, with a way to add one', async () => {
    const user = userEvent.setup();
    const { router } = renderApp();

    expect(
      await screen.findByRole('heading', { name: 'Nie dodano jeszcze żadnego leku' }),
    ).toBeVisible();
    await user.click(screen.getByRole('link', { name: 'Dodaj pierwszy lek' }));

    expect(router.state.location.pathname).toBe('/medications/new');
  });

  it('says plainly that nothing is planned on a day without doses', async () => {
    const services = createTestServices();
    await seed(services, {
      id: 'm-1',
      startDate: asLocalDate('2026-11-01'),
      scheduleEffectiveFrom: asLocalDate('2026-11-01'),
    });

    renderApp(services);

    expect(
      await screen.findByRole('heading', { name: 'Brak zaplanowanych dawek tego dnia' }),
    ).toBeVisible();
    expect(screen.queryByRole('button', { name: /Oznacz jako/ })).not.toBeInTheDocument();
  });

  it('shows a loading failure as an error with a retry that works, never as an empty day', async () => {
    const user = userEvent.setup();
    const services = createTestServices(createFakeStorage({ [STORAGE_KEYS.doseLogs]: '{broken' }));
    await seed(services, { id: 'm-1', name: 'Demoxal' });

    renderApp(services);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Nie udało się wczytać dawek');
    expect(alert).toHaveTextContent('Zapisane dane są uszkodzone');
    expect(screen.queryByText('Brak zaplanowanych dawek tego dnia')).not.toBeInTheDocument();
    expect(services.storage.data.get(STORAGE_KEYS.doseLogs)).toBe('{broken');

    services.storage.data.set(STORAGE_KEYS.doseLogs, JSON.stringify({ version: 1, items: [] }));
    await user.click(screen.getByRole('button', { name: 'Spróbuj ponownie' }));

    expect(await taken('Demoxal', '08:00')).toBeVisible();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('shows a failure to load medications as an error too', async () => {
    const services = createTestServices(
      createFakeStorage({ [STORAGE_KEYS.medications]: '{broken' }),
    );
    renderApp(services);

    expect(await screen.findByRole('alert')).toHaveTextContent('Nie udało się wczytać dawek');
  });
});

describe('day view: choosing the day', () => {
  it('starts on today, written out in Polish', async () => {
    const services = createTestServices();
    await seed(services, { id: 'm-1' });
    renderApp(services);

    expect(
      await screen.findByRole('heading', {
        level: 2,
        name: 'Dziś: czwartek, 15 października 2026',
      }),
    ).toBeVisible();
  });

  it('decides what today is from the clock and the time zone, not from UTC', async () => {
    // 22:30 UTC on the 15th is already Friday the 16th in Warsaw.
    let counter = 0;
    const services = createLocalServices({
      storage: createFakeStorage(),
      clock: createFixedClock('2026-10-15T22:30:00Z'),
      timeZone: 'Europe/Warsaw',
      createId: () => `id-${String((counter += 1))}`,
    });
    await seed(services, { id: 'm-1' });
    renderApp(services);

    expect(
      await screen.findByRole('heading', { level: 2, name: 'Dziś: piątek, 16 października 2026' }),
    ).toBeVisible();
  });

  it('moves to the previous and next day, and back to today', async () => {
    const user = userEvent.setup();
    const services = createTestServices();
    await seed(services, { id: 'm-1' });
    const { router } = renderApp(services);
    await taken('Lek A', '08:00');

    await user.click(screen.getByRole('button', { name: /Poprzedni dzień/ }));
    expect(
      await screen.findByRole('heading', {
        level: 2,
        name: 'Wczoraj: środa, 14 października 2026',
      }),
    ).toBeVisible();
    expect(router.state.location.search).toBe('?date=2026-10-14');

    await user.click(screen.getByRole('button', { name: /Następny dzień/ }));
    await user.click(screen.getByRole('button', { name: /Następny dzień/ }));
    expect(
      await screen.findByRole('heading', { level: 2, name: 'Jutro: piątek, 16 października 2026' }),
    ).toBeVisible();

    await user.click(screen.getByRole('button', { name: 'Dziś' }));
    expect(
      await screen.findByRole('heading', {
        level: 2,
        name: 'Dziś: czwartek, 15 października 2026',
      }),
    ).toBeVisible();
    expect(router.state.location.search).toBe('');
  });

  it('opens a chosen day from the date field and keeps it in the address', async () => {
    const services = createTestServices();
    await seed(services, { id: 'm-1' });
    const { router } = renderApp(services);
    await taken('Lek A', '08:00');

    fireEvent.change(screen.getByLabelText('Przejdź do dnia'), { target: { value: '2026-09-20' } });

    expect(
      await screen.findByRole('heading', { level: 2, name: 'niedziela, 20 września 2026' }),
    ).toBeVisible();
    expect(router.state.location.search).toBe('?date=2026-09-20');
  });

  it('ignores an emptied date field and keeps the current day', async () => {
    const services = createTestServices();
    await seed(services, { id: 'm-1' });
    renderApp(services);
    await taken('Lek A', '08:00');

    fireEvent.change(screen.getByLabelText('Przejdź do dnia'), { target: { value: '' } });

    expect(screen.getByRole('heading', { level: 2, name: /15 października 2026/ })).toBeVisible();
  });

  it('opens the day named in the address, and falls back to today for an invalid one', async () => {
    const services = createTestServices();
    await seed(services, { id: 'm-1' });
    renderApp(services, '/doses?date=2026-10-01');
    expect(
      await screen.findByRole('heading', { level: 2, name: 'czwartek, 1 października 2026' }),
    ).toBeVisible();
    cleanup();

    renderApp(services, '/doses?date=2026-02-30');
    expect(
      await screen.findByRole('heading', {
        level: 2,
        name: /Dziś: czwartek, 15 października 2026/,
      }),
    ).toBeVisible();
    expect(screen.getByText(/Data w adresie strony jest nieprawidłowa/)).toBeVisible();
  });

  it('does not offer to record doses of a future day, and says why', async () => {
    const services = createTestServices();
    await seed(services, { id: 'm-1', name: 'Demoxal' });
    renderApp(services, '/doses?date=2026-10-16');

    expect(await screen.findByText(/To dzień w przyszłości/)).toBeVisible();
    expect(screen.queryByRole('button', { name: /Oznacz jako/ })).not.toBeInTheDocument();
    expect(await statusOf('Demoxal', '08:00')).toHaveTextContent('Zaplanowana');
    expect(await allLogs(services)).toEqual([]);
  });

  it('lets a past day be recorded', async () => {
    const user = userEvent.setup();
    const services = createTestServices();
    await seed(services, { id: 'm-1', name: 'Demoxal' });
    renderApp(services, '/doses?date=2026-10-10');

    await user.click(await taken('Demoxal', '08:00'));

    await waitFor(async () => {
      expect(await allLogs(services)).toEqual([
        expect.objectContaining({ scheduledDate: '2026-10-10', scheduledTime: '08:00' }),
      ]);
    });
  });
});

describe('day view: which doses are planned', () => {
  it('lists several medications and several doses, ordered by time and then by name', async () => {
    const services = createTestServices();
    await seed(
      services,
      {
        id: 'm-b',
        name: 'Żyrafa',
        scheduleTimes: [scheduleTime('b1', '08:00'), scheduleTime('b2', '20:00', 2)],
      },
      {
        id: 'm-a',
        name: 'Ąbc',
        scheduleTimes: [scheduleTime('a1', '08:00'), scheduleTime('a2', '14:30')],
      },
    );
    renderApp(services);

    await screen.findByRole('heading', { name: 'Zaplanowane dawki (4)' });
    const rows = screen.getAllByRole('listitem').filter((item) => item.querySelector('time'));
    expect(
      rows.map((row) => [
        row.querySelector('time')?.textContent,
        row.querySelector('p.font-medium')?.textContent,
      ]),
    ).toEqual([
      ['08:00', 'Ąbc'],
      ['08:00', 'Żyrafa'],
      ['14:30', 'Ąbc'],
      ['20:00', 'Żyrafa'],
    ]);
    // Two medications at the very same time each get their own, separately labelled actions.
    expect(await taken('Ąbc', '08:00')).toBeVisible();
    expect(await taken('Żyrafa', '08:00')).toBeVisible();
  });

  it('shows the amount with the unit in correct Polish', async () => {
    const services = createTestServices();
    await seed(services, {
      id: 'm-1',
      scheduleTimes: [scheduleTime('t1', '08:00', 1), scheduleTime('t2', '20:00', 2)],
    });
    renderApp(services);

    await taken('Lek A', '08:00');
    expect(screen.getByText('1 tabletka')).toBeVisible();
    expect(screen.getByText('2 tabletki')).toBeVisible();
  });

  it('plans doses only from the day the schedule took effect, and keeps older records visible', async () => {
    const services = createTestServices();
    await seed(services, {
      id: 'm-1',
      name: 'Demoxal',
      startDate: asLocalDate('2026-09-01'),
      scheduleEffectiveFrom: asLocalDate('2026-10-10'),
    });
    await services.repositories.doseLogs.upsert(
      log({
        id: 'old',
        scheduledDate: asLocalDate('2026-10-05'),
        scheduledTime: asLocalTime('09:00'),
      }),
    );

    // The day the schedule took effect: planned.
    renderApp(services, '/doses?date=2026-10-10');
    expect(await taken('Demoxal', '08:00')).toBeVisible();
    cleanup();

    // Before it: nothing is planned, and the older record is shown, outside the schedule.
    renderApp(services, '/doses?date=2026-10-05');
    expect(
      await screen.findByRole('heading', { name: 'Brak zaplanowanych dawek tego dnia' }),
    ).toBeVisible();
    const outside = await screen.findByRole('region', {
      name: 'Wpisy poza aktualnym harmonogramem (1)',
    });
    expect(within(outside).getByText('Demoxal')).toBeVisible();
    expect(within(outside).getByText('Poza aktualnym harmonogramem')).toBeVisible();
    expect(within(outside).getByText(/Obecny obowiązuje od 10 października 2026/)).toBeVisible();
  });

  it('does not plan doses after the end date', async () => {
    const services = createTestServices();
    await seed(services, { id: 'm-1', endDate: asLocalDate('2026-10-14') });
    renderApp(services);

    expect(
      await screen.findByRole('heading', { name: 'Brak zaplanowanych dawek tego dnia' }),
    ).toBeVisible();
  });
});

describe('day view: recording, correcting and clearing', () => {
  it('starts every dose as "Nie zapisano", never as skipped or missed', async () => {
    const services = createTestServices();
    await seed(services, { id: 'm-1', name: 'Demoxal' });
    renderApp(services);

    expect(await statusOf('Demoxal', '08:00')).toHaveTextContent('Nie zapisano');
    expect(screen.queryByText('Pominięta')).not.toBeInTheDocument();
    expect(screen.getByText('Przyjęte: 0. Pominięte: 0. Bez zapisu: 1.')).toBeVisible();
    expect(await allLogs(services)).toEqual([]);
  });

  it('marks a dose as taken: one record with the dose as it is now, then says so', async () => {
    const user = userEvent.setup();
    const services = createTestServices();
    await seed(services, { id: 'm-1', name: 'Demoxal' });
    renderApp(services);

    await user.click(await taken('Demoxal', '08:00'));

    expect(await screen.findByText('Zapisano jako przyjętą: Demoxal, 08:00.')).toBeVisible();
    expect(await statusOf('Demoxal', '08:00')).toHaveTextContent('Przyjęta');
    expect(screen.getByText('Przyjęte: 1. Pominięte: 0. Bez zapisu: 0.')).toBeVisible();
    expect(await allLogs(services)).toEqual([
      expect.objectContaining({
        medicationId: 'm-1',
        scheduledDate: '2026-10-15',
        scheduledTime: '08:00',
        status: 'taken',
        doseAmount: 1,
        doseUnit: 'tabletka',
      }),
    ]);
  });

  it('marks a dose as skipped, with its own word and not as taken', async () => {
    const user = userEvent.setup();
    const services = createTestServices();
    await seed(services, { id: 'm-1', name: 'Demoxal' });
    renderApp(services);

    await user.click(await skipped('Demoxal', '08:00'));

    expect(await screen.findByText('Zapisano jako pominiętą: Demoxal, 08:00.')).toBeVisible();
    expect(await statusOf('Demoxal', '08:00')).toHaveTextContent('Pominięta');
    expect((await allLogs(services)).map((entry) => entry.status)).toEqual(['skipped']);
  });

  it('changes a status by updating the same record, and clearing returns to "Nie zapisano"', async () => {
    const user = userEvent.setup();
    const services = createTestServices();
    await seed(services, { id: 'm-1', name: 'Demoxal' });
    renderApp(services);
    await user.click(await taken('Demoxal', '08:00'));
    const [first] = await allLogs(services);

    await user.click(
      await screen.findByRole('button', { name: 'Zmień na pominiętą: Demoxal, 08:00' }),
    );
    expect(
      await screen.findByText(/Zmieniono zapis: Demoxal, 08:00 — teraz pominięta/),
    ).toBeVisible();
    const afterChange = await allLogs(services);
    expect(afterChange).toHaveLength(1);
    expect(afterChange[0]).toMatchObject({ id: first?.id, status: 'skipped' });

    await user.click(await screen.findByRole('button', { name: 'Cofnij zapis: Demoxal, 08:00' }));
    expect(await screen.findByText(/Cofnięto zapis: Demoxal, 08:00/)).toBeVisible();
    expect(await statusOf('Demoxal', '08:00')).toHaveTextContent('Nie zapisano');
    expect(await allLogs(services)).toEqual([]);
    // After clearing, the dose can be recorded again, creating exactly one record.
    await user.click(await taken('Demoxal', '08:00'));
    await waitFor(async () => {
      expect(await allLogs(services)).toHaveLength(1);
    });
  });

  it('touches only the chosen slot: other doses, medications and days keep their records', async () => {
    const user = userEvent.setup();
    const services = createTestServices();
    await seed(
      services,
      {
        id: 'm-1',
        name: 'Lek A',
        scheduleTimes: [scheduleTime('a1', '08:00'), scheduleTime('a2', '20:00')],
      },
      { id: 'm-2', name: 'Lek B', scheduleTimes: [scheduleTime('b1', '08:00')] },
    );
    await services.repositories.doseLogs.upsert(
      log({ id: 'yesterday', medicationId: 'm-1', scheduledDate: asLocalDate('2026-10-14') }),
    );
    await services.repositories.doseLogs.upsert(
      log({ id: 'other-med', medicationId: 'm-2', scheduledTime: asLocalTime('08:00') }),
    );
    renderApp(services);

    await user.click(await taken('Lek A', '20:00'));
    await screen.findByText('Zapisano jako przyjętą: Lek A, 20:00.');

    const logs = await allLogs(services);
    expect(logs).toHaveLength(3);
    expect(logs.map((entry) => entry.id)).toEqual(
      expect.arrayContaining(['other-med', 'yesterday']),
    );
    expect(logs.find((entry) => entry.id === 'yesterday')).toMatchObject({ status: 'taken' });
    expect(await statusOf('Lek A', '08:00')).toHaveTextContent('Nie zapisano');
    expect(await statusOf('Lek B', '08:00')).toHaveTextContent('Przyjęta');
  });

  it('can be operated with the keyboard alone', async () => {
    const user = userEvent.setup();
    const services = createTestServices();
    await seed(services, { id: 'm-1', name: 'Demoxal' });
    renderApp(services);
    const button = await taken('Demoxal', '08:00');

    button.focus();
    await user.keyboard('{Enter}');

    expect(await screen.findByText('Zapisano jako przyjętą: Demoxal, 08:00.')).toBeVisible();
    // Space works on the next button too.
    (await screen.findByRole('button', { name: 'Cofnij zapis: Demoxal, 08:00' })).focus();
    await user.keyboard(' ');
    expect(await screen.findByText(/Cofnięto zapis/)).toBeVisible();
  });

  it('moves focus to the dose that was changed, so keyboard and screen-reader users keep their place', async () => {
    const user = userEvent.setup();
    const services = createTestServices();
    await seed(services, { id: 'm-1', name: 'Demoxal' });
    renderApp(services);

    await user.click(await taken('Demoxal', '08:00'));
    await screen.findByText('Zapisano jako przyjętą: Demoxal, 08:00.');

    const status = await statusOf('Demoxal', '08:00');
    await waitFor(() => {
      expect(status).toHaveFocus();
    });
    expect(status).toHaveTextContent('Demoxal, 08:00: Przyjęta');
  });

  it('announces the outcome in a polite live region', async () => {
    const user = userEvent.setup();
    const services = createTestServices();
    await seed(services, { id: 'm-1', name: 'Demoxal' });
    renderApp(services);
    await user.click(await taken('Demoxal', '08:00'));

    const message = await screen.findByText('Zapisano jako przyjętą: Demoxal, 08:00.');

    expect(message.closest('[role="status"]')).toHaveAttribute('aria-live', 'polite');
  });

  it('keeps the date selector and the list on screen while saving (no loading flicker)', async () => {
    const user = userEvent.setup();
    const services = createTestServices();
    await seed(services, { id: 'm-1', name: 'Demoxal' });
    const deferred = createDeferred<DoseLog[]>();
    renderApp(services);
    await user.click(await taken('Demoxal', '08:00'));
    await screen.findByText('Zapisano jako przyjętą: Demoxal, 08:00.');

    // Make the refresh after the next write slow, and write again.
    const real = services.repositories.doseLogs.listByDateRange.bind(
      services.repositories.doseLogs,
    );
    let calls = 0;
    vi.spyOn(services.repositories.doseLogs, 'listByDateRange').mockImplementation((from, to) => {
      calls += 1;
      // 1st call: the write reads the day; 2nd call: the refresh of the whole list.
      return calls === 2 ? deferred.promise : real(from, to);
    });
    await user.click(await screen.findByRole('button', { name: 'Cofnij zapis: Demoxal, 08:00' }));

    await screen.findByText(/Cofnięto zapis/);
    expect(screen.queryByText('Wczytywanie dawek…')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Zaplanowane dawki (1)' })).toBeVisible();
    await act(async () => {
      deferred.resolve(await real(asLocalDate('2000-01-01'), asLocalDate('2999-12-31')));
    });
  });
});

describe('day view: repeated clicks and pending writes', () => {
  it('a double click records the dose once', async () => {
    const user = userEvent.setup();
    const services = createTestServices();
    await seed(services, { id: 'm-1', name: 'Demoxal' });
    renderApp(services);

    await user.dblClick(await taken('Demoxal', '08:00'));

    await screen.findByText('Zapisano jako przyjętą: Demoxal, 08:00.');
    expect(await allLogs(services)).toHaveLength(1);
  });

  it('ignores clicks while a write is pending, disables the buttons, and reports success only afterwards', async () => {
    const user = userEvent.setup();
    const services = createTestServices();
    await seed(services, {
      id: 'm-1',
      name: 'Demoxal',
      scheduleTimes: [scheduleTime('t1', '08:00'), scheduleTime('t2', '20:00')],
    });
    const gate = createDeferred<undefined>();
    const upsert = services.repositories.doseLogs.upsert.bind(services.repositories.doseLogs);
    const spy = vi
      .spyOn(services.repositories.doseLogs, 'upsert')
      .mockImplementation(async (entry) => {
        await gate.promise;
        return upsert(entry);
      });
    renderApp(services);

    const first = await taken('Demoxal', '08:00');
    await user.click(first);
    // While the write waits: every action button of the day is disabled and shows no success yet.
    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: 'Oznacz jako przyjętą: Demoxal, 20:00' }),
      ).toBeDisabled();
    });
    expect(first).toBeDisabled();
    expect(screen.queryByText(/Zapisano jako/)).not.toBeInTheDocument();
    // Clicks on disabled buttons, and a forced one, start nothing.
    fireEvent.click(first);
    fireEvent.click(screen.getByRole('button', { name: 'Oznacz jako pominiętą: Demoxal, 20:00' }));

    gate.resolve(undefined);
    expect(await screen.findByText('Zapisano jako przyjętą: Demoxal, 08:00.')).toBeVisible();
    expect(spy).toHaveBeenCalledTimes(1);
    expect(await allLogs(services)).toHaveLength(1);
    // The buttons work again afterwards.
    expect(await taken('Demoxal', '20:00')).toBeEnabled();
  });

  it('a second click that arrives before the screen re-renders is ignored and does not switch the progress indicator off', async () => {
    const services = createTestServices();
    await seed(services, { id: 'm-1', name: 'Demoxal' });
    const gate = createDeferred<undefined>();
    const upsert = services.repositories.doseLogs.upsert.bind(services.repositories.doseLogs);
    const spy = vi
      .spyOn(services.repositories.doseLogs, 'upsert')
      .mockImplementation(async (entry) => {
        await gate.promise;
        return upsert(entry);
      });
    renderApp(services);
    const first = await taken('Demoxal', '08:00');

    // Both clicks reach the handler in the same tick, before React could disable the button.
    act(() => {
      first.click();
      first.click();
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    expect(first).toHaveAttribute('aria-busy', 'true');
    expect(first).toBeDisabled();
    gate.resolve(undefined);
    expect(await screen.findByText('Zapisano jako przyjętą: Demoxal, 08:00.')).toBeVisible();
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('is not disturbed when the day is changed while a write is pending', async () => {
    const user = userEvent.setup();
    const services = createTestServices();
    await seed(services, { id: 'm-1', name: 'Demoxal' });
    const gate = createDeferred<undefined>();
    const upsert = services.repositories.doseLogs.upsert.bind(services.repositories.doseLogs);
    vi.spyOn(services.repositories.doseLogs, 'upsert').mockImplementation(async (entry) => {
      await gate.promise;
      return upsert(entry);
    });
    renderApp(services);

    await user.click(await taken('Demoxal', '08:00'));
    await user.click(screen.getByRole('button', { name: /Poprzedni dzień/ }));
    await screen.findByRole('heading', { level: 2, name: /Wczoraj/ });
    gate.resolve(undefined);

    // The write belongs to the 15th: the 14th stays unrecorded, the 15th has its record.
    expect(await statusOf('Demoxal', '08:00')).toHaveTextContent('Nie zapisano');
    await user.click(screen.getByRole('button', { name: 'Dziś' }));
    expect(await statusOf('Demoxal', '08:00')).toHaveTextContent('Przyjęta');
    expect(await allLogs(services)).toEqual([
      expect.objectContaining({ scheduledDate: '2026-10-15' }),
    ]);
  });
});

describe('day view: failures and conflicts', () => {
  it('shows a failed write as an error, never as success, and changes nothing', async () => {
    const user = userEvent.setup();
    const services = createTestServices();
    await seed(services, { id: 'm-1', name: 'Demoxal' });
    renderApp(services);
    const button = await taken('Demoxal', '08:00');
    services.storage.failWrites();

    await user.click(button);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Nie zapisano zmiany');
    expect(alert).toHaveTextContent('Zmiany nie zostały zapisane');
    expect(screen.queryByText(/Zapisano jako/)).not.toBeInTheDocument();
    expect(await statusOf('Demoxal', '08:00')).toHaveTextContent('Nie zapisano');
    services.storage.heal();
    expect(await allLogs(services)).toEqual([]);

    // The user can simply try again, and then it works.
    await user.click(await taken('Demoxal', '08:00'));
    expect(await screen.findByText('Zapisano jako przyjętą: Demoxal, 08:00.')).toBeVisible();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('a failed clear keeps the record and the status on screen', async () => {
    const user = userEvent.setup();
    const services = createTestServices();
    await seed(services, { id: 'm-1', name: 'Demoxal' });
    await services.repositories.doseLogs.upsert(
      log({ id: 'l-1', scheduledTime: asLocalTime('08:00') }),
    );
    renderApp(services);
    const clear = await screen.findByRole('button', { name: 'Cofnij zapis: Demoxal, 08:00' });
    services.storage.failWrites();

    await user.click(clear);

    expect(await screen.findByRole('alert')).toHaveTextContent('Nie zapisano zmiany');
    expect(await statusOf('Demoxal', '08:00')).toHaveTextContent('Przyjęta');
    services.storage.heal();
    expect(await allLogs(services)).toHaveLength(1);
  });

  it('does not overwrite a record another tab made, and refreshes to show it', async () => {
    const user = userEvent.setup();
    const services = createTestServices();
    await seed(services, { id: 'm-1', name: 'Demoxal' });
    renderApp(services);
    const button = await taken('Demoxal', '08:00');
    // Meanwhile, "skipped" was recorded elsewhere.
    await services.repositories.doseLogs.upsert(
      log({ id: 'elsewhere', scheduledTime: asLocalTime('08:00'), status: 'skipped' }),
    );

    await user.click(button);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Ta dawka ma już zapis z innym statusem');
    expect(await statusOf('Demoxal', '08:00')).toHaveTextContent('Pominięta');
    expect(await allLogs(services)).toEqual([
      expect.objectContaining({ id: 'elsewhere', status: 'skipped' }),
    ]);
  });

  it('clearing a record that is already gone succeeds without error and refreshes the day', async () => {
    const user = userEvent.setup();
    const services = createTestServices();
    await seed(services, { id: 'm-1', name: 'Demoxal' });
    await services.repositories.doseLogs.upsert(
      log({ id: 'l-1', scheduledTime: asLocalTime('08:00') }),
    );
    renderApp(services);
    const clear = await screen.findByRole('button', { name: 'Cofnij zapis: Demoxal, 08:00' });
    await services.repositories.doseLogs.remove({
      medicationId: 'm-1',
      date: asLocalDate('2026-10-15'),
      time: asLocalTime('08:00'),
    });

    await user.click(clear);

    expect(await screen.findByText(/Ta dawka nie miała zapisu: Demoxal, 08:00/)).toBeVisible();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(await statusOf('Demoxal', '08:00')).toHaveTextContent('Nie zapisano');
    expect(await allLogs(services)).toEqual([]);
  });

  it('does not bring back a record that was cleared elsewhere when changing its status', async () => {
    const user = userEvent.setup();
    const services = createTestServices();
    await seed(services, { id: 'm-1', name: 'Demoxal' });
    await services.repositories.doseLogs.upsert(
      log({ id: 'l-1', scheduledTime: asLocalTime('08:00') }),
    );
    renderApp(services);
    const change = await screen.findByRole('button', {
      name: 'Zmień na pominiętą: Demoxal, 08:00',
    });
    await services.repositories.doseLogs.remove({
      medicationId: 'm-1',
      date: asLocalDate('2026-10-15'),
      time: asLocalTime('08:00'),
    });

    await user.click(change);

    expect(await screen.findByRole('alert')).toHaveTextContent('Zapis tej dawki już nie istnieje');
    expect(await allLogs(services)).toEqual([]);
    expect(await statusOf('Demoxal', '08:00')).toHaveTextContent('Nie zapisano');
  });
});

describe('day view: history stays as it was recorded', () => {
  it('shows the recorded amount and unit even though the medication was edited, and keeps them when the status changes', async () => {
    const user = userEvent.setup();
    const services = createTestServices();
    await seed(services, {
      id: 'm-1',
      name: 'Nowa nazwa',
      doseUnit: 'kapsułka',
      scheduleTimes: [scheduleTime('t1', '08:00', 2)],
    });
    await services.repositories.doseLogs.upsert(
      log({
        id: 'old',
        scheduledTime: asLocalTime('08:00'),
        doseAmount: 1,
        doseUnit: 'tabletka',
      }),
    );
    renderApp(services);

    expect(
      await screen.findByText(/Zapisana dawka: 1 tabletka \(obecnie w harmonogramie: 2 kapsułki\)/),
    ).toBeVisible();
    await user.click(
      await screen.findByRole('button', { name: 'Zmień na pominiętą: Nowa nazwa, 08:00' }),
    );
    await screen.findByText(/Zmieniono zapis/);

    expect(await allLogs(services)).toEqual([
      expect.objectContaining({
        id: 'old',
        status: 'skipped',
        doseAmount: 1,
        doseUnit: 'tabletka',
      }),
    ]);
  });

  it('shows a record whose time is no longer in the schedule outside it, without actions', async () => {
    const services = createTestServices();
    await seed(services, {
      id: 'm-1',
      name: 'Demoxal',
      scheduleTimes: [scheduleTime('t1', '08:00')],
    });
    await services.repositories.doseLogs.upsert(
      log({
        id: 'gone-time',
        scheduledTime: asLocalTime('21:00'),
        status: 'skipped',
        doseAmount: 3,
      }),
    );
    renderApp(services);

    const outside = await screen.findByRole('region', {
      name: 'Wpisy poza aktualnym harmonogramem (1)',
    });
    expect(within(outside).getByText('21:00')).toBeVisible();
    expect(within(outside).getByText('Pominięta')).toBeVisible();
    expect(within(outside).getByText('Zapisana dawka: 3 tabletki')).toBeVisible();
    expect(
      within(outside).getByText('Obecny harmonogram nie ma dawki o tej godzinie.'),
    ).toBeVisible();
    expect(within(outside).queryByRole('button')).not.toBeInTheDocument();
    // The planned 08:00 dose is still offered as usual, and that record is not counted as planned.
    expect(await taken('Demoxal', '08:00')).toBeVisible();
    expect(screen.getByText('Przyjęte: 0. Pominięte: 0. Bez zapisu: 1.')).toBeVisible();
  });

  it('points to the history for correcting a record outside the schedule, and does not offer to delete it here', async () => {
    const user = userEvent.setup();
    const services = createTestServices();
    await seed(services, {
      id: 'm-1',
      name: 'Demoxal',
      scheduleTimes: [scheduleTime('t1', '08:00')],
    });
    await services.repositories.doseLogs.upsert(
      log({ id: 'gone-time', scheduledTime: asLocalTime('21:00') }),
    );
    const { router } = renderApp(services);

    const outside = await screen.findByRole('region', {
      name: 'Wpisy poza aktualnym harmonogramem (1)',
    });
    expect(within(outside).queryByRole('button')).not.toBeInTheDocument();
    expect(
      within(outside).getByText(/Błędny zapis możesz usunąć w historii przyjmowania/),
    ).toBeVisible();
    await user.click(within(outside).getByRole('link', { name: 'Zobacz te zapisy w historii' }));

    expect(router.state.location.pathname).toBe('/doses/history');
    expect(router.state.location.search).toBe('?from=2026-10-15&to=2026-10-15');
    expect(
      await screen.findByRole('button', {
        name: /^Usuń zapis…: Demoxal, 15 października 2026, 21:00/,
      }),
    ).toBeVisible();
  });

  it('shows records of a deleted medication outside the schedule', async () => {
    const services = createTestServices();
    await seed(services, { id: 'm-1', name: 'Demoxal' });
    // Leftover record of a medication that no longer exists (the repository tolerates these).
    services.storage.data.set(
      STORAGE_KEYS.doseLogs,
      JSON.stringify({
        version: 1,
        items: [log({ id: 'orphan', medicationId: 'm-gone', scheduledTime: asLocalTime('09:00') })],
      }),
    );
    renderApp(services);

    const outside = await screen.findByRole('region', {
      name: 'Wpisy poza aktualnym harmonogramem (1)',
    });
    expect(within(outside).getByText('Usunięty lek')).toBeVisible();
    expect(
      within(outside).getByText('Ten lek został usunięty, a jego zapis pozostał.'),
    ).toBeVisible();
  });
});

describe('day view: stock', () => {
  const stockCountedAt = asTimestamp('2026-10-01T08:00:00Z');
  const withStock = (overrides = {}) => ({
    id: 'm-1',
    name: 'Demoxal',
    stock: { quantity: 10, unit: 'tabletka', asOf: stockCountedAt },
    ...overrides,
  });
  /** The stock list item of one medication. */
  const stockLine = (name: string): HTMLElement => {
    const item = within(screen.getByRole('region', { name: 'Szacunkowy zapas (stan na dziś)' }))
      .getByText(name)
      .closest('li');
    if (item === null) throw new Error(`No stock item for ${name}`);
    return item;
  };

  it('estimates from recorded taken doses: taken reduces it, skipped and unrecorded do not, clearing restores it', async () => {
    const user = userEvent.setup();
    const services = createTestServices();
    await seed(
      services,
      withStock({ scheduleTimes: [scheduleTime('t1', '08:00'), scheduleTime('t2', '20:00')] }),
    );
    renderApp(services);
    await taken('Demoxal', '08:00');
    await screen.findByRole('region', { name: 'Szacunkowy zapas (stan na dziś)' });
    expect(stockLine('Demoxal')).toHaveTextContent(
      'Pozostało ok. 10 tabletek, wystarczy na ok. 5 dni.',
    );

    await user.click(await taken('Demoxal', '08:00'));
    await screen.findByText('Zapisano jako przyjętą: Demoxal, 08:00.');
    await waitFor(() => {
      expect(stockLine('Demoxal')).toHaveTextContent('Pozostało ok. 9 tabletek');
    });

    await user.click(await skipped('Demoxal', '20:00'));
    await screen.findByText('Zapisano jako pominiętą: Demoxal, 20:00.');
    expect(stockLine('Demoxal')).toHaveTextContent('Pozostało ok. 9 tabletek');

    await user.click(await screen.findByRole('button', { name: 'Cofnij zapis: Demoxal, 08:00' }));
    await screen.findByText(/Cofnięto zapis/);
    await waitFor(() => {
      expect(stockLine('Demoxal')).toHaveTextContent('Pozostało ok. 10 tabletek');
    });
  });

  it('says the stock was not configured, and never shows a number or zero', async () => {
    const services = createTestServices();
    await seed(services, { id: 'm-1', name: 'Demoxal', stock: null });
    renderApp(services);

    await screen.findByRole('region', { name: 'Szacunkowy zapas (stan na dziś)' });
    expect(stockLine('Demoxal')).toHaveTextContent(
      'Szacunek niedostępny: zapas nie został skonfigurowany.',
    );
    expect(stockLine('Demoxal')).not.toHaveTextContent(/\d/);
  });

  it('explains why the estimate is unavailable when the units differ', async () => {
    const services = createTestServices();
    await seed(services, withStock({ stock: { quantity: 10, unit: 'mg', asOf: stockCountedAt } }));
    renderApp(services);

    await screen.findByRole('region', { name: 'Szacunkowy zapas (stan na dziś)' });
    expect(stockLine('Demoxal')).toHaveTextContent(
      'Szacunek niedostępny: jednostka zapasu różni się od jednostki dawki.',
    );
  });

  it('shows used-up stock as zero, which is different from an unavailable estimate', async () => {
    const services = createTestServices();
    await seed(
      services,
      withStock({ stock: { quantity: 1, unit: 'tabletka', asOf: stockCountedAt } }),
    );
    await services.repositories.doseLogs.upsert(
      log({
        id: 'used',
        scheduledDate: asLocalDate('2026-10-10'),
        recordedAt: asTimestamp('2026-10-10T08:00:00Z'),
      }),
    );
    renderApp(services);

    await screen.findByRole('region', { name: 'Szacunkowy zapas (stan na dziś)' });
    expect(stockLine('Demoxal')).toHaveTextContent('Zapas wyczerpany (0 tabletek).');
    expect(stockLine('Demoxal')).not.toHaveTextContent('Szacunek niedostępny');
  });

  it('explains that the figure is an estimate and how it is made', async () => {
    const user = userEvent.setup();
    const services = createTestServices();
    await seed(services, withStock());
    renderApp(services);
    await screen.findByRole('region', { name: 'Szacunkowy zapas (stan na dziś)' });

    await user.click(screen.getByText('Jak liczymy szacunkowy zapas?'));

    expect(screen.getByText(/To szacunek, a nie dokładny stan/)).toBeVisible();
    expect(screen.getByText('Dawki pominięte nie zmniejszają zapasu.')).toBeVisible();
    expect(
      screen.getByText('Dawki zaplanowane, ale niezapisane, też go nie zmniejszają.'),
    ).toBeVisible();
  });
});

describe('day view: persistence', () => {
  it('keeps the records after the page is opened again', async () => {
    const user = userEvent.setup();
    const services = createTestServices();
    await seed(services, { id: 'm-1', name: 'Demoxal' });
    renderApp(services);
    await user.click(await taken('Demoxal', '08:00'));
    await screen.findByText('Zapisano jako przyjętą: Demoxal, 08:00.');
    cleanup();

    renderApp(services);

    expect(await statusOf('Demoxal', '08:00')).toHaveTextContent('Przyjęta');
    expect(screen.queryByText(/Zapisano jako/)).not.toBeInTheDocument();
  });
});

describe('navigation', () => {
  it('links between the day view and the history', async () => {
    const user = userEvent.setup();
    const { router } = renderApp();

    await user.click(await screen.findByRole('link', { name: 'Historia przyjmowania' }));
    expect(router.state.location.pathname).toBe('/doses/history');
    await user.click(await screen.findByRole('link', { name: 'Widok dnia' }));
    expect(router.state.location.pathname).toBe('/doses');
  });

  it('is part of the main navigation and titles the tab', async () => {
    renderApp();
    await screen.findByRole('heading', { level: 1, name: 'Dawki' });

    const link = within(screen.getByRole('navigation', { name: 'Główna nawigacja' })).getByRole(
      'link',
      {
        name: 'Dawki',
      },
    );
    expect(link).toHaveAttribute('aria-current', 'page');
    expect(document.title).toBe('Dawki – Pigoowa');
  });
});
