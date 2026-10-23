import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it } from 'vitest';
import { ServicesProvider } from '@/app/ServicesProvider';
import { routes } from '@/app/routes';
import { isLowStock, estimateStock } from '@/features/medications/logic/stock';
import { makeMedication, scheduleTime } from '@/test/fixtures';
import { createTestServices } from '@/test/services';
import { asLocalDate, asTimestamp } from '@/utils/date';

// F5: the own low-stock threshold in the medication form. The test clock says 12:00 on 15 October
// 2026 in Warsaw.

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

const text = (name: string | RegExp) => screen.getByRole('textbox', { name });
const select = (name: string | RegExp) => screen.getByRole('combobox', { name });
const submit = (label: string) => screen.getByRole('button', { name: label });
const counted = asTimestamp('2026-09-01T08:00:00Z');
const today = asLocalDate('2026-10-15');

async function seed(overrides: Parameters<typeof makeMedication>[0] = {}) {
  const services = createTestServices();
  await services.repositories.medications.create(
    makeMedication({
      id: 'm-1',
      name: 'Demoxal',
      startDate: asLocalDate('2026-01-01'),
      scheduleEffectiveFrom: asLocalDate('2026-01-01'),
      scheduleTimes: [scheduleTime('t-1', '08:00', 1)],
      stock: { quantity: 28, unit: 'tabletka', asOf: counted },
      ...overrides,
    }),
  );
  return services;
}

const threshold = () => text(/^Własny próg niskiego zapasu/);

describe('add medication: the own threshold', () => {
  async function fillBasics(user: ReturnType<typeof userEvent.setup>) {
    await screen.findByRole('heading', { level: 1, name: 'Dodaj lek' });
    await user.type(text('Nazwa leku'), 'Demoxal');
    await user.type(text(/^Jednostka dawki/), 'tabletka');
    fireEvent.change(screen.getByLabelText(/^Godzina 1/), { target: { value: '08:00' } });
    await user.type(text(/^Dawka 1/), '1');
  }

  it('is empty and optional by default, and a medication saved without it has none', async () => {
    const user = userEvent.setup();
    const { services } = renderApp('/medications/new');
    await fillBasics(user);
    await user.type(text('Aktualny zapas'), '30');

    expect(threshold()).toHaveValue('');
    await user.click(submit('Dodaj lek'));

    await waitFor(async () => {
      expect(await services.repositories.medications.list()).toHaveLength(1);
    });
    const [saved] = await services.repositories.medications.list();
    expect(saved && 'lowStockThreshold' in saved).toBe(false);
  });

  it('stores the threshold with the unit the stock is saved in, and reads it back when editing', async () => {
    const user = userEvent.setup();
    const { services } = renderApp('/medications/new');
    await fillBasics(user);
    await user.type(text('Aktualny zapas'), '30');
    await user.type(threshold(), '5,5');
    await user.click(submit('Dodaj lek'));

    await waitFor(async () => {
      expect(await services.repositories.medications.list()).toHaveLength(1);
    });
    const [saved] = await services.repositories.medications.list();
    expect(saved?.lowStockThreshold).toEqual({ quantity: 5.5, unit: 'tabletka' });
    cleanup();

    renderApp(`/medications/${saved?.id ?? ''}/edit`, services);
    await screen.findByRole('heading', { level: 1, name: 'Edytuj lek' });
    expect(threshold()).toHaveValue('5,5');
  });

  it('says the unit the threshold is counted in, and the rule that applies without one', async () => {
    renderApp('/medications/new');
    await screen.findByRole('heading', { level: 1, name: 'Dodaj lek' });

    expect(threshold()).toHaveAccessibleDescription(
      expect.stringContaining('równy progowi lub mniejszy'),
    );
    expect(threshold()).toHaveAccessibleDescription(expect.stringContaining('mniej niż 7 dni'));
  });

  it('refuses a threshold without a stock, and says why', async () => {
    const user = userEvent.setup();
    const { services } = renderApp('/medications/new');
    await fillBasics(user);
    await user.type(threshold(), '5');

    await user.click(submit('Dodaj lek'));

    expect(
      await screen.findByText('Próg dotyczy zapasu. Wpisz najpierw aktualny zapas albo usuń próg.'),
    ).toBeVisible();
    expect(threshold()).toBeInvalid();
    expect(await services.repositories.medications.list()).toEqual([]);
  });

  it.each(['-1', 'abc', '1,2345'])('refuses the threshold "%s"', async (value) => {
    const user = userEvent.setup();
    renderApp('/medications/new');
    await fillBasics(user);
    await user.type(text('Aktualny zapas'), '30');
    await user.type(threshold(), value);

    await user.click(submit('Dodaj lek'));

    expect(
      await screen.findByText(/Wpisz próg jako liczbę równą lub większą od zera/),
    ).toBeVisible();
  });

  it('accepts a threshold of zero and keeps it (it warns only when the stock is used up)', async () => {
    const user = userEvent.setup();
    const { services } = renderApp('/medications/new');
    await fillBasics(user);
    await user.type(text('Aktualny zapas'), '30');
    await user.type(threshold(), '0');
    await user.click(submit('Dodaj lek'));

    await waitFor(async () => {
      expect(await services.repositories.medications.list()).toHaveLength(1);
    });
    expect((await services.repositories.medications.list())[0]?.lowStockThreshold).toEqual({
      quantity: 0,
      unit: 'tabletka',
    });
  });

  it('is counted in the stock unit that was chosen, never converted from the dose unit', async () => {
    const user = userEvent.setup();
    const { services } = renderApp('/medications/new');
    await screen.findByRole('heading', { level: 1, name: 'Dodaj lek' });
    await user.type(text('Nazwa leku'), 'Krople');
    await user.selectOptions(select('Postać leku'), 'drops');
    await user.selectOptions(select(/^Jednostka dawki/), 'kropla');
    fireEvent.change(screen.getByLabelText(/^Godzina 1/), { target: { value: '08:00' } });
    await user.type(text(/^Dawka 1/), '2');
    await user.type(text('Aktualny zapas'), '10');
    await user.selectOptions(select(/^Jednostka zapasu/), 'ml');
    await user.type(threshold(), '2');
    await user.click(submit('Dodaj lek'));

    await waitFor(async () => {
      expect(await services.repositories.medications.list()).toHaveLength(1);
    });
    expect((await services.repositories.medications.list())[0]).toMatchObject({
      doseUnit: 'kropla',
      stock: { quantity: 10, unit: 'ml' },
      lowStockThreshold: { quantity: 2, unit: 'ml' },
    });
  });
});

describe('edit medication: the own threshold', () => {
  it('saves a medication saved before the threshold existed without adding one', async () => {
    const user = userEvent.setup();
    const services = await seed();
    const { router } = renderApp('/medications/m-1/edit', services);
    await screen.findByRole('heading', { level: 1, name: 'Edytuj lek' });

    expect(threshold()).toHaveValue('');
    await user.type(text(/^Notatki/), 'x');
    await user.click(submit('Zapisz zmiany'));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/medications');
    });

    expect('lowStockThreshold' in (await services.repositories.medications.get('m-1'))).toBe(false);
  });

  it('changes and removes the threshold, and the stock stays as it was', async () => {
    const user = userEvent.setup();
    const services = await seed({ lowStockThreshold: { quantity: 5, unit: 'tabletka' } });
    const first = renderApp('/medications/m-1/edit', services);
    await screen.findByRole('heading', { level: 1, name: 'Edytuj lek' });
    expect(threshold()).toHaveValue('5');
    await user.clear(threshold());
    await user.type(threshold(), '12');
    await user.click(submit('Zapisz zmiany'));
    await waitFor(() => {
      expect(first.router.state.location.pathname).toBe('/medications');
    });
    let saved = await services.repositories.medications.get('m-1');
    expect(saved.lowStockThreshold).toEqual({ quantity: 12, unit: 'tabletka' });
    expect(saved.stock).toEqual({ quantity: 28, unit: 'tabletka', asOf: counted });
    cleanup();

    const second = renderApp('/medications/m-1/edit', services);
    await screen.findByRole('heading', { level: 1, name: 'Edytuj lek' });
    await user.clear(threshold());
    await user.click(submit('Zapisz zmiany'));
    await waitFor(() => {
      expect(second.router.state.location.pathname).toBe('/medications');
    });
    saved = await services.repositories.medications.get('m-1');
    expect('lowStockThreshold' in saved).toBe(false);
    expect(saved.stock).toEqual({ quantity: 28, unit: 'tabletka', asOf: counted });
  });

  it('warns at the boundary: below, at and above the threshold, through the real estimate', async () => {
    const user = userEvent.setup();
    const services = await seed();
    const { router } = renderApp('/medications/m-1/edit', services);
    await screen.findByRole('heading', { level: 1, name: 'Edytuj lek' });
    await user.type(threshold(), '28');
    await user.click(submit('Zapisz zmiany'));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/medications');
    });

    const saved = await services.repositories.medications.get('m-1');
    const estimate = estimateStock({ medication: saved, doseLogs: [], today });

    expect(estimate).toMatchObject({ available: true, remaining: 28 });
    expect(isLowStock(estimate, saved.lowStockThreshold)).toBe(true); // 28 <= 28
    expect(isLowStock(estimate, { quantity: 27.999, unit: 'tabletka' })).toBe(false);
    expect(isLowStock(estimate, { quantity: 28.001, unit: 'tabletka' })).toBe(true);
  });

  it('removing the stock quantity while a threshold is set is refused, not silently dropped', async () => {
    const user = userEvent.setup();
    const services = await seed({ lowStockThreshold: { quantity: 5, unit: 'tabletka' } });
    renderApp('/medications/m-1/edit', services);
    await screen.findByRole('heading', { level: 1, name: 'Edytuj lek' });
    await user.clear(text('Aktualny zapas'));

    await user.click(submit('Zapisz zmiany'));

    expect(await screen.findByText(/Próg dotyczy zapasu/)).toBeVisible();
    expect((await services.repositories.medications.get('m-1')).lowStockThreshold).toEqual({
      quantity: 5,
      unit: 'tabletka',
    });
  });

  describe('a threshold in another unit than the stock', () => {
    const mismatched = { lowStockThreshold: { quantity: 5, unit: 'ml' } };

    it('says at once that it is not applied, that the 7-day rule is used, and keeps it as stored', async () => {
      const user = userEvent.setup();
      const services = await seed(mismatched);
      const { router } = renderApp('/medications/m-1/edit', services);
      await screen.findByRole('heading', { level: 1, name: 'Edytuj lek' });

      expect(screen.getByRole('status')).toHaveTextContent(
        'Próg jest zapisany w jednostce „ml”, a zapas jest liczony w jednostce „tabletka”.',
      );
      expect(screen.getByRole('status')).toHaveTextContent('obowiązuje reguła 7 dni');
      await user.click(submit('Zapisz zmiany'));
      await waitFor(() => {
        expect(router.state.location.pathname).toBe('/medications');
      });

      expect((await services.repositories.medications.get('m-1')).lowStockThreshold).toEqual({
        quantity: 5,
        unit: 'ml',
      });
    });

    it('counts it in the stock unit only when the person asks, without converting the number', async () => {
      const user = userEvent.setup();
      const services = await seed(mismatched);
      const { router } = renderApp('/medications/m-1/edit', services);
      await screen.findByRole('heading', { level: 1, name: 'Edytuj lek' });

      await user.click(
        screen.getByRole('button', { name: /Licz ten próg w jednostce zapasu: tabletka/ }),
      );
      expect(screen.queryByRole('status')).not.toBeInTheDocument();
      await user.click(submit('Zapisz zmiany'));
      await waitFor(() => {
        expect(router.state.location.pathname).toBe('/medications');
      });

      expect((await services.repositories.medications.get('m-1')).lowStockThreshold).toEqual({
        quantity: 5,
        unit: 'tabletka',
      });
    });

    it('treats a number typed now as counted in the stock unit, and the note goes away', async () => {
      const user = userEvent.setup();
      const services = await seed(mismatched);
      renderApp('/medications/m-1/edit', services);
      await screen.findByRole('heading', { level: 1, name: 'Edytuj lek' });

      await user.clear(threshold());
      await user.type(threshold(), '6');

      expect(screen.queryByRole('status')).not.toBeInTheDocument();
    });

    it('appears when the stock unit is changed in the form while the stored threshold keeps its unit', async () => {
      const user = userEvent.setup();
      const services = await seed({
        dosageForm: 'drops',
        doseUnit: 'kropla',
        stock: { quantity: 20, unit: 'kropla', asOf: counted },
        lowStockThreshold: { quantity: 4, unit: 'kropla' },
      });
      renderApp('/medications/m-1/edit', services);
      await screen.findByRole('heading', { level: 1, name: 'Edytuj lek' });
      expect(screen.queryByText(/Próg jest zapisany w jednostce/)).not.toBeInTheDocument();

      await user.selectOptions(select(/^Jednostka zapasu/), 'ml');

      expect(await screen.findByText(/Próg jest zapisany w jednostce „kropla”/)).toBeVisible();
    });
  });
});
