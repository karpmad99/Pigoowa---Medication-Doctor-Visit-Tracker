import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it } from 'vitest';
import { ServicesProvider } from '@/app/ServicesProvider';
import { routes } from '@/app/routes';
import { createQuotaError } from '@/test/fakeStorage';
import { makeMedication, makeStockEvent, scheduleTime } from '@/test/fixtures';
import { createTestServices } from '@/test/services';
import { STORAGE_KEYS } from '@/services/local/collections';
import { asLocalDate, asTimestamp } from '@/utils/date';

// F6: the refill, "start tracking", the history and the stock states, through the real screens and
// the real repositories over a fake storage. The test clock says 12:00 on 15 October 2026 in
// Warsaw, which is 2026-10-15T10:00:00Z.

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

const withStock = (quantity = 5, extra = {}) => ({
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

async function openRefillFromCard(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('button', { name: 'Uzupełnij zapas leku Demoxal' }));
  return dialog();
}

describe('the refill action on the medication card', () => {
  it('is offered for a medication with a stock, and start tracking for one without; neither for an ended one', async () => {
    const services = createTestServices();
    await seed(
      services,
      withStock(5),
      { id: 'm-2', name: 'Bez zapasu', stock: null },
      withStock(5, { id: 'm-3', name: 'Skończony', endDate: asLocalDate('2026-10-01') }),
      { id: 'm-4', name: 'Skończony bez zapasu', stock: null, endDate: asLocalDate('2026-10-01') },
    );
    renderApp('/medications', services);

    const tracked = await card('Demoxal');
    expect(tracked.getByRole('button', { name: 'Uzupełnij zapas leku Demoxal' })).toBeVisible();
    expect(
      tracked.queryByRole('button', { name: /Zacznij śledzić zapas/ }),
    ).not.toBeInTheDocument();
    const untracked = await card('Bez zapasu');
    expect(
      untracked.getByRole('button', { name: 'Zacznij śledzić zapas leku Bez zapasu' }),
    ).toBeVisible();
    expect(untracked.queryByRole('button', { name: /Uzupełnij zapas/ })).not.toBeInTheDocument();
    for (const name of ['Skończony', 'Skończony bez zapasu']) {
      const ended = await card(name);
      expect(
        ended.queryByRole('button', { name: /Uzupełnij zapas|Zacznij śledzić/ }),
      ).not.toBeInTheDocument();
    }
  });

  it('records one refill after a confirmation: the amount, the note, the stock unit, the moment, and shows the new estimate', async () => {
    const user = userEvent.setup();
    const services = createTestServices();
    await seed(services, withStock(5));
    renderApp('/medications', services);
    expect(await (await card('Demoxal')).findByText('Niski zapas')).toBeVisible();

    const refill = await openRefillFromCard(user);
    expect(
      refill.getByText(/W jednostce zapasu: tabletka\. Jednostek nie przeliczamy/),
    ).toBeVisible();
    await user.type(refill.getByRole('textbox', { name: /^Ile dokładasz/ }), '30');
    await user.type(refill.getByRole('textbox', { name: /^Notatka/ }), 'Nowe opakowanie');
    await user.click(refill.getByRole('button', { name: 'Uzupełnij zapas' }));

    await waitFor(async () => {
      expect(await events(services)).toHaveLength(1);
    });
    expect((await events(services))[0]).toEqual({
      id: 'test-id-1',
      medicationId: 'm-1',
      kind: 'refill',
      amount: 30,
      unit: 'tabletka',
      recordedAt: NOW,
      note: 'Nowe opakowanie',
      reversedAt: null,
    });
    expect(
      await screen.findByText('Uzupełniono zapas leku „Demoxal”: dodano 30 tabletek.'),
    ).toBeVisible();
    // 5 + 30 = 35 tablets: the estimate and the warning are recomputed.
    expect(
      await (
        await card('Demoxal')
      ).findByText(/Pozostało ok\. 35 tabletek, wystarczy na ok\. 35 dni/),
    ).toBeVisible();
    expect((await card('Demoxal')).queryByText('Niski zapas')).not.toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('writes nothing until the person confirms: opening and cancelling records no event', async () => {
    const user = userEvent.setup();
    const services = createTestServices();
    await seed(services, withStock(5));
    renderApp('/medications', services);

    const refill = await openRefillFromCard(user);
    await user.type(refill.getByRole('textbox', { name: /^Ile dokładasz/ }), '30');
    await user.click(refill.getByRole('button', { name: 'Anuluj' }));

    expect(await events(services)).toEqual([]);
    expect(services.storage.data.has(STORAGE_KEYS.stockEvents)).toBe(false);
    // Opened again, the form starts empty.
    const again = await openRefillFromCard(user);
    expect(again.getByRole('textbox', { name: /^Ile dokładasz/ })).toHaveValue('');
  });

  it.each(['', '0', '-3', 'abc', '1,2345', '1e3'])(
    'refuses the amount "%s", says what to type, and records nothing',
    async (amount) => {
      const user = userEvent.setup();
      const services = createTestServices();
      await seed(services, withStock(5));
      renderApp('/medications', services);

      const refill = await openRefillFromCard(user);
      if (amount !== '')
        await user.type(refill.getByRole('textbox', { name: /^Ile dokładasz/ }), amount);
      await user.click(refill.getByRole('button', { name: 'Uzupełnij zapas' }));

      expect(
        await refill.findByText(/Wpisz ilość większą od zera, na przykład 30 lub 0,5/),
      ).toBeVisible();
      expect(refill.getByRole('textbox', { name: /^Ile dokładasz/ })).toBeInvalid();
      expect(await events(services)).toEqual([]);
      expect(screen.getByRole('dialog')).toBeVisible();
    },
  );

  it('refuses a note over 500 characters, and accepts exactly 500', async () => {
    const user = userEvent.setup();
    const services = createTestServices();
    await seed(services, withStock(5));
    renderApp('/medications', services);
    const refill = await openRefillFromCard(user);
    await user.type(refill.getByRole('textbox', { name: /^Ile dokładasz/ }), '10');
    await user.click(refill.getByRole('textbox', { name: /^Notatka/ }));
    await user.paste('x'.repeat(501));

    await user.click(refill.getByRole('button', { name: 'Uzupełnij zapas' }));
    expect(await refill.findByText('Notatka może mieć najwyżej 500 znaków.')).toBeVisible();
    expect(await events(services)).toEqual([]);

    await user.clear(refill.getByRole('textbox', { name: /^Notatka/ }));
    await user.click(refill.getByRole('textbox', { name: /^Notatka/ }));
    await user.paste('x'.repeat(500));
    await user.click(refill.getByRole('button', { name: 'Uzupełnij zapas' }));
    await waitFor(async () => {
      expect(await events(services)).toHaveLength(1);
    });
  });

  it('a double click on the confirmation records one event', async () => {
    const user = userEvent.setup();
    const services = createTestServices();
    await seed(services, withStock(5));
    renderApp('/medications', services);
    const refill = await openRefillFromCard(user);
    await user.type(refill.getByRole('textbox', { name: /^Ile dokładasz/ }), '30');

    await user.dblClick(refill.getByRole('button', { name: 'Uzupełnij zapas' }));

    await waitFor(async () => {
      expect(await events(services)).toHaveLength(1);
    });
    await screen.findByText(/Uzupełniono zapas leku/);
    expect(await events(services)).toHaveLength(1);
  });

  it('a failed write keeps the dialog and what was typed, says why, and a retry records one event', async () => {
    const user = userEvent.setup();
    const services = createTestServices();
    await seed(services, withStock(5));
    renderApp('/medications', services);
    const refill = await openRefillFromCard(user);
    await user.type(refill.getByRole('textbox', { name: /^Ile dokładasz/ }), '30');
    await user.type(refill.getByRole('textbox', { name: /^Notatka/ }), 'Apteka');

    services.storage.failWrites(createQuotaError(), (key) => key === STORAGE_KEYS.stockEvents);
    await user.click(refill.getByRole('button', { name: 'Uzupełnij zapas' }));

    expect(await refill.findByRole('alert')).toHaveTextContent(
      'W pamięci przeglądarki brakuje miejsca. Zmiany nie zostały zapisane.',
    );
    expect(refill.getByRole('textbox', { name: /^Ile dokładasz/ })).toHaveValue('30');
    expect(refill.getByRole('textbox', { name: /^Notatka/ })).toHaveValue('Apteka');
    expect(screen.queryByText(/Uzupełniono zapas leku/)).not.toBeInTheDocument();
    expect(await events(services).catch(() => [])).toEqual([]);

    services.storage.heal();
    await user.click(refill.getByRole('button', { name: 'Uzupełnij zapas' }));
    await waitFor(async () => {
      expect(await events(services)).toHaveLength(1);
    });
    expect((await events(services))[0]?.id).toBe('test-id-1'); // the same id: it could not be recorded twice
  });

  it('keeps the dialog for a refill that cannot be recorded because the medication was deleted meanwhile', async () => {
    const user = userEvent.setup();
    const services = createTestServices();
    await seed(services, withStock(5));
    renderApp('/medications', services);
    const refill = await openRefillFromCard(user);
    await user.type(refill.getByRole('textbox', { name: /^Ile dokładasz/ }), '30');
    await services.repositories.medications.remove('m-1');

    await user.click(refill.getByRole('button', { name: 'Uzupełnij zapas' }));

    expect(await refill.findByRole('alert')).toHaveTextContent(
      'Rekord odwołuje się do leku, który nie istnieje.',
    );
    expect(await events(services)).toEqual([]);
  });

  it('does not convert units: a stock counted in another unit than the dose gets the refill in the stock unit', async () => {
    const user = userEvent.setup();
    const services = createTestServices();
    await seed(services, {
      id: 'm-1',
      name: 'Demoxal',
      doseUnit: 'kropla',
      stock: { quantity: 10, unit: 'ml', asOf: COUNTED },
    });
    renderApp('/medications', services);

    const refill = await openRefillFromCard(user);
    expect(refill.getByText(/W jednostce zapasu: ml/)).toBeVisible();
    expect(refill.queryByRole('combobox')).not.toBeInTheDocument(); // there is no unit to choose
    await user.type(refill.getByRole('textbox', { name: /^Ile dokładasz/ }), '5');
    await user.click(refill.getByRole('button', { name: 'Uzupełnij zapas' }));

    await waitFor(async () => {
      expect(await events(services)).toHaveLength(1);
    });
    expect((await events(services))[0]).toMatchObject({ amount: 5, unit: 'ml' });
    // The units still differ, so the estimate stays unavailable: nothing was converted.
    expect(
      await (await card('Demoxal')).findByText(/Szacunek niedostępny: jednostka zapasu różni się/),
    ).toBeVisible();
  });
});

describe('starting to track the stock (DEC-52)', () => {
  const open = async (user: ReturnType<typeof userEvent.setup>) => {
    await user.click(
      await screen.findByRole('button', { name: 'Zacznij śledzić zapas leku Demoxal' }),
    );
    return dialog();
  };
  const unknown = { id: 'm-1', name: 'Demoxal', stock: null };

  it('offers two explicit choices with no default, and creates nothing for neither', async () => {
    const user = userEvent.setup();
    const services = createTestServices();
    await seed(services, unknown);
    renderApp('/medications', services);

    const start = await open(user);
    expect(start.getByRole('radio', { name: /Policzyłem, ile mam teraz/ })).not.toBeChecked();
    expect(start.getByRole('radio', { name: /Zaczynam od nowego opakowania/ })).not.toBeChecked();
    await user.type(start.getByRole('textbox', { name: /^Ilość/ }), '10');
    await user.click(start.getByRole('button', { name: 'Zacznij śledzić zapas' }));

    expect(
      await start.findByText(
        /Wybierz, jak zaczynasz: policzyłem, ile mam, albo zaczynam od nowego opakowania/,
      ),
    ).toBeVisible();
    expect((await services.repositories.medications.get('m-1')).stock).toBeNull();
  });

  it('refuses an empty field and never stores it as zero; the estimate stays unavailable', async () => {
    const user = userEvent.setup();
    const services = createTestServices();
    await seed(services, unknown);
    renderApp('/medications', services);

    const start = await open(user);
    await user.click(start.getByRole('radio', { name: /Policzyłem, ile mam teraz/ }));
    await user.click(start.getByRole('button', { name: 'Zacznij śledzić zapas' }));

    expect(await start.findByText(/Puste pole nie oznacza zera/)).toBeVisible();
    expect((await services.repositories.medications.get('m-1')).stock).toBeNull();
    await user.click(start.getByRole('button', { name: 'Anuluj' }));
    expect(
      await (await card('Demoxal')).findByText('Szacunek niedostępny: zapas nie został policzony.'),
    ).toBeVisible();
  });

  it('counted: stores the typed quantity in the dose unit, as of now, with the basis "counted"', async () => {
    const user = userEvent.setup();
    const services = createTestServices();
    await seed(services, unknown);
    renderApp('/medications', services);

    const start = await open(user);
    await user.click(start.getByRole('radio', { name: /Policzyłem, ile mam teraz/ }));
    await user.type(start.getByRole('textbox', { name: /^Ile masz teraz/ }), '12,5');
    await user.click(start.getByRole('button', { name: 'Zacznij śledzić zapas' }));

    await waitFor(async () => {
      expect((await services.repositories.medications.get('m-1')).stock).not.toBeNull();
    });
    expect((await services.repositories.medications.get('m-1')).stock).toEqual({
      quantity: 12.5,
      unit: 'tabletka',
      asOf: NOW,
      basis: 'counted',
    });
    expect(
      await screen.findByText(/Zaczęto śledzić zapas leku „Demoxal”: policzono 12,5 tabletki/),
    ).toBeVisible();
    const demoxal = await card('Demoxal');
    expect(
      await demoxal.findByText(/Policzono 15 października 2026 12:00: 12,5 tabletki\./),
    ).toBeVisible();
    expect(demoxal.queryByText('od nowego opakowania')).not.toBeInTheDocument();
  });

  it('counted: a typed zero is a real count, shown as used up, not as unknown', async () => {
    const user = userEvent.setup();
    const services = createTestServices();
    await seed(services, unknown);
    renderApp('/medications', services);

    const start = await open(user);
    await user.click(start.getByRole('radio', { name: /Policzyłem, ile mam teraz/ }));
    await user.type(start.getByRole('textbox', { name: /^Ile masz teraz/ }), '0');
    await user.click(start.getByRole('button', { name: 'Zacznij śledzić zapas' }));

    expect(
      await (await card('Demoxal')).findByText(/Zapas wyczerpany \(0 tabletek\)/),
    ).toBeVisible();
    expect((await services.repositories.medications.get('m-1')).stock?.quantity).toBe(0);
  });

  it('new package: stores the size with the basis "new-package", and says what is not counted, wherever the number appears', async () => {
    const user = userEvent.setup();
    const services = createTestServices();
    await seed(services, unknown);
    renderApp('/medications', services);

    const start = await open(user);
    await user.click(start.getByRole('radio', { name: /Zaczynam od nowego opakowania/ }));
    await user.type(start.getByRole('textbox', { name: /^Ile jest w nowym opakowaniu/ }), '30');
    await user.click(start.getByRole('button', { name: 'Zacznij śledzić zapas' }));

    await waitFor(async () => {
      expect((await services.repositories.medications.get('m-1')).stock?.basis).toBe('new-package');
    });
    expect((await services.repositories.medications.get('m-1')).stock).toEqual({
      quantity: 30,
      unit: 'tabletka',
      asOf: NOW,
      basis: 'new-package',
    });
    const demoxal = await card('Demoxal');
    expect(
      await demoxal.findByText(
        'Liczone od nowego opakowania z 15 października 2026: 30 tabletek. Wcześniejszej pozostałości nie uwzględniamy, więc zapas może być większy.',
      ),
    ).toBeVisible();
    expect(demoxal.getByText('od nowego opakowania')).toBeVisible();
    expect(demoxal.queryByText(/Policzono/)).not.toBeInTheDocument();
  });

  it('new package: a size of zero is refused', async () => {
    const user = userEvent.setup();
    const services = createTestServices();
    await seed(services, unknown);
    renderApp('/medications', services);

    const start = await open(user);
    await user.click(start.getByRole('radio', { name: /Zaczynam od nowego opakowania/ }));
    await user.type(start.getByRole('textbox', { name: /^Ile jest w nowym opakowaniu/ }), '0');
    await user.click(start.getByRole('button', { name: 'Zacznij śledzić zapas' }));

    expect(await start.findByText('Nowe opakowanie musi zawierać więcej niż zero.')).toBeVisible();
    expect((await services.repositories.medications.get('m-1')).stock).toBeNull();
  });

  it('cancelling creates nothing', async () => {
    const user = userEvent.setup();
    const services = createTestServices();
    await seed(services, unknown);
    renderApp('/medications', services);

    const start = await open(user);
    await user.click(start.getByRole('radio', { name: /Policzyłem, ile mam teraz/ }));
    await user.type(start.getByRole('textbox', { name: /^Ile masz teraz/ }), '12');
    await user.click(start.getByRole('button', { name: 'Anuluj' }));

    expect((await services.repositories.medications.get('m-1')).stock).toBeNull();
  });

  it('a failed write keeps the dialog and the choice, and nothing is stored', async () => {
    const user = userEvent.setup();
    const services = createTestServices();
    await seed(services, unknown);
    renderApp('/medications', services);
    const start = await open(user);
    await user.click(start.getByRole('radio', { name: /Policzyłem, ile mam teraz/ }));
    await user.type(start.getByRole('textbox', { name: /^Ile masz teraz/ }), '12');

    services.storage.failWrites(createQuotaError(), (key) => key === STORAGE_KEYS.medications);
    await user.click(start.getByRole('button', { name: 'Zacznij śledzić zapas' }));

    expect(await start.findByRole('alert')).toHaveTextContent(
      'W pamięci przeglądarki brakuje miejsca',
    );
    expect(start.getByRole('radio', { name: /Policzyłem, ile mam teraz/ })).toBeChecked();
    expect(start.getByRole('textbox', { name: /^Ile masz teraz/ })).toHaveValue('12');
    services.storage.heal();
    expect((await services.repositories.medications.get('m-1')).stock).toBeNull();
  });

  it('a double click creates one baseline', async () => {
    const user = userEvent.setup();
    const services = createTestServices();
    await seed(services, unknown);
    renderApp('/medications', services);
    const start = await open(user);
    await user.click(start.getByRole('radio', { name: /Policzyłem, ile mam teraz/ }));
    await user.type(start.getByRole('textbox', { name: /^Ile masz teraz/ }), '12');

    await user.dblClick(start.getByRole('button', { name: 'Zacznij śledzić zapas' }));

    await screen.findByText(/Zaczęto śledzić zapas leku/);
    expect((await services.repositories.medications.get('m-1')).stock?.quantity).toBe(12);
  });
});

describe('the three stock states are worded differently on every screen', () => {
  const states = async () => {
    const services = createTestServices();
    await seed(
      services,
      withStock(40, {
        id: 'counted',
        name: 'Policzony',
        scheduleTimes: [scheduleTime('a', '08:00', 1)],
      }),
      withStock(40, {
        id: 'package',
        name: 'Z opakowania',
        scheduleTimes: [scheduleTime('b', '09:00', 1)],
        stock: { quantity: 40, unit: 'tabletka', asOf: COUNTED, basis: 'new-package' },
      }),
      {
        id: 'unknown',
        name: 'Nieznany',
        stock: null,
        scheduleTimes: [scheduleTime('c', '10:00', 1)],
      },
    );
    return services;
  };
  const countedText = /Policzono 1 października 2026 10:00: 40 tabletek\./;
  const packageText =
    'Liczone od nowego opakowania z 1 października 2026: 40 tabletek. Wcześniejszej pozostałości nie uwzględniamy, więc zapas może być większy.';

  it('on the medication card', async () => {
    renderApp('/medications', await states());

    expect(await (await card('Policzony')).findByText(countedText)).toBeVisible();
    const fresh = await card('Z opakowania');
    expect(fresh.getByText(packageText)).toBeVisible();
    expect(await fresh.findByText('od nowego opakowania')).toBeVisible();
    const none = await card('Nieznany');
    expect(none.getByText('Nie śledzisz zapasu.')).toBeVisible();
    expect(none.getByText('Szacunek niedostępny: zapas nie został policzony.')).toBeVisible();
    expect(none.queryByText(/Niski zapas|Pozostało|0 tabletek/)).not.toBeInTheDocument();
  });

  it('on the details page', async () => {
    const services = await states();
    renderApp('/medications/package', services);

    const stock = within(await screen.findByRole('region', { name: 'Zapas' }));
    expect(await stock.findByText(packageText)).toBeVisible();
    expect(await stock.findByText('od nowego opakowania')).toBeVisible();
    cleanup();

    renderApp('/medications/counted', services);
    expect(
      await within(await screen.findByRole('region', { name: 'Zapas' })).findByText(countedText),
    ).toBeVisible();
    cleanup();

    renderApp('/medications/unknown', services);
    const none = within(await screen.findByRole('region', { name: 'Zapas' }));
    expect(await none.findByText('Nie śledzisz zapasu.')).toBeVisible();
    expect(none.getByText('Szacunek niedostępny: zapas nie został policzony.')).toBeVisible();
    expect(none.queryByText(/Niski zapas|Pozostało|wyczerpany/)).not.toBeInTheDocument();
  });

  it('on the dashboard: the unknown one is not listed, and the label stays on the new package', async () => {
    renderApp('/', await states());

    const stock = within(await screen.findByRole('region', { name: 'Zapasy leków' }));
    expect(await stock.findByText(packageText)).toBeVisible();
    expect(stock.getByText(countedText)).toBeVisible();
    expect(stock.getByText('od nowego opakowania')).toBeVisible();
    expect(stock.queryByText('Nieznany')).not.toBeInTheDocument();
    expect(stock.getByText(/Dla 1 leku nie można policzyć szacunku/)).toBeVisible();
    expect(stock.queryByText(/Niski zapas/)).not.toBeInTheDocument();
  });

  it('on the day view', async () => {
    renderApp('/doses', await states());

    const stock = within(await screen.findByRole('region', { name: /Szacunkowy zapas/ }));
    expect(await stock.findByText(packageText)).toBeVisible();
    expect(stock.getByText(countedText)).toBeVisible();
    expect(stock.getByText('od nowego opakowania')).toBeVisible();
    expect(stock.getByText('Nie śledzisz zapasu.')).toBeVisible();
    expect(stock.getByText('Szacunek niedostępny: zapas nie został policzony.')).toBeVisible();
  });

  it('a low-stock warning on a new package says it ignores what was left before', async () => {
    const services = createTestServices();
    await seed(services, {
      id: 'm-1',
      name: 'Demoxal',
      stock: { quantity: 3, unit: 'tabletka', asOf: COUNTED, basis: 'new-package' },
    });
    renderApp('/medications', services);

    const demoxal = await card('Demoxal');
    expect(await demoxal.findByText('Niski zapas')).toBeVisible();
    expect(
      demoxal.getByText(
        'To ostrzeżenie dotyczy liczenia od nowego opakowania, bez wcześniejszej pozostałości.',
      ),
    ).toBeVisible();
  });

  it('editing the stock quantity in the medication form is a count: the new-package label goes', async () => {
    const user = userEvent.setup();
    const services = createTestServices();
    await seed(services, {
      id: 'm-1',
      name: 'Demoxal',
      stock: { quantity: 30, unit: 'tabletka', asOf: COUNTED, basis: 'new-package' },
    });
    renderApp('/medications/m-1/edit', services);
    await screen.findByRole('heading', { level: 1, name: 'Edytuj lek' });

    await user.clear(screen.getByRole('textbox', { name: 'Aktualny zapas' }));
    await user.type(screen.getByRole('textbox', { name: 'Aktualny zapas' }), '12');
    await user.click(screen.getByRole('button', { name: 'Zapisz zmiany' }));

    await waitFor(async () => {
      expect((await services.repositories.medications.get('m-1')).stock?.quantity).toBe(12);
    });
    const stock = (await services.repositories.medications.get('m-1')).stock;
    expect(stock).toEqual({ quantity: 12, unit: 'tabletka', asOf: NOW });
    expect(stock && 'basis' in stock).toBe(false);
  });

  it('saving the form without touching the stock keeps its basis and its moment', async () => {
    const user = userEvent.setup();
    const services = createTestServices();
    const stock = { quantity: 30, unit: 'tabletka', asOf: COUNTED, basis: 'new-package' as const };
    await seed(services, { id: 'm-1', name: 'Demoxal', stock });
    renderApp('/medications/m-1/edit', services);
    await screen.findByRole('heading', { level: 1, name: 'Edytuj lek' });

    await user.type(screen.getByRole('textbox', { name: /^Notatki/ }), 'x');
    await user.click(screen.getByRole('button', { name: 'Zapisz zmiany' }));

    await waitFor(async () => {
      expect((await services.repositories.medications.get('m-1')).notes).toBe('x');
    });
    expect((await services.repositories.medications.get('m-1')).stock).toEqual(stock);
  });
});

describe('the details page: the history of stock events', () => {
  const seedHistory = async () => {
    const services = createTestServices();
    await seed(services, withStock(10));
    await services.repositories.stockEvents.append(
      eventFor({
        id: 'old',
        recordedAt: asTimestamp('2026-09-20T08:00:00Z'),
        amount: 15,
        note: 'Przed liczeniem',
      }),
    );
    await services.repositories.stockEvents.append(
      eventFor({
        id: 'new',
        recordedAt: asTimestamp('2026-10-10T08:00:00Z'),
        amount: 20,
        note: 'Z apteki',
      }),
    );
    await services.repositories.stockEvents.append(
      eventFor({
        id: 'gone',
        recordedAt: asTimestamp('2026-10-11T08:00:00Z'),
        amount: 7,
        reversedAt: asTimestamp('2026-10-11T08:10:00Z'),
        note: 'Pomyłka',
      }),
    );
    return services;
  };
  const history = async () =>
    within(await screen.findByRole('region', { name: 'Historia zdarzeń zapasu' }));

  it('lists the events newest first with their notes, and says in words which count and which do not', async () => {
    renderApp('/medications/m-1', await seedHistory());

    const list = await history();
    const rows = (await list.findAllByRole('listitem')).map((item) => item.textContent);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toContain('Uzupełnienie: dodano 7 tabletek');
    expect(rows[0]).toContain('Cofnięte');
    expect(rows[0]).toContain('Pomyłka');
    expect(rows[1]).toContain('Uzupełnienie: dodano 20 tabletek');
    expect(rows[1]).toContain('Wliczone w szacunek');
    expect(rows[1]).toContain('Z apteki');
    expect(rows[2]).toContain('Uzupełnienie: dodano 15 tabletek');
    expect(rows[2]).toContain('Sprzed ostatniego liczenia, nie wlicza się');
  });

  it('shows the estimate with the counted events only: 10 + 20, not the reversed 7 and not the one before the count', async () => {
    renderApp('/medications/m-1', await seedHistory());

    const stock = within(await screen.findByRole('region', { name: 'Zapas' }));
    expect(await stock.findByText(/Pozostało ok\. 30 tabletek/)).toBeVisible();
  });

  it('says there are no events when there are none', async () => {
    const services = createTestServices();
    await seed(services, withStock(10));
    renderApp('/medications/m-1', services);

    expect(await (await history()).findByText(/Brak zdarzeń zapasu/)).toBeVisible();
  });

  it('refills from the page: the event appears in the history and the estimate follows', async () => {
    const user = userEvent.setup();
    const services = createTestServices();
    await seed(services, withStock(10));
    renderApp('/medications/m-1', services);

    await user.click(await screen.findByRole('button', { name: 'Uzupełnij zapas' }));
    const refill = dialog();
    await user.type(refill.getByRole('textbox', { name: /^Ile dokładasz/ }), '5,5');
    await user.click(refill.getByRole('button', { name: 'Uzupełnij zapas' }));

    const list = await history();
    expect(await list.findByText('Uzupełnienie: dodano 5,5 tabletki')).toBeVisible();
    expect(
      await within(screen.getByRole('region', { name: 'Zapas' })).findByText(
        /Pozostało ok\. 15,5 tabletki/,
      ),
    ).toBeVisible();
  });

  it('reverses an event after a confirmation: it stays in the history, and stops counting', async () => {
    const user = userEvent.setup();
    const services = createTestServices();
    await seed(services, withStock(10));
    await services.repositories.stockEvents.append(
      eventFor({ id: 'new', recordedAt: asTimestamp('2026-10-10T08:00:00Z'), amount: 20 }),
    );
    renderApp('/medications/m-1', services);
    expect(
      await within(await screen.findByRole('region', { name: 'Zapas' })).findByText(
        /Pozostało ok\. 30 tabletek/,
      ),
    ).toBeVisible();

    await user.click(
      await screen.findByRole('button', { name: /^Cofnij: Uzupełnienie: dodano 20 tabletek/ }),
    );
    const confirm = dialog();
    expect((await services.repositories.stockEvents.list())[0]?.reversedAt).toBeNull(); // nothing yet
    await user.click(confirm.getByRole('button', { name: 'Cofnij zdarzenie' }));

    await waitFor(async () => {
      expect((await services.repositories.stockEvents.list())[0]?.reversedAt).toBe(NOW);
    });
    const list = await history();
    expect(await list.findByText(/Cofnięto 15 października 2026 12:00/)).toBeVisible();
    expect(list.queryByRole('button', { name: /^Cofnij:/ })).not.toBeInTheDocument();
    expect(
      await within(screen.getByRole('region', { name: 'Zapas' })).findByText(
        /Pozostało ok\. 10 tabletek/,
      ),
    ).toBeVisible();
    expect(await services.repositories.stockEvents.list()).toHaveLength(1);
  });

  it('cancelling the reversal changes nothing', async () => {
    const user = userEvent.setup();
    const services = createTestServices();
    await seed(services, withStock(10));
    await services.repositories.stockEvents.append(
      eventFor({ id: 'new', recordedAt: asTimestamp('2026-10-10T08:00:00Z') }),
    );
    renderApp('/medications/m-1', services);

    await user.click(await screen.findByRole('button', { name: /^Cofnij: Uzupełnienie/ }));
    await user.click(dialog().getByRole('button', { name: 'Anuluj' }));

    expect((await services.repositories.stockEvents.list())[0]?.reversedAt).toBeNull();
  });

  it('a failed reversal keeps the dialog, says why, and changes nothing', async () => {
    const user = userEvent.setup();
    const services = createTestServices();
    await seed(services, withStock(10));
    await services.repositories.stockEvents.append(
      eventFor({ id: 'new', recordedAt: asTimestamp('2026-10-10T08:00:00Z') }),
    );
    renderApp('/medications/m-1', services);
    await user.click(await screen.findByRole('button', { name: /^Cofnij: Uzupełnienie/ }));

    services.storage.failWrites(createQuotaError(), (key) => key === STORAGE_KEYS.stockEvents);
    await user.click(dialog().getByRole('button', { name: 'Cofnij zdarzenie' }));

    expect(await dialog().findByRole('alert')).toHaveTextContent(
      'W pamięci przeglądarki brakuje miejsca',
    );
    services.storage.heal();
    expect((await services.repositories.stockEvents.list())[0]?.reversedAt).toBeNull();
  });

  it('counting the stock again in the form makes the earlier events historical, and the history says so', async () => {
    const user = userEvent.setup();
    const services = createTestServices();
    await seed(services, withStock(10));
    await services.repositories.stockEvents.append(
      eventFor({ id: 'new', recordedAt: asTimestamp('2026-10-10T08:00:00Z'), amount: 20 }),
    );
    renderApp('/medications/m-1/edit', services);
    await screen.findByRole('heading', { level: 1, name: 'Edytuj lek' });
    await user.clear(screen.getByRole('textbox', { name: 'Aktualny zapas' }));
    await user.type(screen.getByRole('textbox', { name: 'Aktualny zapas' }), '12');
    await user.click(screen.getByRole('button', { name: 'Zapisz zmiany' }));
    await waitFor(async () => {
      expect((await services.repositories.medications.get('m-1')).stock?.quantity).toBe(12);
    });
    cleanup();

    renderApp('/medications/m-1', services);

    const list = await history();
    expect(await list.findByText('Sprzed ostatniego liczenia, nie wlicza się')).toBeVisible();
    expect(
      await within(screen.getByRole('region', { name: 'Zapas' })).findByText(
        /Pozostało ok\. 12 tabletek/,
      ),
    ).toBeVisible();
  });

  it('does not offer a refill for an ended medication, and says why', async () => {
    const services = createTestServices();
    await seed(services, withStock(10, { endDate: asLocalDate('2026-10-01') }));
    renderApp('/medications/m-1', services);

    const stock = within(await screen.findByRole('region', { name: 'Zapas' }));
    expect(
      await stock.findByText('Lek jest zakończony, więc nie uzupełniamy jego zapasu.'),
    ).toBeVisible();
    expect(stock.queryByRole('button', { name: 'Uzupełnij zapas' })).not.toBeInTheDocument();
  });

  it('a medication without a stock offers to start tracking, and explains why a refill is not offered', async () => {
    const services = createTestServices();
    await seed(services, { id: 'm-1', name: 'Demoxal', stock: null });
    renderApp('/medications/m-1', services);

    const stock = within(await screen.findByRole('region', { name: 'Zapas' }));
    expect(await stock.findByRole('button', { name: 'Zacznij śledzić zapas' })).toBeVisible();
    expect(stock.queryByRole('button', { name: 'Uzupełnij zapas' })).not.toBeInTheDocument();
    expect(stock.getByText(/Uzupełnienie wymaga policzonego zapasu/)).toBeVisible();
  });

  it('says so, with an alert, when the events cannot be read, instead of showing an empty history', async () => {
    const services = createTestServices();
    await seed(services, withStock(10));
    services.repositories.stockEvents.list = () => Promise.reject(new Error('boom'));
    renderApp('/medications/m-1', services);

    expect(
      await screen.findByText(
        'Nie udało się wczytać historii zdarzeń zapasu. Odśwież stronę i spróbuj ponownie.',
      ),
    ).toBeVisible();
    expect(screen.queryByText(/Brak zdarzeń zapasu/)).not.toBeInTheDocument();
  });

  it('says that the sum of the changes went below zero when it did', async () => {
    const services = createTestServices();
    await seed(services, withStock(2));
    await services.repositories.stockEvents.append(
      eventFor({
        id: 'waste',
        kind: 'waste',
        amount: 5,
        recordedAt: asTimestamp('2026-10-10T08:00:00Z'),
      }),
    );
    renderApp('/medications/m-1', services);

    expect(
      await screen.findByText(/zapas mógł skończyć się wcześniej, niż pokazuje szacunek/),
    ).toBeVisible();
    expect(await screen.findByText(/Zapas wyczerpany \(0 tabletek\)/)).toBeVisible();
  });
});

describe('the refill action on the dashboard stock panel', () => {
  it('is on every listed row, records the event, and the row, the line and the warning are recomputed', async () => {
    const user = userEvent.setup();
    const services = createTestServices();
    await seed(services, withStock(5));
    renderApp('/', services);

    const stock = within(await screen.findByRole('region', { name: 'Zapasy leków' }));
    expect(await stock.findByText(/^Niski zapas: 1 lek\./)).toBeVisible();
    await user.click(stock.getByRole('button', { name: 'Uzupełnij zapas leku Demoxal' }));
    const refill = dialog();
    await user.type(refill.getByRole('textbox', { name: /^Ile dokładasz/ }), '30');
    await user.click(refill.getByRole('button', { name: 'Uzupełnij zapas' }));

    expect(
      await stock.findByText('Uzupełniono zapas leku „Demoxal”: dodano 30 tabletek.'),
    ).toBeVisible();
    expect(await stock.findByText(/Pozostało ok\. 35 tabletek/)).toBeVisible();
    expect(stock.queryByText(/^Niski zapas/)).not.toBeInTheDocument();
    expect(await events(services)).toHaveLength(1);
  });

  it('keeps the own threshold working: a refill below the threshold keeps the warning, above it removes it', async () => {
    const user = userEvent.setup();
    const services = createTestServices();
    await seed(services, withStock(40, { lowStockThreshold: { quantity: 50, unit: 'tabletka' } }));
    renderApp('/', services);
    const stock = within(await screen.findByRole('region', { name: 'Zapasy leków' }));
    expect(
      await stock.findByText(/Zapas jest na poziomie Twojego progu \(50 tabletek\)/),
    ).toBeVisible();

    await user.click(stock.getByRole('button', { name: 'Uzupełnij zapas leku Demoxal' }));
    await user.type(dialog().getByRole('textbox', { name: /^Ile dokładasz/ }), '10');
    await user.click(dialog().getByRole('button', { name: 'Uzupełnij zapas' }));
    // 40 + 10 = 50: exactly at the threshold, still low.
    expect(await stock.findByText(/Pozostało ok\. 50 tabletek/)).toBeVisible();
    expect(stock.getByText(/Zapas jest na poziomie Twojego progu/)).toBeVisible();

    await user.click(stock.getByRole('button', { name: 'Uzupełnij zapas leku Demoxal' }));
    await user.type(dialog().getByRole('textbox', { name: /^Ile dokładasz/ }), '0,001');
    await user.click(dialog().getByRole('button', { name: 'Uzupełnij zapas' }));
    expect(await stock.findByText(/Pozostało ok\. 50,001 tabletki/)).toBeVisible();
    expect(stock.queryByText(/Twojego progu/)).not.toBeInTheDocument();
    expect(stock.queryByText(/^Niski zapas/)).not.toBeInTheDocument();
  });

  it('shows no refill action for a medication that is not listed (no estimate)', async () => {
    const services = createTestServices();
    await seed(services, { id: 'm-1', name: 'Demoxal', stock: null });
    renderApp('/', services);

    const stock = within(await screen.findByRole('region', { name: 'Zapasy leków' }));
    await stock.findByText(/Nie można jeszcze oszacować zapasu/);
    expect(stock.queryByRole('button', { name: /Uzupełnij zapas/ })).not.toBeInTheDocument();
  });

  it('counts the events in the estimate of the dashboard, the day view and the card the same way', async () => {
    const services = createTestServices();
    await seed(services, withStock(10));
    await services.repositories.stockEvents.append(
      eventFor({ id: 'a', recordedAt: asTimestamp('2026-10-10T08:00:00Z'), amount: 20 }),
    );

    for (const path of ['/', '/doses', '/medications']) {
      renderApp(path, services);
      expect(
        await screen.findByText(/Pozostało ok\. 30 tabletek, wystarczy na ok\. 30 dni/),
      ).toBeVisible();
      cleanup();
    }
  });
});

describe('deleting a medication with stock events', () => {
  it('states the events among the consequences, and deletes them with the medication', async () => {
    const user = userEvent.setup();
    const services = createTestServices();
    await seed(services, withStock(10), withStock(10, { id: 'm-2', name: 'Inny' }));
    await services.repositories.stockEvents.append(eventFor({ id: 'a' }));
    await services.repositories.stockEvents.append(eventFor({ id: 'b' }));
    await services.repositories.stockEvents.append(eventFor({ id: 'c', medicationId: 'm-2' }));
    renderApp('/medications', services);

    await user.click(await screen.findByRole('button', { name: 'Usuń trwale… lek Demoxal' }));
    const confirm = dialog();
    expect(await confirm.findByText(/oraz historia zapasu:/)).toBeVisible();
    expect(confirm.getByText('2 zdarzenia')).toBeVisible();
    await user.click(confirm.getByRole('button', { name: 'Usuń trwale' }));

    expect(
      await screen.findByText(/Usunięto lek „Demoxal” razem z historią zapasu \(2 zdarzenia\)/),
    ).toBeVisible();
    expect((await events(services)).map((event) => event.id)).toEqual(['c']);
  });

  it('says nothing about events when the medication has none', async () => {
    const user = userEvent.setup();
    const services = createTestServices();
    await seed(services, withStock(10));
    renderApp('/medications', services);

    await user.click(await screen.findByRole('button', { name: 'Usuń trwale… lek Demoxal' }));

    expect(dialog().queryByText(/historia zapasu/)).not.toBeInTheDocument();
  });
});
