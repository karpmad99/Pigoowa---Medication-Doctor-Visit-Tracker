import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { ServicesProvider } from '@/app/ServicesProvider';
import { routes } from '@/app/routes';
import type { Appointment } from '@/features/appointments/types';
import type { Medication } from '@/features/medications/types';
import { STORAGE_KEYS } from '@/services/local/collections';
import { createLocalServices } from '@/services/local/createLocalServices';
import { createFakeStorage } from '@/test/fakeStorage';
import { makeAppointment, makeDoseLog, makeMedication, scheduleTime } from '@/test/fixtures';
import { createDeferred, createTestServices } from '@/test/services';
import { createFixedClock } from '@/utils/clock';
import { asLocalDate, asTimestamp } from '@/utils/date';

// The test clock says 12:00 on Thursday 15 October 2026 in Warsaw (summer time, UTC+2), which is
// 2026-10-15T10:00:00Z. Appointment times below are UTC; the screen shows them in Warsaw time.

type Services = ReturnType<typeof createTestServices>;

function renderApp(services: Services = createTestServices(), entry = '/') {
  const router = createMemoryRouter(routes, { initialEntries: [entry] });
  render(
    <ServicesProvider services={services}>
      <RouterProvider router={router} />
    </ServicesProvider>,
  );
  return { router, services };
}

const at = (instant: string) => asTimestamp(instant);
const COUNTED = at('2026-10-01T08:00:00Z');

async function seedMedications(services: Services, ...overrides: Partial<Medication>[]) {
  for (const override of overrides) {
    await services.repositories.medications.create(makeMedication(override));
  }
}
async function seedAppointments(services: Services, ...overrides: Partial<Appointment>[]) {
  for (const override of overrides) {
    await services.repositories.appointments.create(makeAppointment(override));
  }
}

/** Two medications with stock, one without, with doses today at 07:30, 08:00 and 20:00. */
async function seedTypical(services: Services) {
  await seedMedications(
    services,
    {
      id: 'm-1',
      name: 'Demoxal',
      scheduleTimes: [scheduleTime('a1', '08:00', 1), scheduleTime('a2', '20:00', 1)],
      stock: { quantity: 10, unit: 'tabletka', asOf: COUNTED },
    },
    {
      id: 'm-2',
      name: 'Przykładyna',
      doseUnit: 'ml',
      scheduleTimes: [scheduleTime('b1', '07:30', 5)],
      stock: { quantity: 120, unit: 'ml', asOf: COUNTED },
    },
    { id: 'm-3', name: 'Testovit', scheduleTimes: [], stock: null },
  );
}

const panel = (name: string) => screen.findByRole('region', { name });
/** The list of stock items in the stock panel (the explanation below it has a list of its own). */
function stockItems(region: HTMLElement): HTMLElement[] {
  const [list] = within(region).getAllByRole('list');
  if (list === undefined) throw new Error('No list in the stock panel');
  return within(list).getAllByRole('listitem');
}
const taken = (name: string, time: string) =>
  screen.findByRole('button', { name: `Oznacz jako przyjętą: ${name}, ${time}` });

describe('dashboard: the page', () => {
  it('is the start page, with one level-one heading and a labelled region per panel', async () => {
    renderApp();

    expect(await screen.findByRole('heading', { level: 1, name: 'Pulpit' })).toBeVisible();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    for (const name of ['Dzisiejsze dawki', 'Najbliższe wizyty', 'Zapasy leków']) {
      const region = await panel(name);
      expect(within(region).getByRole('heading', { level: 2, name })).toBeVisible();
    }
    expect(document.title).toBe('Pigoowa');
    expect(
      within(screen.getByRole('navigation', { name: 'Główna nawigacja' })).getByRole('link', {
        name: 'Pulpit',
      }),
    ).toHaveAttribute('aria-current', 'page');
  });

  it('shows a loading state in every panel first, then the data', async () => {
    const services = createTestServices();
    await seedTypical(services);
    renderApp(services);

    expect(screen.getByText('Wczytywanie dzisiejszych dawek…')).toBeVisible();
    expect(screen.getByText('Wczytywanie wizyt…')).toBeVisible();
    expect(screen.getByText('Wczytywanie zapasów…')).toBeVisible();
    expect(await taken('Demoxal', '08:00')).toBeVisible();
    expect(screen.queryByText('Wczytywanie dzisiejszych dawek…')).not.toBeInTheDocument();
  });

  it('shows no percentage and no score anywhere, only counts', async () => {
    const services = createTestServices();
    await seedTypical(services);
    await services.repositories.doseLogs.upsert(
      makeDoseLog({ medicationId: 'm-1', recordedAt: at('2026-10-15T06:05:00Z') }),
    );
    renderApp(services);
    await taken('Demoxal', '20:00');

    expect(document.body.textContent).not.toMatch(/%/);
    expect(document.body.textContent).not.toMatch(/przestrzegan|adherence|wynik/i);
  });
});

describe('dashboard: today’s doses', () => {
  it('lists today’s planned doses in order, with the counts, and every dose as "Nie zapisano" at first', async () => {
    const services = createTestServices();
    await seedTypical(services);
    renderApp(services);

    const region = await panel('Dzisiejsze dawki');
    await taken('Demoxal', '08:00');
    expect(within(region).getByText('czwartek, 15 października 2026')).toBeVisible();
    const rows = within(region)
      .getAllByRole('listitem')
      .filter((item) => item.querySelector('time'));
    expect(
      rows.map((row) => [
        row.querySelector('time')?.textContent,
        row.querySelector('p.text-lg.font-semibold')?.textContent,
      ]),
    ).toEqual([
      ['07:30', 'Przykładyna'],
      ['08:00', 'Demoxal'],
      ['20:00', 'Demoxal'],
    ]);
    expect(
      within(region).getByText('Przyjęte: 0. Pominięte: 0. Bez zapisu: 3. Razem dziś: 3.'),
    ).toBeVisible();
    expect(within(region).getAllByText('Nie zapisano')).toHaveLength(3);
  });

  it('shows the doses of the local day, not the UTC day: 22:30 UTC on the 15th is already the 16th in Warsaw', async () => {
    const storage = createFakeStorage();
    let counter = 0;
    const services = createLocalServices({
      storage,
      clock: createFixedClock('2026-10-15T22:30:00Z'),
      timeZone: 'Europe/Warsaw',
      createId: () => `id-${String((counter += 1))}`,
    });
    // A medication whose schedule only starts on the 16th (local): it shows up only if "today" is the 16th.
    await services.repositories.medications.create(
      makeMedication({
        id: 'm-1',
        name: 'Od szesnastego',
        startDate: asLocalDate('2026-10-16'),
        scheduleEffectiveFrom: asLocalDate('2026-10-16'),
      }),
    );
    renderApp({ ...services, storage });

    const region = await panel('Dzisiejsze dawki');
    expect(await within(region).findByText('piątek, 16 października 2026')).toBeVisible();
    expect(await taken('Od szesnastego', '08:00')).toBeVisible();
  });

  it('does not plan doses for a medication that has ended or not started', async () => {
    const services = createTestServices();
    await seedMedications(
      services,
      { id: 'old', name: 'Zakończony', endDate: asLocalDate('2026-10-14') },
      {
        id: 'new',
        name: 'Przyszły',
        startDate: asLocalDate('2026-10-20'),
        scheduleEffectiveFrom: asLocalDate('2026-10-20'),
      },
    );
    renderApp(services);

    const region = await panel('Dzisiejsze dawki');
    expect(await within(region).findByText('Na dziś nie zaplanowano żadnych dawek')).toBeVisible();
    expect(within(region).queryByRole('button', { name: /Oznacz jako/ })).not.toBeInTheDocument();
    expect(within(region).getByRole('link', { name: 'Przejdź do dawek' })).toHaveAttribute(
      'href',
      '/doses',
    );
  });

  it('marks a dose taken or skipped from the dashboard: one record, and the counts and the stock follow', async () => {
    const user = userEvent.setup();
    const services = createTestServices();
    await seedTypical(services);
    renderApp(services);
    const region = await panel('Dzisiejsze dawki');
    const stock = await panel('Zapasy leków');
    await within(stock).findByText(/Pozostało ok\. 10 tabletek/);

    await user.click(await taken('Demoxal', '08:00'));

    expect(
      await within(region).findByText('Zapisano jako przyjętą: Demoxal, 08:00.'),
    ).toBeVisible();
    expect(
      await within(region).findByText('Przyjęte: 1. Pominięte: 0. Bez zapisu: 2. Razem dziś: 3.'),
    ).toBeVisible();
    await waitFor(() => {
      expect(within(stock).getByText(/Pozostało ok\. 9 tabletek/)).toBeVisible();
    });
    const logs = await services.repositories.doseLogs.listByDateRange(
      asLocalDate('2026-10-15'),
      asLocalDate('2026-10-15'),
    );
    expect(logs).toEqual([
      expect.objectContaining({
        medicationId: 'm-1',
        scheduledTime: '08:00',
        status: 'taken',
        doseAmount: 1,
      }),
    ]);

    await user.click(
      await screen.findByRole('button', { name: 'Oznacz jako pominiętą: Demoxal, 20:00' }),
    );
    expect(
      await within(region).findByText('Przyjęte: 1. Pominięte: 1. Bez zapisu: 1. Razem dziś: 3.'),
    ).toBeVisible();
    expect(within(stock).getByText(/Pozostało ok\. 9 tabletek/)).toBeVisible(); // skipped: no change
  });

  it('shows a failed write as an error, never as success, and changes nothing', async () => {
    const user = userEvent.setup();
    const services = createTestServices();
    await seedTypical(services);
    renderApp(services);
    const button = await taken('Demoxal', '08:00');
    services.storage.failWrites();

    await user.click(button);

    const region = await panel('Dzisiejsze dawki');
    expect(await within(region).findByRole('alert')).toHaveTextContent('Nie zapisano zmiany');
    expect(screen.queryByText(/Zapisano jako/)).not.toBeInTheDocument();
    expect(within(region).getByText(/Bez zapisu: 3/)).toBeVisible();
    services.storage.heal();
    expect(
      await services.repositories.doseLogs.listByDateRange(
        asLocalDate('2026-10-15'),
        asLocalDate('2026-10-15'),
      ),
    ).toEqual([]);
  });

  it('a double click records the dose once', async () => {
    const user = userEvent.setup();
    const services = createTestServices();
    await seedTypical(services);
    const gate = createDeferred<undefined>();
    const upsert = services.repositories.doseLogs.upsert.bind(services.repositories.doseLogs);
    const spy = vi
      .spyOn(services.repositories.doseLogs, 'upsert')
      .mockImplementation(async (entry) => {
        await gate.promise;
        return upsert(entry);
      });
    renderApp(services);

    await user.dblClick(await taken('Demoxal', '08:00'));
    gate.resolve(undefined);

    await screen.findByText('Zapisano jako przyjętą: Demoxal, 08:00.');
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('a second click that arrives before the screen re-renders is ignored and does not switch the progress indicator off', async () => {
    const services = createTestServices();
    await seedTypical(services);
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

  it('links to the full day view', async () => {
    const user = userEvent.setup();
    const services = createTestServices();
    await seedTypical(services);
    const { router } = renderApp(services);

    await user.click(
      await within(await panel('Dzisiejsze dawki')).findByRole('link', { name: 'Wszystkie dawki' }),
    );

    expect(router.state.location.pathname).toBe('/doses');
  });
});

describe('dashboard: the next appointments', () => {
  it('shows the next three upcoming appointments, soonest first, and says there are more', async () => {
    const services = createTestServices();
    await seedAppointments(
      services,
      { id: 'e', doctorName: 'dr Piąty', scheduledAt: at('2026-12-01T08:00:00Z') },
      {
        id: 'b',
        doctorName: 'dr Drugi',
        specialty: 'Kardiolog',
        scheduledAt: at('2026-10-17T08:00:00Z'),
      },
      { id: 'd', doctorName: 'dr Czwarty', scheduledAt: at('2026-11-01T08:00:00Z') },
      { id: 'a', doctorName: null, specialty: 'Okulista', scheduledAt: at('2026-10-16T12:30:00Z') },
      { id: 'c', doctorName: 'dr Trzeci', scheduledAt: at('2026-10-20T08:00:00Z') },
    );
    renderApp(services);

    const region = await panel('Najbliższe wizyty');
    expect(await within(region).findByText('Okulista')).toBeVisible();
    const items = within(region).getAllByRole('listitem');
    expect(items.map((item) => item.querySelector('p.font-medium')?.textContent)).toEqual([
      'Okulista',
      'dr Drugi',
      'dr Trzeci',
    ]);
    expect(items[0]).toHaveTextContent('piątek, 16 października 2026, 14:30');
    expect(items[1]).toHaveTextContent('sobota, 17 października 2026, 10:00');
    expect(within(region).getByText('Pokazano 3 z 5 nadchodzących wizyt.')).toBeVisible();
    expect(within(region).getAllByText('Zaplanowana')).toHaveLength(3);
  });

  it('puts an appointment at exactly the current instant among the upcoming ones, and one second earlier among those to confirm', async () => {
    const services = createTestServices();
    await seedAppointments(
      services,
      { id: 'now', doctorName: 'dr Teraz', scheduledAt: at('2026-10-15T10:00:00Z') },
      { id: 'earlier', doctorName: 'dr Chwilę temu', scheduledAt: at('2026-10-15T09:59:59Z') },
    );
    renderApp(services);

    const region = await panel('Najbliższe wizyty');
    expect(await within(region).findByText('dr Teraz')).toBeVisible();
    expect(within(region).queryByText('dr Chwilę temu')).not.toBeInTheDocument();
    expect(within(region).getByText(/Do potwierdzenia: 1 wizyta\./)).toBeVisible();
  });

  it('points to appointments that need confirmation, in words, and changes none of them', async () => {
    const user = userEvent.setup();
    const services = createTestServices();
    await seedAppointments(
      services,
      { id: 'late-1', doctorName: 'dr A', scheduledAt: at('2026-10-14T08:00:00Z') },
      { id: 'late-2', doctorName: 'dr B', scheduledAt: at('2026-10-01T08:00:00Z') },
      {
        id: 'done',
        doctorName: 'dr C',
        status: 'completed',
        scheduledAt: at('2026-10-02T08:00:00Z'),
      },
      { id: 'up', doctorName: 'dr D', scheduledAt: at('2026-10-20T08:00:00Z') },
    );
    const writesBefore = services.storage.writes.length;
    const { router } = renderApp(services);

    const region = await panel('Najbliższe wizyty');
    expect(await within(region).findByText(/Do potwierdzenia: 2 wizyty\./)).toBeVisible();
    await user.click(within(region).getByRole('link', { name: 'Potwierdź' }));

    expect(router.state.location.pathname).toBe('/appointments');
    expect(router.state.location.search).toBe('?tab=past');
    expect(services.storage.writes).toHaveLength(writesBefore);
    expect((await services.repositories.appointments.get('late-1')).status).toBe('scheduled');
  });

  it('says so when nothing is upcoming, while keeping a way to add an appointment', async () => {
    const services = createTestServices();
    await seedAppointments(services, {
      id: 'done',
      doctorName: 'dr C',
      status: 'completed',
      scheduledAt: at('2026-10-02T08:00:00Z'),
    });
    renderApp(services);

    const region = await panel('Najbliższe wizyty');
    expect(await within(region).findByText('Brak nadchodzących wizyt')).toBeVisible();
    expect(within(region).getByRole('link', { name: 'Dodaj wizytę' })).toHaveAttribute(
      'href',
      '/appointments/new',
    );
  });

  it('does not list a cancelled appointment as upcoming even when its time has not come', async () => {
    const services = createTestServices();
    await seedAppointments(
      services,
      {
        id: 'off',
        doctorName: 'dr Odwołany',
        status: 'cancelled',
        scheduledAt: at('2026-10-20T08:00:00Z'),
      },
      { id: 'ok', doctorName: 'dr Wizyta', scheduledAt: at('2026-10-21T08:00:00Z') },
    );
    renderApp(services);

    const region = await panel('Najbliższe wizyty');
    expect(await within(region).findByText('dr Wizyta')).toBeVisible();
    expect(within(region).queryByText('dr Odwołany')).not.toBeInTheDocument();
  });

  it('links to the full list', async () => {
    const user = userEvent.setup();
    const services = createTestServices();
    await seedAppointments(services, { id: 'a', scheduledAt: at('2026-10-20T08:00:00Z') });
    const { router } = renderApp(services);

    await user.click(
      await within(await panel('Najbliższe wizyty')).findByRole('link', {
        name: 'Wszystkie wizyty',
      }),
    );

    expect(router.state.location.pathname).toBe('/appointments');
  });
});

describe('dashboard: the stock summary', () => {
  it('lists only computable estimates, soonest to run out first, using the estimates the rest of the app uses', async () => {
    const services = createTestServices();
    await seedTypical(services);
    renderApp(services);

    const region = await panel('Zapasy leków');
    await within(region).findByText(/Pozostało ok\. 10 tabletek/);
    // The first list is the stock list (the explanation below has a list of its own).
    const items = stockItems(region);
    expect(items.map((item) => item.querySelector('p.text-lg.font-semibold')?.textContent)).toEqual(
      [
        'Demoxal', // 10 tablets, 2 a day: 5 days
        'Przykładyna', // 120 ml, 5 ml a day: 24 days
      ],
    );
    expect(items[0]).toHaveTextContent('Pozostało ok. 10 tabletek, wystarczy na ok. 5 dni.');
    expect(items[1]).toHaveTextContent('Pozostało ok. 120 ml, wystarczy na ok. 24 dni.');
  });

  it('marks a stock below seven days in words, and only an available estimate', async () => {
    const services = createTestServices();
    await seedTypical(services);
    renderApp(services);

    const region = await panel('Zapasy leków');
    await within(region).findByText(/Pozostało ok\. 10 tabletek/);

    expect(within(region).getAllByText('Niski zapas')).toHaveLength(1);
    const [firstItem] = stockItems(region);
    expect(firstItem).toBeDefined();
    expect(firstItem && within(firstItem).getByText('Niski zapas')).toBeVisible();
  });

  it('does not list a medication without a usable estimate, and says how many there are', async () => {
    const services = createTestServices();
    await seedMedications(
      services,
      { id: 'ok', name: 'Z zapasem', stock: { quantity: 20, unit: 'tabletka', asOf: COUNTED } },
      { id: 'none', name: 'Bez zapasu', stock: null },
      { id: 'units', name: 'Inne jednostki', stock: { quantity: 20, unit: 'mg', asOf: COUNTED } },
    );
    renderApp(services);

    const region = await panel('Zapasy leków');
    await within(region).findByText('Z zapasem');
    expect(within(region).queryByText('Bez zapasu')).not.toBeInTheDocument();
    expect(within(region).queryByText('Inne jednostki')).not.toBeInTheDocument();
    expect(within(region).getByText(/Dla 2 leków nie można policzyć szacunku/)).toBeVisible();
  });

  it('says plainly when no estimate can be computed, instead of an empty or misleading panel', async () => {
    const services = createTestServices();
    await seedMedications(services, { id: 'none', name: 'Bez zapasu', stock: null });
    renderApp(services);

    const region = await panel('Zapasy leków');
    expect(await within(region).findByText('Nie można jeszcze oszacować zapasu')).toBeVisible();
    expect(within(region).queryByText(/Pozostało/)).not.toBeInTheDocument();
    expect(within(region).getByText(/Dla 1 leku nie można policzyć szacunku/)).toBeVisible();
  });

  it('says it is an estimate, not a guarantee, and explains how it is made', async () => {
    const user = userEvent.setup();
    const services = createTestServices();
    await seedTypical(services);
    renderApp(services);

    const region = await panel('Zapasy leków');
    expect(await within(region).findByText(/a nie gwarancja, że lek jest dostępny/)).toBeVisible();
    await user.click(within(region).getByText('Jak liczymy szacunkowy zapas?'));
    expect(within(region).getByText(/To szacunek, a nie dokładny stan/)).toBeVisible();
  });

  it('shows used-up stock as zero, which is an available estimate', async () => {
    const services = createTestServices();
    await seedMedications(services, {
      id: 'm-1',
      name: 'Demoxal',
      stock: { quantity: 1, unit: 'tabletka', asOf: COUNTED },
    });
    await services.repositories.doseLogs.upsert(
      makeDoseLog({
        medicationId: 'm-1',
        scheduledDate: asLocalDate('2026-10-10'),
        recordedAt: at('2026-10-10T08:00:00Z'),
      }),
    );
    renderApp(services);

    const region = await panel('Zapasy leków');
    expect(await within(region).findByText('Zapas wyczerpany (0 tabletek).')).toBeVisible();
  });

  it('links to the medications', async () => {
    const user = userEvent.setup();
    const services = createTestServices();
    await seedTypical(services);
    const { router } = renderApp(services);

    await user.click(
      await within(await panel('Zapasy leków')).findByRole('link', { name: 'Zarządzaj lekami' }),
    );

    expect(router.state.location.pathname).toBe('/medications');
  });
});

const NEXT_DOSE_LABEL = 'Następna dawka bez zapisu';

/** The rows of today's doses (the ones with a time). */
function doseRows(region: HTMLElement): HTMLElement[] {
  return within(region)
    .getAllByRole('listitem')
    .filter((item) => item.querySelector('time'));
}

describe('dashboard: the next dose without a record', () => {
  it('frames and labels the first dose without a record, and only that one', async () => {
    const services = createTestServices();
    await seedTypical(services);
    renderApp(services);

    const region = await panel('Dzisiejsze dawki');
    await taken('Demoxal', '08:00');

    const rows = doseRows(region);
    expect(rows.map((row) => within(row).queryByText(NEXT_DOSE_LABEL) !== null)).toEqual([
      true, // 07:30
      false,
      false,
    ]);
    expect(within(region).getAllByText(NEXT_DOSE_LABEL)).toHaveLength(1);
    expect(rows[0]).toHaveTextContent('07:30');
  });

  it('moves to the next dose without a record after one is recorded, and is gone when all are', async () => {
    const user = userEvent.setup();
    const services = createTestServices();
    await seedTypical(services);
    renderApp(services);
    const region = await panel('Dzisiejsze dawki');

    await user.click(await taken('Przykładyna', '07:30'));
    await waitFor(() => {
      expect(doseRows(region)[1]).toHaveTextContent(NEXT_DOSE_LABEL);
    });
    expect(doseRows(region)[0]).not.toHaveTextContent(NEXT_DOSE_LABEL);

    await user.click(await taken('Demoxal', '08:00'));
    await waitFor(() => {
      expect(doseRows(region)[2]).toHaveTextContent(NEXT_DOSE_LABEL);
    });

    await user.click(
      await screen.findByRole('button', { name: 'Oznacz jako pominiętą: Demoxal, 20:00' }),
    );
    await waitFor(() => {
      expect(within(region).queryByText(NEXT_DOSE_LABEL)).not.toBeInTheDocument();
    });
  });

  it('keeps pointing at an earlier dose without a record: it never says "late" and ignores the clock', async () => {
    // The clock says 12:00; the 07:30 and 08:00 doses are long past and still unrecorded.
    const services = createTestServices();
    await seedTypical(services);
    renderApp(services);

    const region = await panel('Dzisiejsze dawki');
    await taken('Demoxal', '08:00');

    expect(doseRows(region)[0]).toHaveTextContent(NEXT_DOSE_LABEL);
    expect(region.textContent).not.toMatch(
      /spóźnion|zaległ|przeterminowan|pominięta automatycznie/i,
    );
    // A dose without a record is still just "Nie zapisano".
    expect(doseRows(region)[0]).toHaveTextContent('Nie zapisano');
  });

  it('is not shown when no dose is planned for today', async () => {
    const services = createTestServices();
    await seedMedications(services, { id: 'm-1', name: 'Demoxal', scheduleTimes: [] });
    renderApp(services);

    await panel('Dzisiejsze dawki');
    await screen.findByText('Na dziś nie zaplanowano żadnych dawek');

    expect(screen.queryByText(NEXT_DOSE_LABEL)).not.toBeInTheDocument();
  });

  it('is not shown on the day view, which has its own rows and its own purpose', async () => {
    const services = createTestServices();
    await seedTypical(services);
    renderApp(services, '/doses');

    await taken('Demoxal', '08:00');

    expect(screen.queryByText(NEXT_DOSE_LABEL)).not.toBeInTheDocument();
  });
});

describe('dashboard: a clearer low-stock line', () => {
  it('says in words, above the list, how many medications are low, with the limit', async () => {
    const services = createTestServices();
    await seedTypical(services);
    renderApp(services);

    const region = await panel('Zapasy leków');
    await within(region).findByText(/Pozostało ok\. 10 tabletek/);

    expect(
      within(region).getByText('Niski zapas: 1 lek. Szacunek wystarczy na mniej niż 7 dni.'),
    ).toBeVisible();
  });

  it('counts several with the right plural form, and frames only the low rows', async () => {
    const services = createTestServices();
    await seedMedications(
      services,
      {
        id: 'a',
        name: 'Pierwszy',
        scheduleTimes: [scheduleTime('a1', '08:00', 1)],
        stock: { quantity: 3, unit: 'tabletka', asOf: COUNTED },
      },
      {
        id: 'b',
        name: 'Drugi',
        scheduleTimes: [scheduleTime('b1', '08:00', 1)],
        stock: { quantity: 4, unit: 'tabletka', asOf: COUNTED },
      },
      {
        id: 'c',
        name: 'Trzeci',
        scheduleTimes: [scheduleTime('c1', '08:00', 1)],
        stock: { quantity: 90, unit: 'tabletka', asOf: COUNTED },
      },
    );
    renderApp(services);

    const region = await panel('Zapasy leków');
    await within(region).findByText('Trzeci');

    expect(
      within(region).getByText('Niski zapas: 2 leki. Szacunek wystarczy na mniej niż 7 dni.'),
    ).toBeVisible();
    const [first, second, third] = stockItems(region);
    expect(first).toHaveClass('border-warning-800');
    expect(second).toHaveClass('border-warning-800');
    expect(third).not.toHaveClass('border-warning-800');
    // The word is in each low row too, so the colour is never the only signal.
    expect(first && within(first).getByText('Niski zapas')).toBeVisible();
    expect(third && within(third).queryByText('Niski zapas')).not.toBeInTheDocument();
  });

  it('shows no such line when nothing is low, or when no estimate can be computed', async () => {
    const services = createTestServices();
    await seedMedications(
      services,
      {
        id: 'a',
        name: 'Duży zapas',
        scheduleTimes: [scheduleTime('a1', '08:00', 1)],
        stock: { quantity: 90, unit: 'tabletka', asOf: COUNTED },
      },
      { id: 'b', name: 'Bez zapasu', stock: null },
    );
    renderApp(services);

    const region = await panel('Zapasy leków');
    await within(region).findByText('Duży zapas');

    expect(within(region).queryByText(/^Niski zapas/)).not.toBeInTheDocument();
  });
});

describe('dashboard: the own low-stock threshold', () => {
  const stockOf = (quantity: number, unit = 'tabletka') => ({ quantity, unit, asOf: COUNTED });
  const daily = [scheduleTime('a1', '08:00', 1)];

  it('warns at the threshold even when the stock lasts for weeks, and says which rule', async () => {
    const services = createTestServices();
    await seedMedications(services, {
      id: 'a',
      name: 'Z progiem',
      scheduleTimes: daily,
      stock: stockOf(40),
      lowStockThreshold: { quantity: 40, unit: 'tabletka' },
    });
    renderApp(services);

    const region = await panel('Zapasy leków');
    await within(region).findByText('Z progiem');

    expect(
      within(region).getByText(
        /^Niski zapas: 1 lek\. Dla leków z własnym progiem ostrzegamy, gdy zapas jest na poziomie progu lub poniżej/,
      ),
    ).toBeVisible();
    const [item] = stockItems(region);
    expect(item).toHaveClass('border-warning-800');
    expect(
      item && within(item).getByText(/Zapas jest na poziomie Twojego progu \(40 tabletek\)/),
    ).toBeVisible();
  });

  it('does not warn above the threshold, even when the stock would run out within a week', async () => {
    const services = createTestServices();
    await seedMedications(services, {
      id: 'a',
      name: 'Własna reguła',
      scheduleTimes: daily,
      stock: stockOf(5),
      lowStockThreshold: { quantity: 4, unit: 'tabletka' },
    });
    renderApp(services);

    const region = await panel('Zapasy leków');
    await within(region).findByText('Własna reguła');

    expect(within(region).queryByText(/^Niski zapas/)).not.toBeInTheDocument();
  });

  it('falls back to the 7-day rule, and keeps the old sentence, for a threshold in another unit', async () => {
    const services = createTestServices();
    await seedMedications(services, {
      id: 'a',
      name: 'Inna jednostka',
      scheduleTimes: daily,
      stock: stockOf(3),
      lowStockThreshold: { quantity: 1, unit: 'ml' },
    });
    renderApp(services);

    const region = await panel('Zapasy leków');
    await within(region).findByText('Inna jednostka');

    expect(
      within(region).getByText('Niski zapas: 1 lek. Szacunek wystarczy na mniej niż 7 dni.'),
    ).toBeVisible();
  });

  it('never lists or flags a medication whose estimate is unavailable, whatever its threshold', async () => {
    const services = createTestServices();
    await seedMedications(
      services,
      {
        id: 'a',
        name: 'Z zapasem',
        scheduleTimes: daily,
        stock: stockOf(500),
      },
      { id: 'b', name: 'Bez zapasu', stock: null },
      {
        id: 'c',
        name: 'Inne jednostki dawki',
        doseUnit: 'tabletka',
        scheduleTimes: daily,
        stock: stockOf(1, 'ml'),
        lowStockThreshold: { quantity: 10, unit: 'ml' },
      },
    );
    renderApp(services);

    const region = await panel('Zapasy leków');
    await within(region).findByText('Z zapasem');

    expect(within(region).queryByText('Inne jednostki dawki')).not.toBeInTheDocument();
    expect(within(region).queryByText(/^Niski zapas/)).not.toBeInTheDocument();
  });
});

describe('dashboard: a new user', () => {
  it('sees a friendly empty state with a way to add data in every panel', async () => {
    const { router } = renderApp();
    const user = userEvent.setup();

    const doses = await panel('Dzisiejsze dawki');
    expect(await within(doses).findByText('Nie dodano jeszcze żadnego leku')).toBeVisible();
    expect(within(doses).getByRole('link', { name: 'Dodaj pierwszy lek' })).toHaveAttribute(
      'href',
      '/medications/new',
    );
    const appointments = await panel('Najbliższe wizyty');
    expect(await within(appointments).findByText('Nie dodano jeszcze żadnej wizyty')).toBeVisible();
    const stock = await panel('Zapasy leków');
    expect(await within(stock).findByText('Brak leków')).toBeVisible();
    expect(within(stock).getByRole('link', { name: 'Dodaj pierwszy lek' })).toBeVisible();

    await user.click(within(appointments).getByRole('link', { name: 'Dodaj pierwszą wizytę' }));
    expect(router.state.location.pathname).toBe('/appointments/new');
  });
});

describe('dashboard: independent panels', () => {
  it('a failure to read appointments does not hide the doses or the stock', async () => {
    const services = createTestServices(
      createFakeStorage({ [STORAGE_KEYS.appointments]: '{broken' }),
    );
    await seedTypical(services);
    renderApp(services);

    const appointments = await panel('Najbliższe wizyty');
    const alert = await within(appointments).findByRole('alert');
    expect(alert).toHaveTextContent('Nie udało się wczytać wizyt');
    expect(
      within(appointments).queryByText('Nie dodano jeszcze żadnej wizyty'),
    ).not.toBeInTheDocument();
    expect(await taken('Demoxal', '08:00')).toBeVisible();
    expect(
      await within(await panel('Zapasy leków')).findByText(/Pozostało ok\. 10 tabletek/),
    ).toBeVisible();
    expect(services.storage.data.get(STORAGE_KEYS.appointments)).toBe('{broken');
  });

  it('a failure to read the intake records fails the doses and the stock, and leaves the appointments', async () => {
    const services = createTestServices(createFakeStorage({ [STORAGE_KEYS.doseLogs]: '{broken' }));
    await seedTypical(services);
    await seedAppointments(services, {
      id: 'a',
      doctorName: 'dr Nowak',
      scheduledAt: at('2026-10-20T08:00:00Z'),
    });
    renderApp(services);

    expect(await within(await panel('Najbliższe wizyty')).findByText('dr Nowak')).toBeVisible();
    const doses = await panel('Dzisiejsze dawki');
    expect(await within(doses).findByRole('alert')).toHaveTextContent(
      'Nie udało się wczytać dzisiejszych dawek',
    );
    expect(
      within(doses).queryByText('Na dziś nie zaplanowano żadnych dawek'),
    ).not.toBeInTheDocument();
    expect(await within(await panel('Zapasy leków')).findByRole('alert')).toHaveTextContent(
      'Nie udało się wczytać zapasów',
    );
  });

  it('shows only the error, not also "no medication yet", when the records fail but the (empty) medications loaded', async () => {
    const services = createTestServices(createFakeStorage({ [STORAGE_KEYS.doseLogs]: '{broken' }));
    renderApp(services);

    const doses = await panel('Dzisiejsze dawki');
    expect(await within(doses).findByRole('alert')).toHaveTextContent('Nie udało się wczytać');
    expect(within(doses).queryByText('Nie dodano jeszcze żadnego leku')).not.toBeInTheDocument();
    const stock = await panel('Zapasy leków');
    expect(await within(stock).findByRole('alert')).toBeVisible();
    expect(within(stock).queryByText('Brak leków')).not.toBeInTheDocument();
  });

  it('a failure to read the medications fails the doses and the stock, and leaves the appointments', async () => {
    const services = createTestServices(
      createFakeStorage({ [STORAGE_KEYS.medications]: '{broken' }),
    );
    await seedAppointments(services, {
      id: 'a',
      doctorName: 'dr Nowak',
      scheduledAt: at('2026-10-20T08:00:00Z'),
    });
    renderApp(services);

    expect(await within(await panel('Najbliższe wizyty')).findByText('dr Nowak')).toBeVisible();
    expect(await within(await panel('Dzisiejsze dawki')).findByRole('alert')).toBeVisible();
    expect(await within(await panel('Zapasy leków')).findByRole('alert')).toBeVisible();
  });

  it('retry reloads the failed panel and it then shows its data, never as an empty state before that', async () => {
    const user = userEvent.setup();
    const services = createTestServices(
      createFakeStorage({ [STORAGE_KEYS.appointments]: '{broken' }),
    );
    renderApp(services);
    const appointments = await panel('Najbliższe wizyty');
    await within(appointments).findByRole('alert');

    services.storage.data.set(
      STORAGE_KEYS.appointments,
      JSON.stringify({
        version: 1,
        items: [
          makeAppointment({
            id: 'a',
            doctorName: 'dr Nowak',
            scheduledAt: at('2026-10-20T08:00:00Z'),
          }),
        ],
      }),
    );
    await user.click(within(appointments).getByRole('button', { name: 'Spróbuj ponownie' }));

    expect(await within(appointments).findByText('dr Nowak')).toBeVisible();
    expect(within(appointments).queryByRole('alert')).not.toBeInTheDocument();
  });
});

describe('dashboard: navigation', () => {
  it('is reached from the main navigation and leads to the other sections', async () => {
    const user = userEvent.setup();
    const { router } = renderApp(createTestServices(), '/medications');
    await screen.findByRole('heading', { level: 1, name: 'Leki' });

    await user.click(
      within(screen.getByRole('navigation', { name: 'Główna nawigacja' })).getByRole('link', {
        name: 'Pulpit',
      }),
    );

    expect(router.state.location.pathname).toBe('/');
    expect(await screen.findByRole('heading', { level: 1, name: 'Pulpit' })).toBeVisible();
    cleanup();
  });
});
