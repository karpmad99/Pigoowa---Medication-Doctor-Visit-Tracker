import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it } from 'vitest';
import { ServicesProvider } from '@/app/ServicesProvider';
import { routes } from '@/app/routes';
import { RepositoryError } from '@/services/errors';
import { makeDoseLog, makeMedication, scheduleTime } from '@/test/fixtures';
import { createTestServices } from '@/test/services';
import { asLocalDate, asTimestamp } from '@/utils/date';

// The test clock says 12:00 on 15 October 2026 in Warsaw.

type Services = ReturnType<typeof createTestServices>;

function renderApp(path: string, services: Services = createTestServices()) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(
    <ServicesProvider services={services}>
      <RouterProvider router={router} />
    </ServicesProvider>,
  );
  return { router, services };
}

const counted = asTimestamp('2026-10-01T08:00:00Z');

async function seed(overrides: Parameters<typeof makeMedication>[0] = {}) {
  const services = createTestServices();
  await services.repositories.medications.create(
    makeMedication({
      id: 'm-1',
      name: 'Demoxal',
      notes: 'Po jedzeniu',
      startDate: asLocalDate('2026-01-01'),
      scheduleEffectiveFrom: asLocalDate('2026-03-01'),
      scheduleTimes: [scheduleTime('t-1', '08:00', 1), scheduleTime('t-2', '20:00', 0.5)],
      stock: { quantity: 28, unit: 'tabletka', asOf: counted },
      ...overrides,
    }),
  );
  return services;
}

const part = (name: string) => within(screen.getByRole('region', { name }));
const heading = (name: string) => screen.findByRole('heading', { level: 1, name });

describe('medication details: what it shows', () => {
  it('shows the form, the strength, the schedule, the units and the stock of a medication', async () => {
    const services = await seed({
      dosageForm: 'tablet',
      strength: { value: 500, unit: 'mg' },
      lowStockThreshold: { quantity: 10, unit: 'tabletka' },
    });
    renderApp('/medications/m-1', services);
    await heading('Demoxal');

    expect(part('Informacje').getByText('Aktywny')).toBeVisible();
    expect(part('Informacje').getByText('Tabletki')).toBeVisible();
    expect(part('Informacje').getByText(/^500 mg/)).toBeVisible();
    expect(part('Informacje').getByText(/nie wpływa na dawkę ani na zapas/)).toBeVisible();
    expect(part('Informacje').getByText('Po jedzeniu')).toBeVisible();
    expect(part('Informacje').getByText(/Od 1 stycznia 2026, bez daty zakończenia/)).toBeVisible();
    expect(part('Dawkowanie').getByText('08:00 — 1 tabletka')).toBeVisible();
    expect(part('Dawkowanie').getByText('20:00 — 0,5 tabletki')).toBeVisible();
    expect(part('Dawkowanie').getByText(/obowiązuje od 1 marca 2026/)).toBeVisible();
    expect(part('Jednostki').getByText('Jednostka dawki')).toBeVisible();
    expect(
      part('Zapas').getByText(/Policzono 1 października 2026 10:00: 28 tabletek/),
    ).toBeVisible();
    expect(
      await part('Zapas').findByText(/Pozostało ok\. 28 tabletek, wystarczy na ok\. 18 dni/),
    ).toBeVisible();
    expect(
      part('Zapas').getByText(
        /Własny próg: 10 tabletek\. Ostrzegamy, gdy szacowany zapas jest na poziomie progu lub poniżej/,
      ),
    ).toBeVisible();
  });

  it('says plainly what is missing for an older medication: no form, no strength, no threshold, no stock', async () => {
    const services = await seed({ stock: null, notes: null });
    renderApp('/medications/m-1', services);
    await heading('Demoxal');

    expect(part('Informacje').getByText('Nie wybrano')).toBeVisible();
    expect(part('Informacje').getByText('Nie podano')).toBeVisible();
    expect(part('Informacje').getByText('Brak notatek')).toBeVisible();
    expect(part('Jednostki').getByText('Nie śledzisz zapasu')).toBeVisible();
    expect(part('Zapas').queryByText(/Policzono/)).not.toBeInTheDocument();
    expect(
      part('Zapas').getByText(/Szacunek niedostępny: zapas nie został policzony/),
    ).toBeVisible();
    expect(
      part('Zapas').getByText(
        /Nie ustawiono własnego progu\. Ostrzegamy, gdy zapasu wystarczy na mniej niż 7 dni/,
      ),
    ).toBeVisible();
    expect(screen.queryByText('Niski zapas')).not.toBeInTheDocument();
  });

  it('says the schedule is empty when there are no times', async () => {
    const services = await seed({ scheduleTimes: [] });
    renderApp('/medications/m-1', services);
    await heading('Demoxal');

    expect(part('Dawkowanie').getByText('Brak harmonogramu.')).toBeVisible();
  });

  it('shows an ended medication as ended, with its end date, and no estimate', async () => {
    const services = await seed({ endDate: asLocalDate('2026-10-10') });
    renderApp('/medications/m-1', services);
    await heading('Demoxal');

    expect(part('Informacje').getByText('Zakończony')).toBeVisible();
    expect(part('Informacje').getByText(/do 10 października 2026/)).toBeVisible();
    expect(
      await part('Zapas').findByText(/Szacunek niedostępny: lek został zakończony/),
    ).toBeVisible();
  });

  it('shows a unit that is not on the list of its form neutrally, as stored, and does not change it', async () => {
    const services = await seed({
      dosageForm: 'inhaler',
      doseUnit: 'inhalacja',
      stock: { quantity: 4, unit: 'opakowanie', asOf: counted },
    });
    renderApp('/medications/m-1', services);
    await heading('Demoxal');

    expect(part('Jednostki').getAllByText('Jednostka spoza listy')).toHaveLength(2);
    expect(part('Jednostki').getByText('inhalacja')).toBeVisible();
    expect(part('Jednostki').getByText('opakowanie')).toBeVisible();
    expect(part('Jednostki').getByText(/Zostaje bez zmian i nie jest przeliczana/)).toBeVisible();
    expect(part('Dawkowanie').getByText('08:00 — 1 inhalacja')).toBeVisible();
  });
});

describe('medication details: the warning', () => {
  it('warns at the own threshold and says why, in words', async () => {
    const services = await seed({ lowStockThreshold: { quantity: 28, unit: 'tabletka' } });
    renderApp('/medications/m-1', services);
    await heading('Demoxal');

    expect(await part('Zapas').findByText('Niski zapas')).toBeVisible();
    expect(
      part('Zapas').getByText(/Zapas jest na poziomie Twojego progu \(28 tabletek\) lub poniżej/),
    ).toBeVisible();
  });

  it('does not warn just above the threshold', async () => {
    const services = await seed({ lowStockThreshold: { quantity: 27.999, unit: 'tabletka' } });
    renderApp('/medications/m-1', services);
    await heading('Demoxal');

    await part('Zapas').findByText(/Pozostało ok\. 28 tabletek/);
    expect(screen.queryByText('Niski zapas')).not.toBeInTheDocument();
  });

  it('uses the 7-day rule without a threshold', async () => {
    const services = await seed({ stock: { quantity: 3, unit: 'tabletka', asOf: counted } });
    renderApp('/medications/m-1', services);
    await heading('Demoxal');

    expect(await part('Zapas').findByText('Niski zapas')).toBeVisible();
    expect(screen.queryByText(/Twojego progu/)).not.toBeInTheDocument();
  });

  it('says that a threshold in another unit is not applied, and uses the 7-day rule instead', async () => {
    const services = await seed({
      stock: { quantity: 40, unit: 'tabletka', asOf: counted },
      lowStockThreshold: { quantity: 100, unit: 'ml' },
    });
    renderApp('/medications/m-1', services);
    await heading('Demoxal');

    expect(
      part('Zapas').getByText(
        /Własny próg \(100 ml\) jest w innej jednostce niż zapas \(tabletka\), więc nie jest stosowany\. Nie przeliczamy jednostek: obowiązuje reguła „mniej niż 7 dni”/,
      ),
    ).toBeVisible();
    await part('Zapas').findByText(/Pozostało ok\. 40 tabletek/);
    expect(screen.queryByText('Niski zapas')).not.toBeInTheDocument();
  });

  it('never calls an estimate that cannot be computed low, and says why it cannot', async () => {
    const services = await seed({
      doseUnit: 'tabletka',
      stock: { quantity: 1, unit: 'ml', asOf: counted },
      lowStockThreshold: { quantity: 50, unit: 'ml' },
    });
    renderApp('/medications/m-1', services);
    await heading('Demoxal');

    expect(
      await part('Zapas').findByText(
        /Szacunek niedostępny: jednostka zapasu różni się od jednostki dawki/,
      ),
    ).toBeVisible();
    expect(screen.queryByText('Niski zapas')).not.toBeInTheDocument();
  });

  it('counts the taken doses recorded since the stock was counted', async () => {
    const services = await seed({
      stock: { quantity: 10, unit: 'tabletka', asOf: counted },
      lowStockThreshold: { quantity: 8, unit: 'tabletka' },
    });
    await services.repositories.doseLogs.upsert(
      makeDoseLog({
        id: 'l-1',
        medicationId: 'm-1',
        scheduledDate: asLocalDate('2026-10-10'),
        doseAmount: 2,
        recordedAt: asTimestamp('2026-10-10T08:00:00Z'),
      }),
    );
    renderApp('/medications/m-1', services);
    await heading('Demoxal');

    // 10 - 2 = 8, which is AT the threshold of 8.
    expect(await part('Zapas').findByText(/Pozostało ok\. 8 tabletek/)).toBeVisible();
    expect(part('Zapas').getByText('Niski zapas')).toBeVisible();
  });
});

describe('medication details: navigation and states', () => {
  it('has a way back to the list and a way to the edit form', async () => {
    const user = userEvent.setup();
    const services = await seed();
    const { router } = renderApp('/medications/m-1', services);
    await heading('Demoxal');

    expect(screen.getByRole('link', { name: 'Edytuj lek' })).toHaveAttribute(
      'href',
      '/medications/m-1/edit',
    );
    expect(screen.getByRole('link', { name: 'Edytuj zapas i próg' })).toHaveAttribute(
      'href',
      '/medications/m-1/edit',
    );
    await user.click(screen.getByRole('link', { name: /Wróć do listy leków/ }));

    expect(router.state.location.pathname).toBe('/medications');
  });

  it('is reached from the list, with a name that says which medication it is', async () => {
    const user = userEvent.setup();
    const services = await seed();
    const { router } = renderApp('/medications', services);

    await user.click(await screen.findByRole('link', { name: 'Szczegóły leku Demoxal' }));

    expect(router.state.location.pathname).toBe('/medications/m-1');
    expect(await heading('Demoxal')).toBeVisible();
  });

  it('says that the medication does not exist, and leads back to the list', async () => {
    renderApp('/medications/nie-ma');

    expect(await screen.findByText('Nie znaleziono leku')).toBeVisible();
    expect(screen.getAllByRole('link', { name: /Wróć do listy leków/ }).length).toBeGreaterThan(0);
  });

  it('shows an error with a retry when the medication cannot be read, and then the page', async () => {
    const user = userEvent.setup();
    const services = await seed();
    let fail = true;
    const original = services.repositories.medications.get.bind(services.repositories.medications);
    services.repositories.medications.get = (id) =>
      fail ? Promise.reject(new RepositoryError('storage-unavailable')) : original(id);
    renderApp('/medications/m-1', services);

    expect(await screen.findByText('Nie udało się wczytać leku')).toBeVisible();
    fail = false;
    await user.click(screen.getByRole('button', { name: /Spróbuj ponownie/ }));

    expect(await heading('Demoxal')).toBeVisible();
  });

  it('shows the medication but says the estimate cannot be computed when the intake records cannot be read', async () => {
    const services = await seed();
    services.repositories.doseLogs.listByDateRange = () =>
      Promise.reject(new RepositoryError('storage-unavailable'));
    renderApp('/medications/m-1', services);
    await heading('Demoxal');

    expect(
      await part('Zapas').findByText(/nie udało się wczytać historii przyjmowania/),
    ).toBeVisible();
    expect(screen.queryByText('Niski zapas')).not.toBeInTheDocument();
  });
});
