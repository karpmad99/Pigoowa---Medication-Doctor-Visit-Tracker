import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it } from 'vitest';
import { ServicesProvider } from '@/app/ServicesProvider';
import { routes } from '@/app/routes';
import { estimateStock } from '@/features/medications/logic/stock';
import { makeMedication, scheduleTime } from '@/test/fixtures';
import { createTestServices } from '@/test/services';
import { asLocalDate, asTimestamp } from '@/utils/date';

// F4: the dosage form, the unit lists, the strength and the stock unit in the medication form.
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

const text = (name: string | RegExp) => screen.getByRole('textbox', { name });
const select = (name: string | RegExp) => screen.getByRole('combobox', { name });
const submit = (label: string) => screen.getByRole('button', { name: label });
const optionsOf = (name: string | RegExp) =>
  within(select(name))
    .getAllByRole('option')
    .map((option) => option.textContent);

function setTime(value: string) {
  fireEvent.change(screen.getByLabelText(/^Godzina 1/), { target: { value } });
}

const medications = (services: Services) => services.repositories.medications.list();
const counted = asTimestamp('2026-09-01T08:00:00Z');

/** Saved before F4: no dosage form, no strength. */
async function seedOld(overrides: Parameters<typeof makeMedication>[0] = {}) {
  const services = createTestServices();
  await services.repositories.medications.create(
    makeMedication({
      id: 'm-1',
      name: 'Demoxal',
      startDate: asLocalDate('2026-01-01'),
      scheduleEffectiveFrom: asLocalDate('2026-01-01'),
      scheduleTimes: [scheduleTime('t-1', '08:00', 1)],
      ...overrides,
    }),
  );
  return services;
}

async function fillRest(user: UserEvent) {
  setTime('08:00');
  await user.type(text(/^Dawka 1/), '1');
}

describe('add medication: dosage form and unit lists', () => {
  it('offers a unit list after the form is chosen, and stores the form and the chosen unit', async () => {
    const user = userEvent.setup();
    const { services } = renderApp('/medications/new');
    await screen.findByRole('heading', { level: 1, name: 'Dodaj lek' });

    // Without a form the unit is typed, as before: no list is invented.
    expect(text(/^Jednostka dawki/)).toBeVisible();
    await user.type(text('Nazwa leku'), 'Demoxal');
    await user.selectOptions(select('Postać leku'), 'tablet');

    expect(optionsOf(/^Jednostka dawki/)).toEqual(['Wybierz jednostkę', 'tabletka']);
    await user.selectOptions(select(/^Jednostka dawki/), 'tabletka');
    await fillRest(user);
    await user.click(submit('Dodaj lek'));

    await waitFor(async () => {
      expect(await medications(services)).toHaveLength(1);
    });
    const [saved] = await medications(services);
    expect(saved).toMatchObject({ dosageForm: 'tablet', doseUnit: 'tabletka' });
  });

  it.each([
    ['capsule', ['kapsułka']],
    ['liquid', ['ml']],
    ['drops', ['kropla']],
    ['injection', ['ampułka', 'wstrzyknięcie', 'ml']],
    ['sachet', ['saszetka']],
    ['patch', ['plaster']],
    ['suppository', ['czopek']],
    ['inhaler', ['dawka']],
  ])('offers exactly the units of the form "%s"', async (form, units) => {
    const user = userEvent.setup();
    renderApp('/medications/new');
    await screen.findByRole('heading', { level: 1, name: 'Dodaj lek' });

    await user.selectOptions(select('Postać leku'), form);

    expect(optionsOf(/^Jednostka dawki/)).toEqual(['Wybierz jednostkę', ...units]);
  });

  it('keeps the unit typed where the form offers none ("other" or no form)', async () => {
    const user = userEvent.setup();
    const { services } = renderApp('/medications/new');
    await screen.findByRole('heading', { level: 1, name: 'Dodaj lek' });
    await user.type(text('Nazwa leku'), 'Demoxal');
    await user.selectOptions(select('Postać leku'), 'other');

    await user.type(text(/^Jednostka dawki/), 'inhalacja');
    await fillRest(user);
    await user.click(submit('Dodaj lek'));

    await waitFor(async () => {
      expect(await medications(services)).toHaveLength(1);
    });
    expect((await medications(services))[0]).toMatchObject({
      dosageForm: 'other',
      doseUnit: 'inhalacja',
    });
  });

  it('stores neither a form nor a strength when none is given: the fields are absent', async () => {
    const user = userEvent.setup();
    const { services } = renderApp('/medications/new');
    await screen.findByRole('heading', { level: 1, name: 'Dodaj lek' });
    await user.type(text('Nazwa leku'), 'Demoxal');
    await user.type(text(/^Jednostka dawki/), 'tabletka');
    await fillRest(user);
    await user.click(submit('Dodaj lek'));

    await waitFor(async () => {
      expect(await medications(services)).toHaveLength(1);
    });
    const [saved] = await medications(services);
    expect(saved).toBeDefined();
    expect(saved && 'dosageForm' in saved).toBe(false);
    expect(saved && 'strength' in saved).toBe(false);
  });

  it('clears a unit that is not on the list of the newly chosen form, and never replaces it with another', async () => {
    const user = userEvent.setup();
    renderApp('/medications/new');
    await screen.findByRole('heading', { level: 1, name: 'Dodaj lek' });
    await user.selectOptions(select('Postać leku'), 'tablet');
    await user.selectOptions(select(/^Jednostka dawki/), 'tabletka');

    await user.selectOptions(select('Postać leku'), 'liquid');

    expect(select(/^Jednostka dawki/)).toHaveValue('');
    expect(optionsOf(/^Jednostka dawki/)).toEqual(['Wybierz jednostkę', 'ml']);
  });

  it('refuses a missing unit with a message that says to choose or type one', async () => {
    const user = userEvent.setup();
    renderApp('/medications/new');
    await screen.findByRole('heading', { level: 1, name: 'Dodaj lek' });
    await user.type(text('Nazwa leku'), 'Demoxal');
    await user.selectOptions(select('Postać leku'), 'tablet');
    await fillRest(user);

    await user.click(submit('Dodaj lek'));

    expect(await screen.findByText(/Wybierz lub wpisz jednostkę dawki/)).toBeVisible();
    expect(select(/^Jednostka dawki/)).toBeInvalid();
  });
});

describe('add medication: strength', () => {
  it('stores the strength as information, and it does not change the dose or the stock', async () => {
    const user = userEvent.setup();
    const { services } = renderApp('/medications/new');
    await screen.findByRole('heading', { level: 1, name: 'Dodaj lek' });
    await user.type(text('Nazwa leku'), 'Demoxal');
    await user.type(text(/^Jednostka dawki/), 'tabletka');
    await user.type(text('Moc: liczba'), '0,5');
    await user.selectOptions(select('Moc: jednostka'), 'g');
    await fillRest(user);
    await user.type(text('Aktualny zapas'), '30');

    await user.click(submit('Dodaj lek'));

    await waitFor(async () => {
      expect(await medications(services)).toHaveLength(1);
    });
    const [saved] = await medications(services);
    expect(saved).toMatchObject({
      strength: { value: 0.5, unit: 'g' },
      stock: { quantity: 30, unit: 'tabletka' },
    });
    expect(saved?.scheduleTimes.map((entry) => entry.doseAmount)).toEqual([1]);
    if (saved === undefined) throw new Error('not saved');
    expect(
      estimateStock({ medication: saved, doseLogs: [], today: asLocalDate('2026-10-15') }),
    ).toMatchObject({ available: true, remaining: 30 });
  });

  it('offers only the strength units, never a dose or stock unit', async () => {
    renderApp('/medications/new');
    await screen.findByRole('heading', { level: 1, name: 'Dodaj lek' });

    expect(optionsOf('Moc: jednostka')).toEqual([
      'Nie podano',
      'mg',
      'mcg',
      'g',
      'IU',
      'mg/ml',
      'mcg/ml',
      '%',
    ]);
    expect(screen.getByText(/nie zmienia dawki ani zapasu/)).toBeVisible();
  });

  it('says what is missing when only half of the strength is given, and saves nothing', async () => {
    const user = userEvent.setup();
    const { services } = renderApp('/medications/new');
    await screen.findByRole('heading', { level: 1, name: 'Dodaj lek' });
    await user.type(text('Nazwa leku'), 'Demoxal');
    await user.type(text(/^Jednostka dawki/), 'tabletka');
    await fillRest(user);

    await user.type(text('Moc: liczba'), '500');
    await user.click(submit('Dodaj lek'));
    expect(await screen.findByText('Wybierz jednostkę mocy, na przykład mg.')).toBeVisible();

    await user.clear(text('Moc: liczba'));
    await user.selectOptions(select('Moc: jednostka'), 'mg');
    await user.click(submit('Dodaj lek'));
    expect(await screen.findByText('Wpisz liczbę mocy albo usuń jej jednostkę.')).toBeVisible();
    expect(await medications(services)).toEqual([]);
  });

  it.each(['0', '-5', 'abc', '1,2345'])('refuses the strength "%s"', async (value) => {
    const user = userEvent.setup();
    renderApp('/medications/new');
    await screen.findByRole('heading', { level: 1, name: 'Dodaj lek' });
    await user.type(text('Nazwa leku'), 'Demoxal');
    await user.type(text(/^Jednostka dawki/), 'tabletka');
    await fillRest(user);
    await user.type(text('Moc: liczba'), value);
    await user.selectOptions(select('Moc: jednostka'), 'mg');

    await user.click(submit('Dodaj lek'));

    expect(await screen.findByText(/Wpisz moc jako liczbę większą od zera/)).toBeVisible();
  });

  it('groups the two parts under one label for a screen reader', async () => {
    renderApp('/medications/new');
    await screen.findByRole('heading', { level: 1, name: 'Dodaj lek' });

    expect(screen.getByRole('group', { name: 'Moc leku (opcjonalnie)' })).toBeVisible();
  });
});

describe('add medication: the stock unit', () => {
  it('follows the dose unit when left alone, with no warning', async () => {
    const user = userEvent.setup();
    const { services } = renderApp('/medications/new');
    await screen.findByRole('heading', { level: 1, name: 'Dodaj lek' });
    await user.type(text('Nazwa leku'), 'Demoxal');
    await user.selectOptions(select('Postać leku'), 'tablet');
    await user.selectOptions(select(/^Jednostka dawki/), 'tabletka');
    await fillRest(user);
    await user.type(text('Aktualny zapas'), '30');

    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    await user.click(submit('Dodaj lek'));

    await waitFor(async () => {
      expect(await medications(services)).toHaveLength(1);
    });
    expect((await medications(services))[0]?.stock).toMatchObject({
      quantity: 30,
      unit: 'tabletka',
    });
  });

  it('says at once that no estimate is possible when the stock unit differs, and keeps both units as chosen', async () => {
    const user = userEvent.setup();
    const { services } = renderApp('/medications/new');
    await screen.findByRole('heading', { level: 1, name: 'Dodaj lek' });
    await user.type(text('Nazwa leku'), 'Krople');
    await user.selectOptions(select('Postać leku'), 'drops');
    await user.selectOptions(select(/^Jednostka dawki/), 'kropla');
    await fillRest(user);
    await user.type(text('Aktualny zapas'), '20');

    await user.selectOptions(select(/^Jednostka zapasu/), 'ml');

    expect(await screen.findByRole('status')).toHaveTextContent(
      'Zapas jest liczony w jednostce „ml”, a dawka w jednostce „kropla”. Nie przeliczamy jednostek, więc szacunek zapasu nie będzie dostępny.',
    );
    await user.click(submit('Dodaj lek'));
    await waitFor(async () => {
      expect(await medications(services)).toHaveLength(1);
    });
    const [saved] = await medications(services);
    if (saved === undefined) throw new Error('not saved');
    expect(saved).toMatchObject({ doseUnit: 'kropla', stock: { quantity: 20, unit: 'ml' } });
    expect(
      estimateStock({ medication: saved, doseLogs: [], today: asLocalDate('2026-10-15') }),
    ).toEqual({ available: false, reason: 'incompatible-units' });
  });

  it('shows no warning while there is no stock quantity', async () => {
    const user = userEvent.setup();
    renderApp('/medications/new');
    await screen.findByRole('heading', { level: 1, name: 'Dodaj lek' });
    await user.selectOptions(select('Postać leku'), 'drops');
    await user.selectOptions(select(/^Jednostka dawki/), 'kropla');

    await user.selectOptions(select(/^Jednostka zapasu/), 'ml');

    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});

describe('edit medication saved before the dosage form existed', () => {
  it('opens with the unit exactly as stored, and saves without it changing: no form, no strength, no new fields', async () => {
    const user = userEvent.setup();
    const services = await seedOld({
      doseUnit: 'Tabletka ',
      stock: { quantity: 28, unit: 'Tabletka ', asOf: counted },
    });
    const before = await services.repositories.medications.get('m-1');
    const { router } = renderApp('/medications/m-1/edit', services);
    await screen.findByRole('heading', { level: 1, name: 'Edytuj lek' });

    expect(text(/^Jednostka dawki/)).toHaveValue('Tabletka ');
    expect(select('Postać leku')).toHaveValue('');
    expect(text('Moc: liczba')).toHaveValue('');
    await user.clear(text(/^Notatki/));
    await user.type(text(/^Notatki/), 'Nowa notatka');
    await user.click(submit('Zapisz zmiany'));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/medications');
    });

    const after = await services.repositories.medications.get('m-1');
    expect(after.doseUnit).toBe('Tabletka ');
    expect(after.stock).toEqual(before.stock); // the unit text and "as of" are untouched
    expect('dosageForm' in after).toBe(false);
    expect('strength' in after).toBe(false);
    expect(after.notes).toBe('Nowa notatka');
  });

  it('shows the unit that is not on the list as the first, selected option, once a form is chosen, and saves it unchanged', async () => {
    const user = userEvent.setup();
    const services = await seedOld({ doseUnit: 'inhalacja' });
    const { router } = renderApp('/medications/m-1/edit', services);
    await screen.findByRole('heading', { level: 1, name: 'Edytuj lek' });

    await user.selectOptions(select('Postać leku'), 'inhaler');

    expect(optionsOf(/^Jednostka dawki/)).toEqual([
      'inhalacja (dotychczasowa, spoza listy)',
      'dawka',
    ]);
    expect(select(/^Jednostka dawki/)).toHaveValue('inhalacja');
    expect(
      screen.getByText(/nie ma jej na liście dla wybranej postaci\. Możesz ją zostawić/),
    ).toBeVisible();
    await user.click(submit('Zapisz zmiany'));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/medications');
    });

    expect(await services.repositories.medications.get('m-1')).toMatchObject({
      dosageForm: 'inhaler',
      doseUnit: 'inhalacja',
    });
  });

  it('cannot go back to the old unit once another one is saved', async () => {
    const user = userEvent.setup();
    const services = await seedOld({ doseUnit: 'inhalacja' });
    const first = renderApp('/medications/m-1/edit', services);
    await screen.findByRole('heading', { level: 1, name: 'Edytuj lek' });
    await user.selectOptions(select('Postać leku'), 'inhaler');
    await user.selectOptions(select(/^Jednostka dawki/), 'dawka');
    await user.click(submit('Zapisz zmiany'));
    await waitFor(() => {
      expect(first.router.state.location.pathname).toBe('/medications');
    });
    expect((await services.repositories.medications.get('m-1')).doseUnit).toBe('dawka');
    cleanup();

    renderApp('/medications/m-1/edit', services);
    await screen.findByRole('heading', { level: 1, name: 'Edytuj lek' });

    expect(optionsOf(/^Jednostka dawki/)).toEqual(['dawka']);
  });

  it('shows a unit written differently as the listed one, but stores the old text until another is picked', async () => {
    const user = userEvent.setup();
    const services = await seedOld({ doseUnit: 'Tabletka ', dosageForm: 'tablet' });
    const { router } = renderApp('/medications/m-1/edit', services);
    await screen.findByRole('heading', { level: 1, name: 'Edytuj lek' });

    expect(select(/^Jednostka dawki/)).toHaveValue('tabletka');
    expect(optionsOf(/^Jednostka dawki/)).toEqual(['tabletka']);
    await user.click(submit('Zapisz zmiany'));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/medications');
    });

    expect((await services.repositories.medications.get('m-1')).doseUnit).toBe('Tabletka ');
  });

  it('keeps the stored unit while the form is changed, and clears only a unit that was picked in this form', async () => {
    const user = userEvent.setup();
    const services = await seedOld({ doseUnit: 'tabletka' });
    renderApp('/medications/m-1/edit', services);
    await screen.findByRole('heading', { level: 1, name: 'Edytuj lek' });

    await user.selectOptions(select('Postać leku'), 'liquid');

    expect(optionsOf(/^Jednostka dawki/)).toEqual(['tabletka (dotychczasowa, spoza listy)', 'ml']);
    expect(select(/^Jednostka dawki/)).toHaveValue('tabletka');
    await user.selectOptions(select(/^Jednostka dawki/), 'ml');
    await user.selectOptions(select('Postać leku'), 'capsule');
    // "ml" was picked in this session and is not stored: it is cleared, not replaced.
    expect(select(/^Jednostka dawki/)).toHaveValue('');
  });

  it('changing the form never changes the stored units, the stock or the history by itself', async () => {
    const user = userEvent.setup();
    const services = await seedOld({
      doseUnit: 'ml',
      stock: { quantity: 100, unit: 'ml', asOf: counted },
    });
    const before = await services.repositories.medications.get('m-1');
    const { router } = renderApp('/medications/m-1/edit', services);
    await screen.findByRole('heading', { level: 1, name: 'Edytuj lek' });

    await user.selectOptions(select('Postać leku'), 'drops');
    await user.click(submit('Zapisz zmiany'));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/medications');
    });

    const after = await services.repositories.medications.get('m-1');
    expect(after).toMatchObject({ dosageForm: 'drops', doseUnit: 'ml', stock: before.stock });
  });

  it('a stock unit outside the list stays as the first option and is saved unchanged', async () => {
    const user = userEvent.setup();
    const services = await seedOld({
      doseUnit: 'tabletka',
      dosageForm: 'tablet',
      stock: { quantity: 28, unit: 'opakowanie', asOf: counted },
    });
    const before = await services.repositories.medications.get('m-1');
    const { router } = renderApp('/medications/m-1/edit', services);
    await screen.findByRole('heading', { level: 1, name: 'Edytuj lek' });

    expect(optionsOf(/^Jednostka zapasu/)).toEqual([
      'Taka jak jednostka dawki (tabletka)',
      'opakowanie (dotychczasowa, spoza listy)',
      'tabletka',
    ]);
    expect(select(/^Jednostka zapasu/)).toHaveValue('opakowanie');
    expect(await screen.findByRole('status')).toHaveTextContent('Nie przeliczamy jednostek');
    await user.click(submit('Zapisz zmiany'));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/medications');
    });

    expect((await services.repositories.medications.get('m-1')).stock).toEqual(before.stock);
  });

  it('saves, reads back and re-opens a strength; clearing it removes it', async () => {
    const user = userEvent.setup();
    const services = await seedOld();
    const first = renderApp('/medications/m-1/edit', services);
    await screen.findByRole('heading', { level: 1, name: 'Edytuj lek' });
    await user.type(text('Moc: liczba'), '250');
    await user.selectOptions(select('Moc: jednostka'), 'mg/ml');
    await user.click(submit('Zapisz zmiany'));
    await waitFor(() => {
      expect(first.router.state.location.pathname).toBe('/medications');
    });
    expect((await services.repositories.medications.get('m-1')).strength).toEqual({
      value: 250,
      unit: 'mg/ml',
    });
    cleanup();

    const second = renderApp('/medications/m-1/edit', services);
    await screen.findByRole('heading', { level: 1, name: 'Edytuj lek' });
    expect(text('Moc: liczba')).toHaveValue('250');
    expect(select('Moc: jednostka')).toHaveValue('mg/ml');
    await user.clear(text('Moc: liczba'));
    await user.selectOptions(select('Moc: jednostka'), '');
    await user.click(submit('Zapisz zmiany'));
    await waitFor(() => {
      expect(second.router.state.location.pathname).toBe('/medications');
    });

    expect('strength' in (await services.repositories.medications.get('m-1'))).toBe(false);
  });

  it('changing the strength changes no stock estimate (the estimate is the same number)', async () => {
    const user = userEvent.setup();
    const services = await seedOld({
      stock: { quantity: 28, unit: 'tabletka', asOf: counted },
    });
    const today = asLocalDate('2026-10-15');
    const before = estimateStock({
      medication: await services.repositories.medications.get('m-1'),
      doseLogs: [],
      today,
    });
    const { router } = renderApp('/medications/m-1/edit', services);
    await screen.findByRole('heading', { level: 1, name: 'Edytuj lek' });

    await user.type(text('Moc: liczba'), '5000');
    await user.selectOptions(select('Moc: jednostka'), 'mg');
    await user.click(submit('Zapisz zmiany'));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/medications');
    });

    const saved = await services.repositories.medications.get('m-1');
    expect(saved.strength).toEqual({ value: 5000, unit: 'mg' });
    expect(estimateStock({ medication: saved, doseLogs: [], today })).toEqual(before);
    expect(saved.stock).toMatchObject({ quantity: 28, unit: 'tabletka', asOf: counted });
  });
});
