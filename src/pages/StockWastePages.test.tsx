import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it } from 'vitest';
import { ServicesProvider } from '@/app/ServicesProvider';
import { routes } from '@/app/routes';
import { createQuotaError } from '@/test/fakeStorage';
import { makeDoseLog, makeMedication, makeStockEvent, scheduleTime } from '@/test/fixtures';
import { createTestServices } from '@/test/services';
import { STORAGE_KEYS } from '@/services/local/collections';
import { asLocalDate, asTimestamp } from '@/utils/date';

// F7: wasted medicine, through the real screens and repositories over a fake storage. The test
// clock says 12:00 on 15 October 2026 in Warsaw (2026-10-15T10:00:00Z).

type Services = ReturnType<typeof createTestServices>;

function renderApp(path: string, services: Services) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(
    <ServicesProvider services={services}>
      <RouterProvider router={router} />
    </ServicesProvider>,
  );
  return { router, services };
}

const COUNTED = asTimestamp('2026-10-01T08:00:00Z');
const NOW = '2026-10-15T10:00:00.000Z';
const TODAY = asLocalDate('2026-10-15');
const WIDE = [asLocalDate('2000-01-01'), asLocalDate('2999-12-31')] as const;

async function seed(services: Services, ...overrides: Parameters<typeof makeMedication>[0][]) {
  for (const override of overrides) {
    await services.repositories.medications.create(
      makeMedication({
        startDate: asLocalDate('2026-01-01'),
        scheduleEffectiveFrom: asLocalDate('2026-01-01'),
        scheduleTimes: [scheduleTime('t-1', '08:00', 1)],
        ...override,
      }),
    );
  }
}

const withStock = (quantity = 20, extra = {}) => ({
  id: 'm-1',
  name: 'Demoxal',
  stock: { quantity, unit: 'tabletka', asOf: COUNTED },
  ...extra,
});

const eventFor = (overrides: Parameters<typeof makeStockEvent>[0] = {}) =>
  makeStockEvent({ medicationId: 'm-1', ...overrides });
const events = (services: Services) => services.repositories.stockEvents.list();
const card = async (name: string) => within(await screen.findByRole('article', { name }));
const dialog = () => within(screen.getByRole('dialog'));
const wasteButton = () => screen.findByRole('button', { name: 'Zapisz stratę leku Demoxal' });

async function openWaste(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await wasteButton());
  return dialog();
}

describe('the waste action', () => {
  it('is offered next to the refill for a medication with a stock; not for an unknown stock or an ended medication', async () => {
    const services = createTestServices();
    await seed(
      services,
      withStock(),
      { id: 'm-2', name: 'Bez zapasu', stock: null },
      withStock(20, { id: 'm-3', name: 'Skończony', endDate: asLocalDate('2026-10-01') }),
    );
    renderApp('/medications', services);

    const tracked = await card('Demoxal');
    expect(tracked.getByRole('button', { name: 'Zapisz stratę leku Demoxal' })).toBeVisible();
    expect(tracked.getByRole('button', { name: 'Uzupełnij zapas leku Demoxal' })).toBeVisible();
    expect(
      (await card('Bez zapasu')).queryByRole('button', { name: /Zapisz stratę/ }),
    ).not.toBeInTheDocument();
    expect(
      (await card('Skończony')).queryByRole('button', { name: /Zapisz stratę/ }),
    ).not.toBeInTheDocument();
  });

  it('records one waste event after the confirmation, and the estimate and the history follow', async () => {
    const user = userEvent.setup();
    const services = createTestServices();
    await seed(services, withStock(20));
    renderApp('/medications', services);
    expect(await (await card('Demoxal')).findByText(/Pozostało ok\. 20 tabletek/)).toBeVisible();

    const waste = await openWaste(user);
    expect(waste.getByText(/To nie jest przyjęcie dawki/)).toBeVisible();
    expect(
      waste.getByText(/W jednostce zapasu: tabletka\. Jednostek nie przeliczamy/),
    ).toBeVisible();
    expect(await events(services)).toEqual([]); // opening records nothing
    await user.type(waste.getByRole('textbox', { name: /^Ile się zmarnowało/ }), '2,5');
    await user.type(waste.getByRole('textbox', { name: /^Notatka/ }), 'Wypadły do zlewu');
    await user.click(waste.getByRole('button', { name: 'Zapisz stratę' }));

    await waitFor(async () => {
      expect(await events(services)).toHaveLength(1);
    });
    expect((await events(services))[0]).toEqual({
      id: 'test-id-1',
      medicationId: 'm-1',
      kind: 'waste',
      amount: 2.5,
      unit: 'tabletka',
      recordedAt: NOW,
      note: 'Wypadły do zlewu',
      reversedAt: null,
    });
    expect(
      await screen.findByText(
        'Zapisano stratę leku „Demoxal”: odjęto 2,5 tabletki od zapasu. To nie jest zapis przyjęcia dawki.',
      ),
    ).toBeVisible();
    expect(await (await card('Demoxal')).findByText(/Pozostało ok\. 17,5 tabletki/)).toBeVisible();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('is NOT a taken dose: no intake record, no schedule change, the doses stay unrecorded', async () => {
    const user = userEvent.setup();
    const services = createTestServices();
    await seed(services, withStock(20));
    const scheduleBefore = (await services.repositories.medications.get('m-1')).scheduleTimes;
    renderApp('/medications', services);

    const waste = await openWaste(user);
    await user.type(waste.getByRole('textbox', { name: /^Ile się zmarnowało/ }), '1');
    await user.click(waste.getByRole('button', { name: 'Zapisz stratę' }));
    await waitFor(async () => {
      expect(await events(services)).toHaveLength(1);
    });

    expect(await services.repositories.doseLogs.listByDateRange(...WIDE)).toEqual([]);
    expect(await services.repositories.doseLogs.countForMedication('m-1')).toBe(0);
    const medication = await services.repositories.medications.get('m-1');
    expect(medication.scheduleTimes).toEqual(scheduleBefore);
    expect(medication.scheduleEffectiveFrom).toBe('2026-01-01');
    expect(medication.notes).toBeNull(); // the note is on the event only
    cleanup();

    renderApp('/', services);
    const doses = within(await screen.findByRole('region', { name: 'Dzisiejsze dawki' }));
    expect(
      await doses.findByText('Przyjęte: 0. Pominięte: 0. Bez zapisu: 1. Razem dziś: 1.'),
    ).toBeVisible();
    expect(doses.getByText('Nie zapisano')).toBeVisible();
    expect(
      doses.getByRole('button', { name: /^Oznacz jako przyjętą: Demoxal, 08:00/ }),
    ).toBeVisible();
  });

  it('leaves existing intake records exactly as they were', async () => {
    const user = userEvent.setup();
    const services = createTestServices();
    await seed(services, withStock(20));
    const log = makeDoseLog({
      id: 'l-1',
      medicationId: 'm-1',
      scheduledDate: asLocalDate('2026-10-14'),
      status: 'skipped',
      recordedAt: asTimestamp('2026-10-14T09:00:00Z'),
    });
    await services.repositories.doseLogs.upsert(log);
    renderApp('/medications', services);

    const waste = await openWaste(user);
    await user.type(waste.getByRole('textbox', { name: /^Ile się zmarnowało/ }), '3');
    await user.click(waste.getByRole('button', { name: 'Zapisz stratę' }));
    await waitFor(async () => {
      expect(await events(services)).toHaveLength(1);
    });

    expect(await services.repositories.doseLogs.listByDateRange(...WIDE)).toEqual([log]);
  });

  it('writes nothing until the person confirms: cancelling records no event, and the form starts empty again', async () => {
    const user = userEvent.setup();
    const services = createTestServices();
    await seed(services, withStock());
    renderApp('/medications', services);

    const waste = await openWaste(user);
    await user.type(waste.getByRole('textbox', { name: /^Ile się zmarnowało/ }), '2');
    await user.click(waste.getByRole('button', { name: 'Anuluj' }));

    expect(await events(services)).toEqual([]);
    expect(services.storage.data.has(STORAGE_KEYS.stockEvents)).toBe(false);
    expect(
      (await openWaste(user)).getByRole('textbox', { name: /^Ile się zmarnowało/ }),
    ).toHaveValue('');
  });

  it.each(['', '0', '-2', 'abc', '1,2345', '1e3'])(
    'refuses the amount "%s", says what to type, and records nothing',
    async (amount) => {
      const user = userEvent.setup();
      const services = createTestServices();
      await seed(services, withStock());
      renderApp('/medications', services);

      const waste = await openWaste(user);
      if (amount !== '')
        await user.type(waste.getByRole('textbox', { name: /^Ile się zmarnowało/ }), amount);
      await user.click(waste.getByRole('button', { name: 'Zapisz stratę' }));

      expect(
        await waste.findByText(/Wpisz ilość większą od zera, na przykład 2 lub 0,5/),
      ).toBeVisible();
      expect(waste.getByRole('textbox', { name: /^Ile się zmarnowało/ })).toBeInvalid();
      expect(await events(services)).toEqual([]);
    },
  );

  it('refuses a note over 500 characters', async () => {
    const user = userEvent.setup();
    const services = createTestServices();
    await seed(services, withStock());
    renderApp('/medications', services);
    const waste = await openWaste(user);
    await user.type(waste.getByRole('textbox', { name: /^Ile się zmarnowało/ }), '1');
    await user.click(waste.getByRole('textbox', { name: /^Notatka/ }));
    await user.paste('x'.repeat(501));

    await user.click(waste.getByRole('button', { name: 'Zapisz stratę' }));

    expect(await waste.findByText('Notatka może mieć najwyżej 500 znaków.')).toBeVisible();
    expect(await events(services)).toEqual([]);
  });

  it('warns while typing that the amount is larger than the estimate, and still records it: the estimate shows as used up', async () => {
    const user = userEvent.setup();
    const services = createTestServices();
    await seed(services, withStock(5));
    renderApp('/medications', services);
    expect(await (await card('Demoxal')).findByText(/Pozostało ok\. 5 tabletek/)).toBeVisible();

    const waste = await openWaste(user);
    const amount = waste.getByRole('textbox', { name: /^Ile się zmarnowało/ });
    await user.type(amount, '5');
    expect(waste.queryByRole('status')).not.toBeInTheDocument(); // equal to the estimate: no warning
    await user.clear(amount);
    await user.type(amount, '5,001');
    expect(await waste.findByRole('status')).toHaveTextContent(
      'Ta ilość jest większa niż szacowany zapas (5 tabletek). Zapiszemy ją mimo to',
    );
    await user.clear(amount);
    await user.type(amount, '8');
    await user.click(waste.getByRole('button', { name: 'Zapisz stratę' }));

    await waitFor(async () => {
      expect(await events(services)).toHaveLength(1);
    });
    expect((await events(services))[0]?.amount).toBe(8);
    expect(
      await (await card('Demoxal')).findByText(/Zapas wyczerpany \(0 tabletek\)/),
    ).toBeVisible();
  });

  it('a double click records one event', async () => {
    const user = userEvent.setup();
    const services = createTestServices();
    await seed(services, withStock());
    renderApp('/medications', services);
    const waste = await openWaste(user);
    await user.type(waste.getByRole('textbox', { name: /^Ile się zmarnowało/ }), '2');

    await user.dblClick(waste.getByRole('button', { name: 'Zapisz stratę' }));

    await screen.findByText(/Zapisano stratę leku/);
    expect(await events(services)).toHaveLength(1);
  });

  it('a failed write keeps the dialog and what was typed, says why, and a retry records one event with the same id', async () => {
    const user = userEvent.setup();
    const services = createTestServices();
    await seed(services, withStock());
    renderApp('/medications', services);
    const waste = await openWaste(user);
    await user.type(waste.getByRole('textbox', { name: /^Ile się zmarnowało/ }), '2');
    await user.type(waste.getByRole('textbox', { name: /^Notatka/ }), 'Zlew');

    services.storage.failWrites(createQuotaError(), (key) => key === STORAGE_KEYS.stockEvents);
    await user.click(waste.getByRole('button', { name: 'Zapisz stratę' }));

    expect(await waste.findByRole('alert')).toHaveTextContent(
      'W pamięci przeglądarki brakuje miejsca. Zmiany nie zostały zapisane.',
    );
    expect(waste.getByRole('textbox', { name: /^Ile się zmarnowało/ })).toHaveValue('2');
    expect(waste.getByRole('textbox', { name: /^Notatka/ })).toHaveValue('Zlew');
    expect(screen.queryByText(/Zapisano stratę leku/)).not.toBeInTheDocument();
    services.storage.heal();
    expect(await events(services)).toEqual([]);

    await user.click(waste.getByRole('button', { name: 'Zapisz stratę' }));
    await waitFor(async () => {
      expect(await events(services)).toHaveLength(1);
    });
    expect((await events(services))[0]?.id).toBe('test-id-1');
  });

  it('uses the stock unit when it differs from the dose unit, converts nothing, and leaves the estimate unavailable', async () => {
    const user = userEvent.setup();
    const services = createTestServices();
    await seed(services, {
      id: 'm-1',
      name: 'Demoxal',
      doseUnit: 'kropla',
      stock: { quantity: 10, unit: 'ml', asOf: COUNTED },
    });
    renderApp('/medications', services);

    const waste = await openWaste(user);
    expect(waste.getByText(/W jednostce zapasu: ml/)).toBeVisible();
    expect(waste.queryByRole('combobox')).not.toBeInTheDocument();
    await user.type(waste.getByRole('textbox', { name: /^Ile się zmarnowało/ }), '2');
    await user.click(waste.getByRole('button', { name: 'Zapisz stratę' }));

    await waitFor(async () => {
      expect(await events(services)).toHaveLength(1);
    });
    expect((await events(services))[0]).toMatchObject({ kind: 'waste', amount: 2, unit: 'ml' });
    expect(
      await (await card('Demoxal')).findByText(/Szacunek niedostępny: jednostka zapasu różni się/),
    ).toBeVisible();
    expect((await card('Demoxal')).queryByText('Niski zapas')).not.toBeInTheDocument();
  });

  it('refreshes the own threshold warning: a waste that reaches the threshold warns, and reversing it lifts the warning', async () => {
    const user = userEvent.setup();
    const services = createTestServices();
    await seed(services, withStock(20, { lowStockThreshold: { quantity: 15, unit: 'tabletka' } }));
    renderApp('/medications', services);
    expect((await card('Demoxal')).queryByText('Niski zapas')).not.toBeInTheDocument();

    const waste = await openWaste(user);
    await user.type(waste.getByRole('textbox', { name: /^Ile się zmarnowało/ }), '5');
    await user.click(waste.getByRole('button', { name: 'Zapisz stratę' }));

    // 20 - 5 = 15: exactly at the threshold.
    const demoxal = await card('Demoxal');
    expect(await demoxal.findByText('Niski zapas')).toBeVisible();
    expect(demoxal.getByText(/Zapas jest na poziomie Twojego progu \(15 tabletek\)/)).toBeVisible();
    expect(demoxal.getByText(/Pozostało ok\. 15 tabletek/)).toBeVisible();
  });
});

describe('the details page: waste in the history and its reversal', () => {
  it('shows the waste event among the others, newest first, with its note and its state', async () => {
    const services = createTestServices();
    await seed(services, withStock(20));
    await services.repositories.stockEvents.append(
      eventFor({ id: 'r', amount: 10, recordedAt: asTimestamp('2026-10-10T08:00:00Z') }),
    );
    await services.repositories.stockEvents.append(
      eventFor({
        id: 'w',
        kind: 'waste',
        amount: 4,
        note: 'Rozlane',
        recordedAt: asTimestamp('2026-10-11T08:00:00Z'),
      }),
    );
    renderApp('/medications/m-1', services);

    const history = within(await screen.findByRole('region', { name: 'Historia zdarzeń zapasu' }));
    const rows = (await history.findAllByRole('listitem')).map((item) => item.textContent);
    expect(rows[0]).toContain('Strata: odjęto 4 tabletki');
    expect(rows[0]).toContain('Wliczone w szacunek');
    expect(rows[0]).toContain('Rozlane');
    expect(rows[1]).toContain('Uzupełnienie: dodano 10 tabletek');
    // 20 + 10 - 4.
    expect(
      await within(screen.getByRole('region', { name: 'Zapas' })).findByText(
        /Pozostało ok\. 26 tabletek/,
      ),
    ).toBeVisible();
  });

  it('records a waste from the page: the event is first in the history, the estimate drops, no dose is touched', async () => {
    const user = userEvent.setup();
    const services = createTestServices();
    await seed(services, withStock(20));
    renderApp('/medications/m-1', services);

    await user.click(await screen.findByRole('button', { name: 'Zapisz stratę' }));
    const waste = dialog();
    await user.type(waste.getByRole('textbox', { name: /^Ile się zmarnowało/ }), '1,5');
    await user.click(waste.getByRole('button', { name: 'Zapisz stratę' }));

    const history = within(await screen.findByRole('region', { name: 'Historia zdarzeń zapasu' }));
    expect(await history.findByText('Strata: odjęto 1,5 tabletki')).toBeVisible();
    expect(
      await within(screen.getByRole('region', { name: 'Zapas' })).findByText(
        /Pozostało ok\. 18,5 tabletki/,
      ),
    ).toBeVisible();
    expect(await services.repositories.doseLogs.listByDateRange(...WIDE)).toEqual([]);
  });

  it('warns on the page too when the amount is larger than the estimate', async () => {
    const user = userEvent.setup();
    const services = createTestServices();
    await seed(services, withStock(3));
    renderApp('/medications/m-1', services);
    await within(await screen.findByRole('region', { name: 'Zapas' })).findByText(
      /Pozostało ok\. 3 tabletki/,
    );

    await user.click(screen.getByRole('button', { name: 'Zapisz stratę' }));
    await user.type(dialog().getByRole('textbox', { name: /^Ile się zmarnowało/ }), '4');

    expect(await dialog().findByRole('status')).toHaveTextContent(
      'większa niż szacowany zapas (3 tabletki)',
    );
  });

  it('reverses a waste after a confirmation: the estimate is restored and the event stays in the history', async () => {
    const user = userEvent.setup();
    const services = createTestServices();
    await seed(services, withStock(20));
    await services.repositories.stockEvents.append(
      eventFor({
        id: 'w',
        kind: 'waste',
        amount: 5,
        recordedAt: asTimestamp('2026-10-11T08:00:00Z'),
      }),
    );
    renderApp('/medications/m-1', services);
    const stock = async () => within(await screen.findByRole('region', { name: 'Zapas' }));
    expect(await (await stock()).findByText(/Pozostało ok\. 15 tabletek/)).toBeVisible();

    await user.click(
      await screen.findByRole('button', { name: /^Cofnij: Strata: odjęto 5 tabletek/ }),
    );
    expect((await events(services))[0]?.reversedAt).toBeNull(); // nothing yet
    await user.click(dialog().getByRole('button', { name: 'Cofnij zdarzenie' }));

    await waitFor(async () => {
      expect((await events(services))[0]?.reversedAt).toBe(NOW);
    });
    expect(await (await stock()).findByText(/Pozostało ok\. 20 tabletek/)).toBeVisible();
    const history = within(screen.getByRole('region', { name: 'Historia zdarzeń zapasu' }));
    expect(await history.findByText('Strata: odjęto 5 tabletek')).toBeVisible();
    expect(history.getByText('Cofnięte', { exact: true })).toBeVisible();
    expect(await events(services)).toHaveLength(1);
    expect(await services.repositories.doseLogs.listByDateRange(...WIDE)).toEqual([]);
  });

  it('a reversed waste does not lower the estimate again, and reversing it twice changes nothing', async () => {
    const services = createTestServices();
    await seed(services, withStock(20));
    await services.repositories.stockEvents.append(
      eventFor({
        id: 'w',
        kind: 'waste',
        amount: 5,
        recordedAt: asTimestamp('2026-10-11T08:00:00Z'),
        reversedAt: asTimestamp('2026-10-11T08:05:00Z'),
      }),
    );
    const again = await services.repositories.stockEvents.reverse(
      'w',
      asTimestamp('2026-10-12T08:00:00Z'),
    );
    renderApp('/medications/m-1', services);

    expect(again.reversedAt).toBe('2026-10-11T08:05:00.000Z');
    expect(
      await within(await screen.findByRole('region', { name: 'Zapas' })).findByText(
        /Pozostało ok\. 20 tabletek/,
      ),
    ).toBeVisible();
  });

  it('does not offer a waste for an unknown stock or an ended medication, and says why', async () => {
    const services = createTestServices();
    await seed(
      services,
      { id: 'm-1', name: 'Demoxal', stock: null },
      withStock(20, { id: 'm-2', name: 'Skończony', endDate: asLocalDate('2026-10-01') }),
    );

    renderApp('/medications/m-1', services);
    const unknown = within(await screen.findByRole('region', { name: 'Zapas' }));
    expect(await unknown.findByText(/Uzupełnienie wymaga policzonego zapasu/)).toBeVisible();
    expect(unknown.queryByRole('button', { name: 'Zapisz stratę' })).not.toBeInTheDocument();
    cleanup();

    renderApp('/medications/m-2', services);
    const ended = within(await screen.findByRole('region', { name: 'Zapas' }));
    expect(await ended.findByText(/Lek jest zakończony/)).toBeVisible();
    expect(ended.queryByRole('button', { name: 'Zapisz stratę' })).not.toBeInTheDocument();
  });

  it('keeps the waste events when the stock is counted again, as history before the count', async () => {
    const user = userEvent.setup();
    const services = createTestServices();
    await seed(services, withStock(20));
    await services.repositories.stockEvents.append(
      eventFor({
        id: 'w',
        kind: 'waste',
        amount: 5,
        recordedAt: asTimestamp('2026-10-11T08:00:00Z'),
      }),
    );
    renderApp('/medications/m-1/edit', services);
    await screen.findByRole('heading', { level: 1, name: 'Edytuj lek' });
    await user.clear(screen.getByRole('textbox', { name: 'Aktualny zapas' }));
    await user.type(screen.getByRole('textbox', { name: 'Aktualny zapas' }), '9');
    await user.click(screen.getByRole('button', { name: 'Zapisz zmiany' }));
    await waitFor(async () => {
      expect((await services.repositories.medications.get('m-1')).stock?.quantity).toBe(9);
    });
    cleanup();

    renderApp('/medications/m-1', services);

    const history = within(await screen.findByRole('region', { name: 'Historia zdarzeń zapasu' }));
    expect(await history.findByText('Sprzed ostatniego liczenia, nie wlicza się')).toBeVisible();
    expect(
      await within(screen.getByRole('region', { name: 'Zapas' })).findByText(
        /Pozostało ok\. 9 tabletek/,
      ),
    ).toBeVisible();
  });
});

describe('the dashboard, the day view and the card agree about a waste', () => {
  it('count the waste in the same estimate', async () => {
    const services = createTestServices();
    await seed(services, withStock(20));
    await services.repositories.stockEvents.append(
      eventFor({
        id: 'w',
        kind: 'waste',
        amount: 6,
        recordedAt: asTimestamp('2026-10-11T08:00:00Z'),
      }),
    );

    for (const path of ['/', '/doses', '/medications']) {
      renderApp(path, services);
      expect(
        await screen.findByText(/Pozostało ok\. 14 tabletek, wystarczy na ok\. 14 dni/),
      ).toBeVisible();
      cleanup();
    }
  });

  it('deleting the medication deletes its waste events with it', async () => {
    const user = userEvent.setup();
    const services = createTestServices();
    await seed(services, withStock(20));
    await services.repositories.stockEvents.append(
      eventFor({
        id: 'w',
        kind: 'waste',
        amount: 1,
        recordedAt: asTimestamp('2026-10-11T08:00:00Z'),
      }),
    );
    renderApp('/medications', services);

    await user.click(await screen.findByRole('button', { name: 'Usuń trwale… lek Demoxal' }));
    expect(await dialog().findByText('1 zdarzenie')).toBeVisible();
    await user.click(dialog().getByRole('button', { name: 'Usuń trwale' }));

    await waitFor(async () => {
      expect(await events(services)).toEqual([]);
    });
    expect(TODAY).toBe('2026-10-15');
  });
});
