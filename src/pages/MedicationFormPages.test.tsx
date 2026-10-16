import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { ServicesProvider } from '@/app/ServicesProvider';
import { routes } from '@/app/routes';
import { RepositoryError } from '@/services/errors';
import { STORAGE_KEYS } from '@/services/local/collections';
import { createFakeStorage, createQuotaError } from '@/test/fakeStorage';
import { makeDoseLog, makeMedication, scheduleTime } from '@/test/fixtures';
import { createTestServices } from '@/test/services';
import { asLocalDate, asTimestamp } from '@/utils/date';

// The test clock says 12:00 on 15 October 2026 in Warsaw, so "today" is 2026-10-15.

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

const field = (name: string | RegExp) => screen.getByRole('textbox', { name });
const timeField = (row: number) => screen.getByLabelText(new RegExp(`^Godzina ${String(row)}`));
const submit = (label: string) => screen.getByRole('button', { name: label });

function setTime(row: number, value: string) {
  fireEvent.change(timeField(row), { target: { value } });
}

/** Fills the form with a valid medication: one 08:00 dose of 1. */
async function fillValid(user: UserEvent, name = 'Demoxal') {
  await user.type(field('Nazwa leku'), name);
  await user.type(field('Jednostka dawki'), 'tabletka');
  setTime(1, '08:00');
  await user.type(field(/^Dawka 1/), '1');
}

const allMedications = (services: Services) => services.repositories.medications.list();
const allLogs = (services: Services) =>
  services.repositories.doseLogs.listByDateRange(
    asLocalDate('2000-01-01'),
    asLocalDate('2999-12-31'),
  );

describe('add medication: the form', () => {
  it('starts with today as the start date and one blank schedule row, with no time or dose pre-filled', async () => {
    renderApp('/medications/new');

    expect(await screen.findByRole('heading', { level: 1, name: 'Dodaj lek' })).toBeVisible();
    expect(screen.getByLabelText(/^Data rozpoczęcia/)).toHaveValue('2026-10-15');
    expect(screen.getByLabelText(/^Data zakończenia/)).toHaveValue('');
    expect(timeField(1)).toHaveValue('');
    expect(field(/^Dawka 1/)).toHaveValue('');
    expect(screen.queryByLabelText(/^Godzina 2/)).not.toBeInTheDocument();
  });

  it('labels every field and marks the required ones for assistive technology', async () => {
    renderApp('/medications/new');
    await screen.findByRole('heading', { level: 1, name: 'Dodaj lek' });

    for (const name of ['Nazwa leku', 'Jednostka dawki', 'Dawka 1']) {
      expect(field(new RegExp(`^${name}`))).toHaveAttribute('aria-required', 'true');
    }
    expect(timeField(1)).toHaveAttribute('aria-required', 'true');
    expect(screen.getByLabelText(/^Data rozpoczęcia/)).toHaveAttribute('aria-required', 'true');
    expect(field('Aktualny zapas')).not.toHaveAttribute('aria-required');
    expect(screen.getByRole('group', { name: 'Godziny przyjmowania' })).toBeVisible();
    expect(
      screen.getByText(/Harmonogram ustawiasz samodzielnie\. Nie zastępuje zaleceń lekarza/),
    ).toBeVisible();
  });

  it('can be filled and submitted with the keyboard alone', async () => {
    const user = userEvent.setup();
    const { router } = renderApp('/medications/new');
    await screen.findByRole('heading', { level: 1, name: 'Dodaj lek' });

    await user.click(field('Nazwa leku'));
    await user.keyboard('Demoxal');
    await user.tab();
    expect(field('Jednostka dawki')).toHaveFocus();
    await user.keyboard('tabletka');
    await user.tab();
    expect(timeField(1)).toHaveFocus();
    setTime(1, '08:00');
    await user.tab();
    expect(field(/^Dawka 1/)).toHaveFocus();
    await user.keyboard('1{Enter}');

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/medications');
    });
  });
});

describe('add medication: validation', () => {
  it('shows every problem at its own field, announced, and moves focus to the first one; nothing is saved', async () => {
    const user = userEvent.setup();
    const { services } = renderApp('/medications/new');
    await screen.findByRole('heading', { level: 1, name: 'Dodaj lek' });

    await user.click(submit('Dodaj lek'));

    const name = field(/^Nazwa leku/);
    await waitFor(() => {
      expect(name).toBeInvalid();
    });
    expect(name).toHaveAccessibleDescription('Wpisz nazwę leku.');
    expect(field(/^Jednostka dawki/)).toHaveAccessibleDescription(
      expect.stringContaining('Wpisz jednostkę dawki'),
    );
    expect(timeField(1)).toHaveAccessibleDescription('Wybierz poprawną godzinę.');
    expect(field(/^Dawka 1/)).toHaveAccessibleDescription(
      expect.stringContaining('Wpisz dawkę większą od zera'),
    );
    expect(screen.getAllByRole('alert').length).toBeGreaterThanOrEqual(4);
    expect(name).toHaveFocus();
    expect(await allMedications(services)).toEqual([]);
    expect(screen.getByRole('heading', { level: 1, name: 'Dodaj lek' })).toBeVisible();
  });

  it('keeps what the user typed when validation fails', async () => {
    const user = userEvent.setup();
    renderApp('/medications/new');
    await screen.findByRole('heading', { level: 1, name: 'Dodaj lek' });
    await user.type(field('Nazwa leku'), 'Demoxal');
    await user.type(field(/^Notatki/), 'Po jedzeniu');

    await user.click(submit('Dodaj lek'));

    await waitFor(() => {
      expect(field(/^Jednostka dawki/)).toBeInvalid();
    });
    expect(field(/^Nazwa leku/)).toHaveValue('Demoxal');
    expect(field(/^Notatki/)).toHaveValue('Po jedzeniu');
  });

  it.each([
    ['zero', '0'],
    ['negative', '-1'],
    ['text', 'dwie'],
    ['too precise', '1,2345'],
    ['in exponent notation', '1e3'],
  ])('refuses a dose that is %s', async (_label, dose) => {
    const user = userEvent.setup();
    const { services } = renderApp('/medications/new');
    await screen.findByRole('heading', { level: 1, name: 'Dodaj lek' });
    await user.type(field('Nazwa leku'), 'Demoxal');
    await user.type(field('Jednostka dawki'), 'tabletka');
    setTime(1, '08:00');
    await user.type(field(/^Dawka 1/), dose);

    await user.click(submit('Dodaj lek'));

    await waitFor(() => {
      expect(field(/^Dawka 1/)).toBeInvalid();
    });
    expect(field(/^Dawka 1/)).toHaveAccessibleDescription(
      expect.stringContaining('Wpisz dawkę większą od zera'),
    );
    expect(await allMedications(services)).toEqual([]);
  });

  it('accepts a decimal dose written with a comma', async () => {
    const user = userEvent.setup();
    const { services } = renderApp('/medications/new');
    await screen.findByRole('heading', { level: 1, name: 'Dodaj lek' });
    await fillValid(user);
    await user.clear(field(/^Dawka 1/));
    await user.type(field(/^Dawka 1/), '0,5');

    await user.click(submit('Dodaj lek'));

    await waitFor(async () => {
      expect((await allMedications(services))[0]?.scheduleTimes[0]?.doseAmount).toBe(0.5);
    });
  });

  it('refuses an empty time', async () => {
    const user = userEvent.setup();
    renderApp('/medications/new');
    await screen.findByRole('heading', { level: 1, name: 'Dodaj lek' });
    await user.type(field('Nazwa leku'), 'Demoxal');
    await user.type(field('Jednostka dawki'), 'tabletka');
    await user.type(field(/^Dawka 1/), '1');

    await user.click(submit('Dodaj lek'));

    await waitFor(() => {
      expect(timeField(1)).toBeInvalid();
    });
  });

  it('refuses the same time twice, pointing at the repeated row, and saves nothing', async () => {
    const user = userEvent.setup();
    const { services } = renderApp('/medications/new');
    await screen.findByRole('heading', { level: 1, name: 'Dodaj lek' });
    await fillValid(user);
    await user.click(screen.getByRole('button', { name: 'Dodaj godzinę' }));
    setTime(2, '08:00');
    await user.type(field(/^Dawka 2/), '2');

    await user.click(submit('Dodaj lek'));

    await waitFor(() => {
      expect(timeField(2)).toBeInvalid();
    });
    expect(timeField(2)).toHaveAccessibleDescription(
      expect.stringContaining('Ta godzina jest już na liście'),
    );
    expect(timeField(1)).toBeValid();
    expect(await allMedications(services)).toEqual([]);
  });

  it('accepts two different times', async () => {
    const user = userEvent.setup();
    const { services } = renderApp('/medications/new');
    await screen.findByRole('heading', { level: 1, name: 'Dodaj lek' });
    await fillValid(user);
    await user.click(screen.getByRole('button', { name: 'Dodaj godzinę' }));
    setTime(2, '20:00');
    await user.type(field(/^Dawka 2/), '2');

    await user.click(submit('Dodaj lek'));

    await waitFor(async () => {
      expect(
        (await allMedications(services))[0]?.scheduleTimes.map((entry) => entry.timeOfDay),
      ).toEqual(['08:00', '20:00']);
    });
  });

  it('refuses an end date before the start date and an impossible-looking one', async () => {
    const user = userEvent.setup();
    const { services } = renderApp('/medications/new');
    await screen.findByRole('heading', { level: 1, name: 'Dodaj lek' });
    await fillValid(user);
    fireEvent.change(screen.getByLabelText(/^Data rozpoczęcia/), {
      target: { value: '2026-10-10' },
    });
    fireEvent.change(screen.getByLabelText(/^Data zakończenia/), {
      target: { value: '2026-10-09' },
    });

    await user.click(submit('Dodaj lek'));

    await waitFor(() => {
      expect(screen.getByLabelText(/^Data zakończenia/)).toBeInvalid();
    });
    expect(screen.getByLabelText(/^Data zakończenia/)).toHaveAccessibleDescription(
      expect.stringContaining('nie może być wcześniejsza niż data rozpoczęcia'),
    );
    expect(await allMedications(services)).toEqual([]);
  });

  it('refuses a missing start date', async () => {
    const user = userEvent.setup();
    renderApp('/medications/new');
    await screen.findByRole('heading', { level: 1, name: 'Dodaj lek' });
    await fillValid(user);
    fireEvent.change(screen.getByLabelText(/^Data rozpoczęcia/), { target: { value: '' } });

    await user.click(submit('Dodaj lek'));

    await waitFor(() => {
      expect(screen.getByLabelText(/^Data rozpoczęcia/)).toBeInvalid();
    });
    expect(screen.getByLabelText(/^Data rozpoczęcia/)).toHaveAccessibleDescription(
      'Wybierz poprawną datę rozpoczęcia.',
    );
  });

  it.each([
    ['negative', '-1'],
    ['text', 'dużo'],
    ['too precise', '1,2345'],
  ])('refuses a stock that is %s, but accepts zero and a blank field', async (_label, stock) => {
    const user = userEvent.setup();
    const { services } = renderApp('/medications/new');
    await screen.findByRole('heading', { level: 1, name: 'Dodaj lek' });
    await fillValid(user);
    await user.type(field(/^Aktualny zapas/), stock);

    await user.click(submit('Dodaj lek'));

    await waitFor(() => {
      expect(field(/^Aktualny zapas/)).toBeInvalid();
    });
    expect(await allMedications(services)).toEqual([]);
  });

  it('accepts a stock of zero as real information ("none left")', async () => {
    const user = userEvent.setup();
    const { services } = renderApp('/medications/new');
    await screen.findByRole('heading', { level: 1, name: 'Dodaj lek' });
    await fillValid(user);
    await user.type(field(/^Aktualny zapas/), '0');

    await user.click(submit('Dodaj lek'));

    await waitFor(async () => {
      expect((await allMedications(services))[0]?.stock?.quantity).toBe(0);
    });
  });

  it('enforces the length limits of name, unit and notes', async () => {
    const user = userEvent.setup();
    const { services } = renderApp('/medications/new');
    await screen.findByRole('heading', { level: 1, name: 'Dodaj lek' });
    await fillValid(user);
    fireEvent.change(field(/^Nazwa leku/), { target: { value: 'n'.repeat(121) } });
    fireEvent.change(field(/^Jednostka dawki/), { target: { value: 'u'.repeat(31) } });
    fireEvent.change(field(/^Notatki/), { target: { value: 'z'.repeat(1001) } });

    await user.click(submit('Dodaj lek'));

    await waitFor(() => {
      expect(field(/^Nazwa leku/)).toBeInvalid();
    });
    expect(field(/^Nazwa leku/)).toHaveAccessibleDescription(
      'Nazwa może mieć najwyżej 120 znaków.',
    );
    expect(field(/^Jednostka dawki/)).toBeInvalid();
    expect(field(/^Notatki/)).toBeInvalid();
    expect(await allMedications(services)).toEqual([]);
  });

  it('clears an error as soon as the field is corrected', async () => {
    const user = userEvent.setup();
    renderApp('/medications/new');
    await screen.findByRole('heading', { level: 1, name: 'Dodaj lek' });
    await user.click(submit('Dodaj lek'));
    await waitFor(() => {
      expect(field(/^Nazwa leku/)).toBeInvalid();
    });

    await user.type(field(/^Nazwa leku/), 'D');

    await waitFor(() => {
      expect(field(/^Nazwa leku/)).toBeValid();
    });
  });
});

describe('add medication: schedule editor', () => {
  it('adds a row that is labelled, empty, and focused', async () => {
    const user = userEvent.setup();
    renderApp('/medications/new');
    await screen.findByRole('heading', { level: 1, name: 'Dodaj lek' });

    await user.click(screen.getByRole('button', { name: 'Dodaj godzinę' }));

    expect(timeField(2)).toHaveValue('');
    expect(field(/^Dawka 2/)).toHaveValue('');
    expect(timeField(2)).toHaveFocus();
    expect(screen.getByRole('button', { name: 'Usuń godzinę 2' })).toBeVisible();
  });

  it('removes a row, renumbers the others, and keeps their values', async () => {
    const user = userEvent.setup();
    renderApp('/medications/new');
    await screen.findByRole('heading', { level: 1, name: 'Dodaj lek' });
    setTime(1, '08:00');
    await user.type(field(/^Dawka 1/), '1');
    await user.click(screen.getByRole('button', { name: 'Dodaj godzinę' }));
    setTime(2, '20:00');
    await user.type(field(/^Dawka 2/), '3');

    await user.click(screen.getByRole('button', { name: 'Usuń godzinę 1' }));

    expect(screen.queryByLabelText(/^Godzina 2/)).not.toBeInTheDocument();
    expect(timeField(1)).toHaveValue('20:00');
    expect(field(/^Dawka 1/)).toHaveValue('3');
    expect(screen.getByRole('button', { name: 'Dodaj godzinę' })).toHaveFocus();
  });

  it('lets every time be removed, and then asks for at least one', async () => {
    const user = userEvent.setup();
    const { services } = renderApp('/medications/new');
    await screen.findByRole('heading', { level: 1, name: 'Dodaj lek' });
    await user.type(field('Nazwa leku'), 'Demoxal');
    await user.type(field('Jednostka dawki'), 'tabletka');

    await user.click(screen.getByRole('button', { name: 'Usuń godzinę 1' }));
    await user.click(submit('Dodaj lek'));

    expect(await screen.findByText('Dodaj co najmniej jedną godzinę przyjmowania.')).toBeVisible();
    expect(await allMedications(services)).toEqual([]);
  });

  it('mentions the dose unit once it is known', async () => {
    const user = userEvent.setup();
    renderApp('/medications/new');
    await screen.findByRole('heading', { level: 1, name: 'Dodaj lek' });
    expect(screen.getByText(/Najpierw podaj jednostkę dawki/)).toBeVisible();

    await user.type(field('Jednostka dawki'), 'ml');

    const schedule = screen.getByRole('group', { name: 'Godziny przyjmowania' });
    expect(within(schedule).getByText(/w jednostce: ml/)).toBeVisible();
  });
});

describe('add medication: saving', () => {
  it('saves exactly what was entered, goes back to the list and confirms it', async () => {
    const user = userEvent.setup();
    const { router, services } = renderApp('/medications/new');
    await screen.findByRole('heading', { level: 1, name: 'Dodaj lek' });
    await user.type(field('Nazwa leku'), '  Demoxal  ');
    await user.type(field('Jednostka dawki'), 'tabletka');
    setTime(1, '08:00');
    await user.type(field(/^Dawka 1/), '1');
    await user.click(screen.getByRole('button', { name: 'Dodaj godzinę' }));
    setTime(2, '20:00');
    await user.type(field(/^Dawka 2/), '0,5');
    fireEvent.change(screen.getByLabelText(/^Data rozpoczęcia/), {
      target: { value: '2026-10-01' },
    });
    fireEvent.change(screen.getByLabelText(/^Data zakończenia/), {
      target: { value: '2026-12-31' },
    });
    await user.type(field(/^Aktualny zapas/), '28');
    await user.type(field(/^Notatki/), 'Po jedzeniu');

    await user.click(submit('Dodaj lek'));

    expect(await screen.findByRole('article', { name: 'Demoxal' })).toBeVisible();
    expect(router.state.location.pathname).toBe('/medications');
    expect(screen.getByText('Dodano lek „Demoxal”.')).toBeVisible();
    const [saved] = await allMedications(services);
    expect(saved).toMatchObject({
      name: 'Demoxal',
      doseUnit: 'tabletka',
      notes: 'Po jedzeniu',
      startDate: '2026-10-01',
      endDate: '2026-12-31',
      scheduleEffectiveFrom: '2026-10-01',
      stock: { quantity: 28, unit: 'tabletka', asOf: '2026-10-15T10:00:00.000Z' },
      createdAt: '2026-10-15T10:00:00.000Z',
    });
    expect(saved?.scheduleTimes.map((entry) => [entry.timeOfDay, entry.doseAmount])).toEqual([
      ['08:00', 1],
      ['20:00', 0.5],
    ]);
  });

  it('is still there after the page is reloaded', async () => {
    const user = userEvent.setup();
    const storage = createFakeStorage();
    renderApp('/medications/new', createTestServices(storage));
    await screen.findByRole('heading', { level: 1, name: 'Dodaj lek' });
    await fillValid(user);
    await user.click(submit('Dodaj lek'));
    await screen.findByRole('article', { name: 'Demoxal' });

    const reloaded = createTestServices(storage);

    expect((await allMedications(reloaded)).map((medication) => medication.name)).toEqual([
      'Demoxal',
    ]);
  });

  it('creates only one medication when the button is clicked twice quickly', async () => {
    const user = userEvent.setup();
    const { services } = renderApp('/medications/new');
    await screen.findByRole('heading', { level: 1, name: 'Dodaj lek' });
    await fillValid(user);
    const create = vi.spyOn(services.repositories.medications, 'create');

    await user.dblClick(submit('Dodaj lek'));

    await screen.findByRole('article', { name: 'Demoxal' });
    expect(create).toHaveBeenCalledTimes(1);
    expect(await allMedications(services)).toHaveLength(1);
  });

  it('disables the button and says it is saving while the write is in progress', async () => {
    const user = userEvent.setup();
    const { services } = renderApp('/medications/new');
    await screen.findByRole('heading', { level: 1, name: 'Dodaj lek' });
    await fillValid(user);
    let finish: () => void = () => undefined;
    const original = services.repositories.medications.create.bind(
      services.repositories.medications,
    );
    vi.spyOn(services.repositories.medications, 'create').mockImplementation(
      (medication) =>
        new Promise((resolve) => {
          finish = () => {
            resolve(original(medication));
          };
        }),
    );

    await user.click(submit('Dodaj lek'));

    const busy = await screen.findByRole('button', { name: 'Zapisywanie…' });
    expect(busy).toBeDisabled();
    expect(busy).toHaveAttribute('aria-busy', 'true');
    expect(await allMedications(services)).toEqual([]);
    finish();
    expect(await screen.findByRole('article', { name: 'Demoxal' })).toBeVisible();
  });

  it('shows a failed save as an error, keeps everything typed, and does not claim success', async () => {
    const user = userEvent.setup();
    const { router, services } = renderApp('/medications/new');
    await screen.findByRole('heading', { level: 1, name: 'Dodaj lek' });
    await fillValid(user);
    await user.type(field(/^Notatki/), 'Po jedzeniu');
    services.storage.failWrites(createQuotaError(), (key) => key === STORAGE_KEYS.medications);

    await user.click(submit('Dodaj lek'));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Nie zapisano leku');
    expect(alert).toHaveTextContent('brakuje miejsca');
    expect(router.state.location.pathname).toBe('/medications/new');
    expect(field(/^Nazwa leku/)).toHaveValue('Demoxal');
    expect(field(/^Notatki/)).toHaveValue('Po jedzeniu');
    expect(screen.queryByText(/Dodano lek/)).not.toBeInTheDocument();
    services.storage.heal();
    expect(await allMedications(services)).toEqual([]);
  });

  it('after a failed save, trying again saves it once, with the same id', async () => {
    const user = userEvent.setup();
    const { services } = renderApp('/medications/new');
    await screen.findByRole('heading', { level: 1, name: 'Dodaj lek' });
    await fillValid(user);
    const create = vi.spyOn(services.repositories.medications, 'create');
    services.storage.failWrites(createQuotaError(), (key) => key === STORAGE_KEYS.medications);
    await user.click(submit('Dodaj lek'));
    await screen.findByRole('alert');

    services.storage.heal();
    await user.click(submit('Dodaj lek'));

    await screen.findByRole('article', { name: 'Demoxal' });
    expect(create).toHaveBeenCalledTimes(2);
    const ids = create.mock.calls.map(([medication]) => medication.id);
    expect(ids[0]).toBe(ids[1]);
    expect(await allMedications(services)).toHaveLength(1);
  });

  it('goes back to the list without saving when cancelled', async () => {
    const user = userEvent.setup();
    const { router, services } = renderApp('/medications/new');
    await screen.findByRole('heading', { level: 1, name: 'Dodaj lek' });
    await fillValid(user);

    await user.click(screen.getByRole('link', { name: 'Anuluj' }));

    expect(router.state.location.pathname).toBe('/medications');
    expect(await allMedications(services)).toEqual([]);
    expect(services.storage.writes).toEqual([]);
  });
});

describe('edit medication', () => {
  const stockCountedAt = asTimestamp('2026-09-01T08:00:00Z');

  async function setup(overrides: Parameters<typeof makeMedication>[0] = {}) {
    const services = createTestServices();
    await services.repositories.medications.create(
      makeMedication({
        id: 'm-1',
        name: 'Demoxal',
        doseUnit: 'tabletka',
        notes: 'Notatka',
        startDate: asLocalDate('2026-01-01'),
        scheduleEffectiveFrom: asLocalDate('2026-03-01'),
        scheduleTimes: [scheduleTime('t-1', '08:00', 1), scheduleTime('t-2', '20:00', 0.5)],
        stock: { quantity: 28, unit: 'tabletka', asOf: stockCountedAt },
        ...overrides,
      }),
    );
    await services.repositories.doseLogs.upsert(
      makeDoseLog({
        id: 'l-1',
        medicationId: 'm-1',
        scheduledDate: asLocalDate('2026-10-01'),
        doseAmount: 2,
        doseUnit: 'tabletka',
      }),
    );
    await services.repositories.doseLogs.upsert(
      makeDoseLog({
        id: 'l-2',
        medicationId: 'm-1',
        scheduledDate: asLocalDate('2026-10-02'),
        status: 'skipped',
        doseAmount: 2,
        doseUnit: 'tabletka',
      }),
    );
    const result = renderApp('/medications/m-1/edit', services);
    await screen.findByRole('heading', { level: 1, name: 'Edytuj lek' });
    await screen.findByDisplayValue('Demoxal');
    return result;
  }

  it('shows the stored values', async () => {
    await setup({ endDate: asLocalDate('2026-12-31') });

    expect(field(/^Nazwa leku/)).toHaveValue('Demoxal');
    expect(field(/^Jednostka dawki/)).toHaveValue('tabletka');
    expect(timeField(1)).toHaveValue('08:00');
    expect(field(/^Dawka 1/)).toHaveValue('1');
    expect(timeField(2)).toHaveValue('20:00');
    expect(field(/^Dawka 2/)).toHaveValue('0,5');
    expect(screen.getByLabelText(/^Data rozpoczęcia/)).toHaveValue('2026-01-01');
    expect(screen.getByLabelText(/^Data zakończenia/)).toHaveValue('2026-12-31');
    expect(field(/^Aktualny zapas/)).toHaveValue('28');
    expect(field(/^Notatki/)).toHaveValue('Notatka');
  });

  describe('regression: schedule dates and history', () => {
    it('does NOT touch scheduleEffectiveFrom when only the name is changed', async () => {
      const user = userEvent.setup();
      const { services } = await setup();
      await user.clear(field(/^Nazwa leku/));
      await user.type(field(/^Nazwa leku/), 'Nowa nazwa');

      await user.click(submit('Zapisz zmiany'));

      expect(await screen.findByText('Zapisano zmiany w leku „Nowa nazwa”.')).toBeVisible();
      const saved = await services.repositories.medications.get('m-1');
      expect(saved.name).toBe('Nowa nazwa');
      expect(saved.scheduleEffectiveFrom).toBe('2026-03-01');
      expect(saved.scheduleTimes.map((entry) => entry.id)).toEqual(['t-1', 't-2']);
      expect(saved.createdAt).toBe(makeMedication().createdAt);
    });

    it('does NOT touch scheduleEffectiveFrom when notes or the end date change', async () => {
      const user = userEvent.setup();
      const { services } = await setup();
      await user.type(field(/^Notatki/), ' i więcej');
      fireEvent.change(screen.getByLabelText(/^Data zakończenia/), {
        target: { value: '2027-01-31' },
      });

      await user.click(submit('Zapisz zmiany'));

      await screen.findByText(/Zapisano zmiany/);
      const saved = await services.repositories.medications.get('m-1');
      expect(saved).toMatchObject({
        notes: 'Notatka i więcej',
        endDate: '2027-01-31',
        scheduleEffectiveFrom: '2026-03-01',
      });
    });

    it('moves scheduleEffectiveFrom to today when a time is added', async () => {
      const user = userEvent.setup();
      const { services } = await setup();
      await user.click(screen.getByRole('button', { name: 'Dodaj godzinę' }));
      setTime(3, '13:00');
      await user.type(field(/^Dawka 3/), '1');

      await user.click(submit('Zapisz zmiany'));

      await screen.findByText(/Zapisano zmiany/);
      const saved = await services.repositories.medications.get('m-1');
      expect(saved.scheduleEffectiveFrom).toBe('2026-10-15');
      expect(saved.scheduleTimes).toHaveLength(3);
      expect(saved.scheduleTimes.slice(0, 2).map((entry) => entry.id)).toEqual(['t-1', 't-2']);
    });

    it.each([
      [
        'a time is changed',
        () => {
          setTime(1, '09:00');
        },
      ],
      [
        'an amount is changed',
        async (user: UserEvent) => {
          await user.clear(field(/^Dawka 1/));
          await user.type(field(/^Dawka 1/), '2');
        },
      ],
      [
        'a time is removed',
        async (user: UserEvent) => {
          await user.click(screen.getByRole('button', { name: 'Usuń godzinę 2' }));
        },
      ],
    ])('moves scheduleEffectiveFrom to today when %s', async (_label, change) => {
      const user = userEvent.setup();
      const { services } = await setup();
      await change(user);

      await user.click(submit('Zapisz zmiany'));

      await screen.findByText(/Zapisano zmiany/);
      expect((await services.repositories.medications.get('m-1')).scheduleEffectiveFrom).toBe(
        '2026-10-15',
      );
    });

    it('leaves every intake record exactly as it was, with its recorded amount and unit, after the schedule and the unit are edited', async () => {
      const user = userEvent.setup();
      const { services } = await setup();
      const logsBefore = await allLogs(services);
      await user.clear(field(/^Jednostka dawki/));
      await user.type(field(/^Jednostka dawki/), 'kapsułka');
      await user.clear(field(/^Dawka 1/));
      await user.type(field(/^Dawka 1/), '3');
      setTime(2, '21:30');

      await user.click(submit('Zapisz zmiany'));

      await screen.findByText(/Zapisano zmiany/);
      expect(await allLogs(services)).toEqual(logsBefore);
      expect(logsBefore.map((log) => [log.doseAmount, log.doseUnit])).toEqual([
        [2, 'tabletka'],
        [2, 'tabletka'],
      ]);
      const saved = await services.repositories.medications.get('m-1');
      expect(saved.doseUnit).toBe('kapsułka');
    });
  });

  describe('stock while editing', () => {
    it('keeps the stock, and when it was counted, if its quantity is not touched', async () => {
      const user = userEvent.setup();
      const { services } = await setup();
      await user.type(field(/^Nazwa leku/), '2');

      await user.click(submit('Zapisz zmiany'));

      await screen.findByText(/Zapisano zmiany/);
      expect((await services.repositories.medications.get('m-1')).stock).toEqual({
        quantity: 28,
        unit: 'tabletka',
        asOf: '2026-09-01T08:00:00.000Z',
      });
    });

    it('starts counting from now when the quantity is changed', async () => {
      const user = userEvent.setup();
      const { services } = await setup();
      await user.clear(field(/^Aktualny zapas/));
      await user.type(field(/^Aktualny zapas/), '20');

      await user.click(submit('Zapisz zmiany'));

      await screen.findByText(/Zapisano zmiany/);
      expect((await services.repositories.medications.get('m-1')).stock).toEqual({
        quantity: 20,
        unit: 'tabletka',
        asOf: '2026-10-15T10:00:00.000Z',
      });
    });

    it('removes the stock when the field is cleared', async () => {
      const user = userEvent.setup();
      const { services } = await setup();
      await user.clear(field(/^Aktualny zapas/));

      await user.click(submit('Zapisz zmiany'));

      await screen.findByText(/Zapisano zmiany/);
      expect((await services.repositories.medications.get('m-1')).stock).toBeNull();
    });

    it('warns, and does not silently reinterpret the stock, when only the dose unit changes', async () => {
      const user = userEvent.setup();
      const { services } = await setup();
      await user.clear(field(/^Jednostka dawki/));
      await user.type(field(/^Jednostka dawki/), 'ml');

      expect(
        screen.getByText(/Zapas jest zapisany w jednostce „tabletka”, a jednostka dawki to „ml”/),
      ).toBeVisible();
      await user.click(submit('Zapisz zmiany'));
      await screen.findByText(/Zapisano zmiany/);

      expect((await services.repositories.medications.get('m-1')).stock?.unit).toBe('tabletka');
      expect(
        await screen.findByText(/jednostka zapasu różni się od jednostki dawki/),
      ).toBeVisible();
    });

    it('does not warn when the unit is the same', async () => {
      await setup();

      expect(screen.queryByText(/Zapas jest zapisany w jednostce/)).not.toBeInTheDocument();
    });
  });

  describe('saving and failing', () => {
    it('shows a failed save as an error, keeps the edits and changes nothing', async () => {
      const user = userEvent.setup();
      const { router, services } = await setup();
      await user.clear(field(/^Nazwa leku/));
      await user.type(field(/^Nazwa leku/), 'Nowa nazwa');
      const before = await services.repositories.medications.get('m-1');
      services.storage.failWrites(createQuotaError(), (key) => key === STORAGE_KEYS.medications);

      await user.click(submit('Zapisz zmiany'));

      const alert = await screen.findByRole('alert');
      expect(alert).toHaveTextContent('Nie zapisano leku');
      expect(router.state.location.pathname).toBe('/medications/m-1/edit');
      expect(field(/^Nazwa leku/)).toHaveValue('Nowa nazwa');
      expect(screen.queryByText(/Zapisano zmiany/)).not.toBeInTheDocument();
      services.storage.heal();
      expect(await services.repositories.medications.get('m-1')).toEqual(before);
    });

    it('writes once when the button is clicked twice quickly', async () => {
      const user = userEvent.setup();
      const { services } = await setup();
      const update = vi.spyOn(services.repositories.medications, 'update');

      await user.dblClick(submit('Zapisz zmiany'));

      await screen.findByText(/Zapisano zmiany/);
      expect(update).toHaveBeenCalledTimes(1);
    });

    it('leaves everything as it was when cancelled', async () => {
      const user = userEvent.setup();
      const { router, services } = await setup();
      const before = await services.repositories.medications.get('m-1');
      await user.clear(field(/^Nazwa leku/));
      await user.type(field(/^Nazwa leku/), 'Zmieniona');

      await user.click(screen.getByRole('link', { name: 'Anuluj' }));

      expect(router.state.location.pathname).toBe('/medications');
      expect(await services.repositories.medications.get('m-1')).toEqual(before);
    });

    it('validates the same way as when adding', async () => {
      const user = userEvent.setup();
      const { services } = await setup();
      const before = await services.repositories.medications.get('m-1');
      await user.clear(field(/^Nazwa leku/));
      await user.clear(field(/^Dawka 1/));

      await user.click(submit('Zapisz zmiany'));

      await waitFor(() => {
        expect(field(/^Nazwa leku/)).toBeInvalid();
      });
      expect(field(/^Dawka 1/)).toBeInvalid();
      expect(await services.repositories.medications.get('m-1')).toEqual(before);
    });
  });
});

describe('edit medication: loading problems', () => {
  it('says so, with a way back, when the medication does not exist', async () => {
    const user = userEvent.setup();
    const { router } = renderApp('/medications/ghost/edit');

    expect(await screen.findByRole('heading', { name: 'Nie znaleziono leku' })).toBeVisible();
    await user.click(screen.getByRole('link', { name: 'Wróć do listy leków' }));

    expect(router.state.location.pathname).toBe('/medications');
  });

  it('shows a loading indicator first', () => {
    renderApp('/medications/m-1/edit');

    expect(screen.getByText('Wczytywanie leku…')).toBeVisible();
  });

  it('shows another failure as an error with a retry that works once the problem is gone', async () => {
    const user = userEvent.setup();
    const services = createTestServices();
    await services.repositories.medications.create(makeMedication({ id: 'm-1', name: 'Demoxal' }));
    services.storage.failReads();
    renderApp('/medications/m-1/edit', services);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Nie udało się wczytać leku');
    expect(screen.queryByRole('heading', { name: 'Nie znaleziono leku' })).not.toBeInTheDocument();

    services.storage.heal();
    await user.click(screen.getByRole('button', { name: 'Spróbuj ponownie' }));

    expect(await screen.findByDisplayValue('Demoxal')).toBeVisible();
  });

  it('treats a repository error thrown while saving as unexpected-free: a RepositoryError keeps its Polish message', async () => {
    const user = userEvent.setup();
    const services = createTestServices();
    await services.repositories.medications.create(makeMedication({ id: 'm-1', name: 'Demoxal' }));
    renderApp('/medications/m-1/edit', services);
    await screen.findByDisplayValue('Demoxal');
    vi.spyOn(services.repositories.medications, 'update').mockRejectedValue(
      new RepositoryError('not-found'),
    );

    await user.click(submit('Zapisz zmiany'));

    expect(await screen.findByRole('alert')).toHaveTextContent('Nie znaleziono takiego rekordu.');
  });
});

describe('the list reflects what the forms save', () => {
  it('shows an added medication in the list, and an edited one with its new details', async () => {
    const user = userEvent.setup();
    const { router, services } = renderApp('/medications/new');
    await screen.findByRole('heading', { level: 1, name: 'Dodaj lek' });
    await fillValid(user);
    await user.click(submit('Dodaj lek'));
    const card = await screen.findByRole('article', { name: 'Demoxal' });
    expect(within(card).getByText('08:00 — 1 tabletka')).toBeVisible();

    await user.click(within(card).getByRole('link', { name: 'Edytuj lek Demoxal' }));
    expect(router.state.location.pathname).toMatch(/^\/medications\/.+\/edit$/);
    await screen.findByDisplayValue('Demoxal');
    await user.clear(field(/^Dawka 1/));
    await user.type(field(/^Dawka 1/), '2');
    await user.click(submit('Zapisz zmiany'));

    const updated = await screen.findByRole('article', { name: 'Demoxal' });
    expect(within(updated).getByText('08:00 — 2 tabletka')).toBeVisible();
    expect(await allMedications(services)).toHaveLength(1);
  });
});
