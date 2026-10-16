import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { ServicesProvider } from '@/app/ServicesProvider';
import { routes } from '@/app/routes';
import type { Appointment } from '@/features/appointments/types';
import { STORAGE_KEYS } from '@/services/local/collections';
import { createLocalServices } from '@/services/local/createLocalServices';
import type { AppServices } from '@/services/repositories';
import { createFakeStorage } from '@/test/fakeStorage';
import { makeAppointment } from '@/test/fixtures';
import { createDeferred, createTestServices } from '@/test/services';
import { createFixedClock } from '@/utils/clock';
import { asTimestamp } from '@/utils/date';

// The test clock says 12:00 on Thursday 15 October 2026 in Warsaw (summer time, UTC+2), which is
// 2026-10-15T10:00:00Z. Times below are UTC; the screen shows them in Warsaw time.

function renderApp(services: AppServices = createTestServices(), entry = '/appointments') {
  const router = createMemoryRouter(routes, { initialEntries: [entry] });
  render(
    <ServicesProvider services={services}>
      <RouterProvider router={router} />
    </ServicesProvider>,
  );
  return { router, services };
}

async function seed(services: AppServices, ...overrides: Partial<Appointment>[]) {
  for (const override of overrides) {
    await services.repositories.appointments.create(makeAppointment(override));
  }
}

const at = (instant: string) => asTimestamp(instant);
const stored = (services: AppServices, id: string) => services.repositories.appointments.get(id);

/** Five appointments that between them cover every state. */
async function seedAll(services: AppServices) {
  await seed(
    services,
    {
      id: 'up-1',
      doctorName: 'dr Nowak',
      specialty: 'Kardiolog',
      scheduledAt: at('2026-10-20T08:00:00Z'),
    },
    {
      id: 'up-2',
      doctorName: null,
      specialty: 'Okulista',
      scheduledAt: at('2026-10-20T12:30:00Z'),
    },
    { id: 'up-3', doctorName: 'dr Lis', specialty: null, scheduledAt: at('2026-10-22T07:00:00Z') },
    {
      id: 'need',
      doctorName: 'dr Zapomniany',
      specialty: null,
      scheduledAt: at('2026-10-14T09:00:00Z'),
    },
    {
      id: 'done',
      doctorName: 'dr Odbyty',
      specialty: null,
      status: 'completed',
      scheduledAt: at('2026-10-01T08:00:00Z'),
    },
    {
      id: 'off',
      doctorName: null,
      specialty: 'Dermatolog',
      status: 'cancelled',
      scheduledAt: at('2026-10-25T08:00:00Z'),
    },
  );
}

/** [date heading, time, title] of every appointment shown, top to bottom. */
function shown() {
  return screen
    .getAllByRole('listitem')
    .filter((item) => item.querySelector('time'))
    .map((item) => [
      item.closest('section')?.querySelector('h3')?.textContent,
      item.querySelector('time')?.textContent,
      item.querySelector('p.font-medium')?.textContent,
    ]);
}

const button = (name: string | RegExp) => screen.findByRole('button', { name });

describe('appointments: states', () => {
  it('shows loading, then the upcoming appointments', async () => {
    const services = createTestServices();
    await seedAll(services);

    renderApp(services);

    expect(screen.getByText('Wczytywanie wizyt…')).toBeVisible();
    expect(
      await screen.findByRole('heading', { level: 2, name: 'Nadchodzące wizyty' }),
    ).toBeVisible();
    expect(screen.queryByText('Wczytywanie wizyt…')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Wizyty' })).toBeVisible();
  });

  it('explains that there are no appointments yet, with a way to add one', async () => {
    const user = userEvent.setup();
    const { router } = renderApp();

    expect(
      await screen.findByRole('heading', { name: 'Nie dodano jeszcze żadnej wizyty' }),
    ).toBeVisible();
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
    await user.click(screen.getByRole('link', { name: 'Dodaj pierwszą wizytę' }));

    expect(router.state.location.pathname).toBe('/appointments/new');
  });

  it('always offers "Dodaj wizytę" in the page header', async () => {
    const services = createTestServices();
    await seedAll(services);
    renderApp(services);

    await screen.findByRole('tablist');

    expect(screen.getByRole('link', { name: 'Dodaj wizytę' })).toHaveAttribute(
      'href',
      '/appointments/new',
    );
  });

  it('shows a failure as an error with a retry that works, never as an empty list', async () => {
    const user = userEvent.setup();
    const services = createTestServices(
      createFakeStorage({ [STORAGE_KEYS.appointments]: '{broken' }),
    );
    renderApp(services);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Nie udało się wczytać wizyt');
    expect(alert).toHaveTextContent('Zapisane dane są uszkodzone');
    expect(screen.queryByText('Nie dodano jeszcze żadnej wizyty')).not.toBeInTheDocument();
    expect(services.storage.data.get(STORAGE_KEYS.appointments)).toBe('{broken');

    services.storage.data.set(STORAGE_KEYS.appointments, JSON.stringify({ version: 1, items: [] }));
    await user.click(screen.getByRole('button', { name: 'Spróbuj ponownie' }));

    expect(
      await screen.findByRole('heading', { name: 'Nie dodano jeszcze żadnej wizyty' }),
    ).toBeVisible();
  });

  it('says so when a tab has nothing to show, and keeps the other tab reachable', async () => {
    const services = createTestServices();
    await seed(services, {
      id: 'only-past',
      status: 'completed',
      scheduledAt: at('2026-10-01T08:00:00Z'),
    });
    renderApp(services);

    expect(await screen.findByRole('heading', { name: 'Brak nadchodzących wizyt' })).toBeVisible();
    // The page header and the empty state both offer to add one.
    expect(screen.getAllByRole('link', { name: 'Dodaj wizytę' })).toHaveLength(2);
    expect(screen.getByRole('tab', { name: 'Minione (1)' })).toBeVisible();
  });

  it('says so when there are no past appointments', async () => {
    const services = createTestServices();
    await seed(services, { id: 'up', scheduledAt: at('2026-10-20T08:00:00Z') });
    renderApp(services, '/appointments?tab=past');

    expect(await screen.findByRole('heading', { name: 'Brak minionych wizyt' })).toBeVisible();
  });
});

describe('appointments: tabs and grouping', () => {
  it('has Upcoming and Past tabs with counts in their names, Upcoming selected first', async () => {
    const services = createTestServices();
    await seedAll(services);
    renderApp(services);

    const tablist = await screen.findByRole('tablist', { name: 'Wizyty' });
    const tabs = within(tablist).getAllByRole('tab');
    expect(tabs.map((tab) => tab.textContent)).toEqual(['Nadchodzące (3)', 'Minione (3)']);
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true');
    expect(tabs[1]).toHaveAttribute('aria-selected', 'false');
    expect(screen.getByRole('tabpanel', { name: 'Nadchodzące (3)' })).toBeVisible();
  });

  it('switches by click and by keyboard, and keeps the choice in the address', async () => {
    const user = userEvent.setup();
    const services = createTestServices();
    await seedAll(services);
    const { router } = renderApp(services);

    await user.click(await screen.findByRole('tab', { name: 'Minione (3)' }));
    expect(screen.getByRole('tab', { name: 'Minione (3)' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(await screen.findByRole('heading', { name: 'Minione wizyty' })).toBeVisible();
    expect(router.state.location.search).toBe('?tab=past');

    screen.getByRole('tab', { name: 'Minione (3)' }).focus();
    await user.keyboard('{ArrowLeft}');
    expect(screen.getByRole('tab', { name: 'Nadchodzące (3)' })).toHaveFocus();
    expect(await screen.findByRole('heading', { name: 'Nadchodzące wizyty' })).toBeVisible();
    expect(router.state.location.search).toBe('');
  });

  it('opens the tab named in the address', async () => {
    const services = createTestServices();
    await seedAll(services);
    renderApp(services, '/appointments?tab=past');

    expect(await screen.findByRole('tab', { name: 'Minione (3)' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });

  it('groups upcoming appointments by day, soonest first', async () => {
    const services = createTestServices();
    await seedAll(services);
    renderApp(services);

    await screen.findByRole('heading', { name: 'Nadchodzące wizyty' });

    expect(shown()).toEqual([
      ['wtorek, 20 października 2026', '10:00', 'dr Nowak'],
      ['wtorek, 20 października 2026', '14:30', 'Okulista'],
      ['czwartek, 22 października 2026', '09:00', 'dr Lis'],
    ]);
    expect(screen.getAllByRole('heading', { level: 3 })).toHaveLength(2);
  });

  it('groups past appointments by day, most recent first, including cancelled-in-advance ones', async () => {
    const services = createTestServices();
    await seedAll(services);
    renderApp(services, '/appointments?tab=past');

    await screen.findByRole('heading', { name: 'Minione wizyty' });

    expect(shown()).toEqual([
      // 25 October 2026 is the day the clocks go back: 08:00Z is already winter time (UTC+1).
      ['niedziela, 25 października 2026', '09:00', 'Dermatolog'],
      ['środa, 14 października 2026', '11:00', 'dr Zapomniany'],
      ['czwartek, 1 października 2026', '10:00', 'dr Odbyty'],
    ]);
  });

  it('shows the time in the user’s zone and puts a visit just after local midnight on the new day', async () => {
    const services = createTestServices();
    // 22:00Z on the 20th is 00:00 on the 21st in Warsaw; 21:59Z is 23:59 on the 20th.
    await seed(
      services,
      { id: 'late', doctorName: 'Późna', specialty: null, scheduledAt: at('2026-10-20T21:59:00Z') },
      {
        id: 'midnight',
        doctorName: 'Północna',
        specialty: null,
        scheduledAt: at('2026-10-20T22:00:00Z'),
      },
    );
    renderApp(services);

    await screen.findByRole('heading', { name: 'Nadchodzące wizyty' });

    expect(shown()).toEqual([
      ['wtorek, 20 października 2026', '23:59', 'Późna'],
      ['środa, 21 października 2026', '00:00', 'Północna'],
    ]);
  });

  it('shows doctor, specialty, place and notes', async () => {
    const services = createTestServices();
    await seed(services, {
      id: 'a',
      doctorName: 'dr Nowak',
      specialty: 'Kardiolog',
      location: 'Gabinet 5',
      notes: 'Wyniki badań',
      scheduledAt: at('2026-10-20T08:00:00Z'),
    });
    renderApp(services);

    const card = (await screen.findByText('dr Nowak')).closest('li');
    if (card === null) throw new Error('no card');
    expect(within(card).getByText('Kardiolog')).toBeVisible();
    expect(within(card).getByText('Gabinet 5')).toBeVisible();
    expect(within(card).getByText('Wyniki badań')).toBeVisible();
  });
});

describe('appointments: classification (Stage 2 rules, injected clock)', () => {
  it('counts an appointment starting at exactly the current instant as upcoming', async () => {
    const services = createTestServices();
    await seed(services, {
      id: 'now',
      doctorName: 'Teraz',
      scheduledAt: at('2026-10-15T10:00:00Z'),
    });
    renderApp(services);

    expect(await screen.findByText('Teraz')).toBeVisible();
    expect(screen.getByRole('tab', { name: 'Nadchodzące (1)' })).toBeVisible();
    expect(screen.getByText('Zaplanowana')).toBeVisible();
  });

  it('puts an appointment one second earlier among the past, as "Do potwierdzenia"', async () => {
    const services = createTestServices();
    await seed(services, {
      id: 'earlier',
      doctorName: 'Chwilę temu',
      scheduledAt: at('2026-10-15T09:59:59Z'),
    });
    renderApp(services);

    expect(await screen.findByRole('heading', { name: 'Brak nadchodzących wizyt' })).toBeVisible();
    expect(screen.getByRole('tab', { name: 'Minione (1)' })).toBeVisible();
  });

  it('decides with the injected clock: the same data is upcoming at one time and past at another', async () => {
    const storage = createFakeStorage();
    const make = (instant: string) =>
      createLocalServices({
        storage,
        clock: createFixedClock(instant),
        timeZone: 'Europe/Warsaw',
        createId: () => 'id',
      });
    await seed(make('2026-10-15T10:00:00Z'), {
      id: 'a',
      doctorName: 'dr Nowak',
      scheduledAt: at('2026-10-20T08:00:00Z'),
    });

    renderApp(make('2026-10-20T07:59:59Z'));
    expect(await screen.findByRole('tab', { name: 'Nadchodzące (1)' })).toBeVisible();
    cleanup();

    renderApp(make('2026-10-20T08:00:00Z')); // exactly the appointment's instant: still upcoming
    expect(await screen.findByRole('tab', { name: 'Nadchodzące (1)' })).toBeVisible();
    cleanup();

    renderApp(make('2026-10-20T08:00:01Z'));
    expect(await screen.findByRole('tab', { name: 'Minione (1)' })).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Brak nadchodzących wizyt' })).toBeVisible();
  });

  it('labels an elapsed scheduled appointment in words, explains it, and does not change it', async () => {
    const services = createTestServices();
    await seed(services, {
      id: 'need',
      doctorName: 'dr Zapomniany',
      scheduledAt: at('2026-10-14T09:00:00Z'),
    });
    const writesBefore = services.storage.writes.length;
    renderApp(services, '/appointments?tab=past');

    const card = (await screen.findByText('dr Zapomniany')).closest('li');
    if (card === null) throw new Error('no card');
    expect(within(card).getByText('Do potwierdzenia')).toBeVisible();
    expect(within(card).getByText(/Termin tej wizyty minął/)).toBeVisible();
    expect(within(card).getByRole('button', { name: /^Oznacz jako odbytą/ })).toBeVisible();
    expect(within(card).getByRole('button', { name: /^Oznacz jako odwołaną/ })).toBeVisible();
    expect(within(card).queryByRole('button', { name: /Przywróć/ })).not.toBeInTheDocument();
    // Nothing was written, and the stored status is still "scheduled".
    expect(services.storage.writes).toHaveLength(writesBefore);
    expect((await stored(services, 'need')).status).toBe('scheduled');
  });

  it('points from the upcoming tab to appointments that need confirmation', async () => {
    const user = userEvent.setup();
    const services = createTestServices();
    await seedAll(services);
    renderApp(services);

    expect(
      await screen.findByText('Masz 1 wizytę do potwierdzenia na liście minionych.'),
    ).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Zobacz minione wizyty' }));

    expect(await screen.findByRole('heading', { name: 'Minione wizyty' })).toBeVisible();
    expect(screen.queryByText(/do potwierdzenia na liście/)).not.toBeInTheDocument();
  });

  it('writes the state in words for completed and cancelled appointments, with no confirmation prompt', async () => {
    const services = createTestServices();
    await seedAll(services);
    renderApp(services, '/appointments?tab=past');

    await screen.findByRole('heading', { name: 'Minione wizyty' });

    expect(screen.getByText('Odbyła się')).toBeVisible();
    expect(screen.getByText('Odwołana')).toBeVisible();
    expect(screen.getAllByText('Do potwierdzenia')).toHaveLength(1);
    // A cancelled appointment dated in the future is in the past list, not the upcoming one.
    expect(screen.getByRole('tab', { name: 'Nadchodzące (3)' })).toBeVisible();
  });

  it('shows the same saved state after the page is opened again', async () => {
    const user = userEvent.setup();
    const services = createTestServices();
    await seed(services, {
      id: 'a',
      doctorName: 'dr Nowak',
      scheduledAt: at('2026-10-20T08:00:00Z'),
    });
    renderApp(services);
    await user.click(await button(/^Oznacz jako odbytą/));
    await screen.findByText(/Oznaczono jako odbytą/);
    cleanup();

    renderApp(services, '/appointments?tab=past');

    expect(await screen.findByText('Odbyła się')).toBeVisible();
    expect(screen.queryByText(/Oznaczono jako odbytą/)).not.toBeInTheDocument();
  });
});

describe('appointments: changing the status', () => {
  const upcoming = { id: 'a', doctorName: 'dr Nowak', scheduledAt: at('2026-10-20T08:00:00Z') };
  const done = (name: string) => `Oznacz jako odbytą: dr Nowak, 20 października 2026, 10:00${name}`;

  it('marks an upcoming appointment completed: saved once, announced, and moved to the past', async () => {
    const user = userEvent.setup();
    const services = createTestServices();
    await seed(services, upcoming);
    renderApp(services);

    await user.click(await button(done('')));

    const notice = await screen.findByText(
      'Oznaczono jako odbytą: dr Nowak, 20 października 2026, 10:00.',
    );
    expect(notice.closest('[role="status"]')).toHaveAttribute('aria-live', 'polite');
    expect(await stored(services, 'a')).toMatchObject({
      status: 'completed',
      scheduledAt: upcoming.scheduledAt,
    });
    expect(await screen.findByRole('heading', { name: 'Brak nadchodzących wizyt' })).toBeVisible();
    expect(screen.getByRole('tab', { name: 'Minione (1)' })).toBeVisible();
  });

  it('marks an upcoming appointment cancelled', async () => {
    const user = userEvent.setup();
    const services = createTestServices();
    await seed(services, upcoming);
    renderApp(services);

    await user.click(await button(/^Oznacz jako odwołaną/));

    expect(await screen.findByText(/Oznaczono jako odwołaną: dr Nowak/)).toBeVisible();
    expect((await stored(services, 'a')).status).toBe('cancelled');
  });

  it('confirms an elapsed appointment from the past tab, and the card stays with its new state', async () => {
    const user = userEvent.setup();
    const services = createTestServices();
    await seed(services, {
      id: 'need',
      doctorName: 'dr Zapomniany',
      scheduledAt: at('2026-10-14T09:00:00Z'),
    });
    renderApp(services, '/appointments?tab=past');

    await user.click(await button(/^Oznacz jako odbytą/));

    expect(await screen.findByText(/Oznaczono jako odbytą: dr Zapomniany/)).toBeVisible();
    expect(await screen.findByText('Odbyła się')).toBeVisible();
    expect(screen.queryByText('Do potwierdzenia')).not.toBeInTheDocument();
    expect((await stored(services, 'need')).status).toBe('completed');
  });

  it('restores a completed appointment as scheduled, and it returns to the upcoming list', async () => {
    const user = userEvent.setup();
    const services = createTestServices();
    await seed(services, { ...upcoming, status: 'completed' });
    renderApp(services, '/appointments?tab=past');

    await user.click(await button(/^Przywróć jako zaplanowaną/));

    expect(await screen.findByText(/Przywrócono jako zaplanowaną: dr Nowak/)).toBeVisible();
    expect((await stored(services, 'a')).status).toBe('scheduled');
    expect(await screen.findByRole('tab', { name: 'Nadchodzące (1)' })).toBeVisible();
  });

  it('says so when a restored appointment is already in the past: it then needs confirmation', async () => {
    const user = userEvent.setup();
    const services = createTestServices();
    await seed(services, {
      id: 'old',
      doctorName: 'dr Dawny',
      status: 'cancelled',
      scheduledAt: at('2026-10-01T08:00:00Z'),
    });
    renderApp(services, '/appointments?tab=past');

    await user.click(await button(/^Przywróć jako zaplanowaną/));

    expect(
      await screen.findByText(
        /Jej termin już minął, więc ma status „do potwierdzenia” na liście Minione/,
      ),
    ).toBeVisible();
    expect(await screen.findByText('Do potwierdzenia')).toBeVisible();
  });

  it('offers no direct switch between completed and cancelled: a correction goes through "scheduled"', async () => {
    const services = createTestServices();
    await seed(services, { ...upcoming, status: 'completed' });
    renderApp(services, '/appointments?tab=past');

    await screen.findByText('Odbyła się');

    expect(screen.queryByRole('button', { name: /^Oznacz jako odwołaną/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Przywróć jako zaplanowaną/ })).toBeVisible();
  });

  it('changes only that appointment', async () => {
    const user = userEvent.setup();
    const services = createTestServices();
    await seed(services, upcoming, {
      id: 'b',
      doctorName: 'dr Inny',
      scheduledAt: at('2026-10-21T08:00:00Z'),
    });
    const otherBefore = await stored(services, 'b');
    renderApp(services);

    await user.click(await button(done('')));
    await screen.findByText(/Oznaczono jako odbytą/);

    expect(await stored(services, 'b')).toEqual(otherBefore);
  });

  it('refuses a stale request for completed -> cancelled, explains, and refreshes', async () => {
    const user = userEvent.setup();
    const services = createTestServices();
    await seed(services, upcoming);
    renderApp(services);
    const cancel = await button(/^Oznacz jako odwołaną/);
    // Meanwhile, elsewhere, the appointment was marked completed.
    await services.repositories.appointments.update({
      ...makeAppointment(upcoming),
      status: 'completed',
    });

    await user.click(cancel);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Nie zmieniono statusu');
    expect(alert).toHaveTextContent('została odświeżony'.replace('została', 'został'));
    expect((await stored(services, 'a')).status).toBe('completed');
    expect(await screen.findByRole('heading', { name: 'Brak nadchodzących wizyt' })).toBeVisible();
  });

  it('a repeated request for the status it already has is a harmless no-op', async () => {
    const user = userEvent.setup();
    const services = createTestServices();
    await seed(services, upcoming);
    renderApp(services);
    const complete = await button(/^Oznacz jako odbytą/);
    await services.repositories.appointments.update({
      ...makeAppointment(upcoming),
      status: 'completed',
    });
    const writesBefore = services.storage.writes.length;

    await user.click(complete);

    expect(await screen.findByText(/Ta wizyta miała już taki status/)).toBeVisible();
    expect(services.storage.writes).toHaveLength(writesBefore);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('reports an appointment deleted elsewhere, and refreshes without recreating it', async () => {
    const user = userEvent.setup();
    const services = createTestServices();
    await seed(services, upcoming);
    renderApp(services);
    const complete = await button(/^Oznacz jako odbytą/);
    await services.repositories.appointments.remove('a');

    await user.click(complete);

    expect(await screen.findByRole('alert')).toHaveTextContent('Ta wizyta została już usunięta');
    expect(
      await screen.findByRole('heading', { name: 'Nie dodano jeszcze żadnej wizyty' }),
    ).toBeVisible();
    expect(await services.repositories.appointments.list()).toEqual([]);
  });

  it('shows a failed save as an error, never as success, and the status stays', async () => {
    const user = userEvent.setup();
    const services = createTestServices();
    await seed(services, upcoming);
    renderApp(services);
    const complete = await button(/^Oznacz jako odbytą/);
    services.storage.failWrites();

    await user.click(complete);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Nie zmieniono statusu');
    expect(alert).toHaveTextContent('Zmiany nie zostały zapisane');
    expect(screen.queryByText(/Oznaczono jako/)).not.toBeInTheDocument();
    services.storage.heal();
    expect((await stored(services, 'a')).status).toBe('scheduled');
    expect(screen.getByRole('tab', { name: 'Nadchodzące (1)' })).toBeVisible();
  });

  it('a double click writes once; every action is disabled while the write is pending and reports success only afterwards', async () => {
    const user = userEvent.setup();
    const services = createTestServices();
    await seed(services, upcoming);
    const gate = createDeferred<undefined>();
    const update = services.repositories.appointments.update.bind(
      services.repositories.appointments,
    );
    const spy = vi
      .spyOn(services.repositories.appointments, 'update')
      .mockImplementation(async (entry) => {
        await gate.promise;
        return update(entry);
      });
    renderApp(services);
    const complete = await button(/^Oznacz jako odbytą/);

    await user.dblClick(complete);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /^Oznacz jako odwołaną/ })).toBeDisabled();
    });
    expect(complete).toBeDisabled();
    expect(screen.getByRole('button', { name: /^Usuń trwale/ })).toBeDisabled();
    expect(screen.queryByText(/Oznaczono jako/)).not.toBeInTheDocument();
    gate.resolve(undefined);

    expect(await screen.findByText(/Oznaczono jako odbytą/)).toBeVisible();
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('a second click that arrives before the screen re-renders is ignored and does not switch the progress indicator off', async () => {
    const services = createTestServices();
    await seed(services, upcoming);
    const gate = createDeferred<undefined>();
    const update = services.repositories.appointments.update.bind(
      services.repositories.appointments,
    );
    const spy = vi
      .spyOn(services.repositories.appointments, 'update')
      .mockImplementation(async (entry) => {
        await gate.promise;
        return update(entry);
      });
    renderApp(services);
    const complete = await button(/^Oznacz jako odbytą/);

    // Both clicks reach the handler in the same tick, before React could disable the button.
    act(() => {
      complete.click();
      complete.click();
    });

    // Let everything the two clicks started run, while the write is still waiting.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(complete).toHaveAttribute('aria-busy', 'true');
    expect(complete).toBeDisabled();
    gate.resolve(undefined);
    expect(await screen.findByText(/Oznaczono jako odbytą/)).toBeVisible();
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('moves focus to the appointment that changed, or to the list heading when it left the tab', async () => {
    const user = userEvent.setup();
    const services = createTestServices();
    await seed(services, {
      id: 'need',
      doctorName: 'dr Zapomniany',
      scheduledAt: at('2026-10-14T09:00:00Z'),
    });
    renderApp(services, '/appointments?tab=past');
    await user.click(await button(/^Oznacz jako odbytą/));
    await screen.findByText(/Oznaczono jako odbytą/);

    const status = await screen.findByText('Odbyła się');
    await waitFor(() => {
      expect(status.closest('p')).toHaveFocus();
    });
    cleanup();

    await seed(services, upcoming);
    renderApp(services);
    await user.click(await button(/^Oznacz jako odwołaną: dr Nowak/));
    await screen.findByText(/Oznaczono jako odwołaną/);

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Nadchodzące wizyty' })).toHaveFocus();
    });
  });

  it('can be operated with the keyboard alone', async () => {
    const user = userEvent.setup();
    const services = createTestServices();
    await seed(services, upcoming);
    renderApp(services);
    (await button(/^Oznacz jako odbytą/)).focus();

    await user.keyboard('{Enter}');

    expect(await screen.findByText(/Oznaczono jako odbytą/)).toBeVisible();
  });
});

describe('appointments: deleting', () => {
  const target = { id: 'a', doctorName: 'dr Nowak', scheduledAt: at('2026-10-20T08:00:00Z') };
  const deleteButton = () => button('Usuń trwale…: dr Nowak, 20 października 2026, 10:00');

  it('asks first, says it is permanent, and focuses Cancel', async () => {
    const user = userEvent.setup();
    const services = createTestServices();
    await seed(services, target);
    renderApp(services);

    await user.click(await deleteButton());

    const dialog = await screen.findByRole('dialog', { name: 'Trwale usunąć wizytę „dr Nowak”?' });
    expect(dialog).toHaveTextContent('dr Nowak, 20 października 2026, 10:00');
    expect(dialog).toHaveTextContent('trwale usunięta');
    expect(dialog).toHaveTextContent('Tej operacji nie można cofnąć');
    expect(dialog).toHaveTextContent('oznaczyć jako odwołaną');
    expect(within(dialog).getByRole('button', { name: 'Anuluj' })).toHaveFocus();
    expect(await services.repositories.appointments.list()).toHaveLength(1);
  });

  it('Cancel and the close button change nothing', async () => {
    const user = userEvent.setup();
    const services = createTestServices();
    await seed(services, target);
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
    expect(await services.repositories.appointments.list()).toHaveLength(1);
    expect(screen.queryByText(/Usunięto wizytę/)).not.toBeInTheDocument();
  });

  it('deletes exactly that appointment, says so, and moves focus to the list', async () => {
    const user = userEvent.setup();
    const services = createTestServices();
    await seed(services, target, {
      id: 'b',
      doctorName: 'dr Inny',
      scheduledAt: at('2026-10-21T08:00:00Z'),
    });
    renderApp(services);

    await user.click(await deleteButton());
    await user.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Usuń wizytę' }),
    );

    expect(
      await screen.findByText('Usunięto wizytę: dr Nowak, 20 października 2026, 10:00.'),
    ).toBeVisible();
    expect((await services.repositories.appointments.list()).map((entry) => entry.id)).toEqual([
      'b',
    ]);
    expect(await screen.findByRole('tab', { name: 'Nadchodzące (1)' })).toBeVisible();
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Nadchodzące wizyty' })).toHaveFocus();
    });
  });

  it('after deleting the last appointment shows the empty state and keeps focus on the page', async () => {
    const user = userEvent.setup();
    const services = createTestServices();
    await seed(services, target);
    renderApp(services);

    await user.click(await deleteButton());
    await user.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Usuń wizytę' }),
    );

    expect(
      await screen.findByRole('heading', { name: 'Nie dodano jeszcze żadnej wizyty' }),
    ).toBeVisible();
    expect(screen.getByText(/Usunięto wizytę/)).toBeVisible();
    await waitFor(() => {
      expect(document.getElementById('main-content')).toHaveFocus();
    });
  });

  it('does not delete an appointment merely because it is past or needs confirmation', async () => {
    const services = createTestServices();
    await seed(services, {
      id: 'need',
      doctorName: 'dr Zapomniany',
      scheduledAt: at('2026-10-14T09:00:00Z'),
    });
    renderApp(services, '/appointments?tab=past');

    expect(await screen.findByText('dr Zapomniany')).toBeVisible();
    expect(await services.repositories.appointments.list()).toHaveLength(1);
  });

  it('keeps the dialog open with the reason when storage fails, and the appointment stays', async () => {
    const user = userEvent.setup();
    const services = createTestServices();
    await seed(services, target);
    renderApp(services);
    await user.click(await deleteButton());
    const dialog = await screen.findByRole('dialog');
    services.storage.failWrites();

    await user.click(within(dialog).getByRole('button', { name: 'Usuń wizytę' }));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Nie usunięto wizyty.');
    expect(screen.queryByText(/Usunięto wizytę/)).not.toBeInTheDocument();
    services.storage.heal();
    expect(await services.repositories.appointments.list()).toHaveLength(1);

    await user.click(within(dialog).getByRole('button', { name: 'Usuń wizytę' }));
    expect(await screen.findByText(/Usunięto wizytę/)).toBeVisible();
    expect(await services.repositories.appointments.list()).toEqual([]);
  });

  it('a double click on the confirm button deletes once', async () => {
    const user = userEvent.setup();
    const services = createTestServices();
    await seed(services, target);
    const gate = createDeferred<undefined>();
    const remove = services.repositories.appointments.remove.bind(
      services.repositories.appointments,
    );
    const spy = vi
      .spyOn(services.repositories.appointments, 'remove')
      .mockImplementation(async (id) => {
        await gate.promise;
        return remove(id);
      });
    renderApp(services);
    await user.click(await deleteButton());
    const confirm = within(await screen.findByRole('dialog')).getByRole('button', {
      name: 'Usuń wizytę',
    });

    await user.dblClick(confirm);
    gate.resolve(undefined);

    await screen.findByText(/Usunięto wizytę/);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('treats an appointment that was already deleted elsewhere as done, without an error', async () => {
    const user = userEvent.setup();
    const services = createTestServices();
    await seed(services, target);
    renderApp(services);
    await user.click(await deleteButton());
    const dialog = await screen.findByRole('dialog');
    await services.repositories.appointments.remove('a');

    await user.click(within(dialog).getByRole('button', { name: 'Usuń wizytę' }));

    expect(await screen.findByText(/Ta wizyta była już usunięta/)).toBeVisible();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('can be done with the keyboard alone, and Enter on the initial focus (Cancel) cannot delete', async () => {
    const user = userEvent.setup();
    const services = createTestServices();
    await seed(services, target);
    renderApp(services);
    (await deleteButton()).focus();

    await user.keyboard('{Enter}');
    await user.keyboard('{Enter}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(await services.repositories.appointments.list()).toHaveLength(1);

    (await deleteButton()).focus();
    await user.keyboard('{Enter}');
    await user.tab();
    expect(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Usuń wizytę' }),
    ).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(await screen.findByText(/Usunięto wizytę/)).toBeVisible();
  });
});

describe('appointments: navigation', () => {
  it('links to the edit form of the appointment', async () => {
    const user = userEvent.setup();
    const services = createTestServices();
    await seed(services, {
      id: 'a',
      doctorName: 'dr Nowak',
      scheduledAt: at('2026-10-20T08:00:00Z'),
    });
    const { router } = renderApp(services);

    await user.click(
      await screen.findByRole('link', {
        name: 'Edytuj wizytę: dr Nowak, 20 października 2026, 10:00',
      }),
    );

    expect(router.state.location.pathname).toBe('/appointments/a/edit');
  });

  it('is part of the main navigation and titles the tab', async () => {
    renderApp();
    await screen.findByRole('heading', { level: 1, name: 'Wizyty' });

    const link = within(screen.getByRole('navigation', { name: 'Główna nawigacja' })).getByRole(
      'link',
      {
        name: 'Wizyty',
      },
    );
    expect(link).toHaveAttribute('aria-current', 'page');
    expect(document.title).toBe('Wizyty – Pigoowa');
  });
});
