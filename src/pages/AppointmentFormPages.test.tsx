import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { ServicesProvider } from '@/app/ServicesProvider';
import { routes } from '@/app/routes';
import { STORAGE_KEYS } from '@/services/local/collections';
import type { AppServices } from '@/services/repositories';
import { createFakeStorage } from '@/test/fakeStorage';
import { makeAppointment } from '@/test/fixtures';
import { createDeferred, createTestServices } from '@/test/services';
import { asTimestamp } from '@/utils/date';

// The test clock says 12:00 on Thursday 15 October 2026 in Warsaw (summer time, UTC+2).

type TestServices = ReturnType<typeof createTestServices>;

function renderApp(services: TestServices = createTestServices(), entry = '/appointments/new') {
  const router = createMemoryRouter(routes, { initialEntries: [entry] });
  render(
    <ServicesProvider services={services}>
      <RouterProvider router={router} />
    </ServicesProvider>,
  );
  return { router, services };
}

const field = (label: string | RegExp) => screen.getByLabelText(label);
const submit = (name: string) => screen.getByRole('button', { name });
const all = (services: AppServices) => services.repositories.appointments.list();

/** Types a valid appointment: doctor, date and time. */
async function fillValid(
  user: ReturnType<typeof userEvent.setup>,
  { doctor = 'dr Nowak', date = '2026-10-20', time = '10:00' } = {},
) {
  await user.type(field(/^Lekarz/), doctor);
  fireEvent.change(field(/^Data wizyty/), { target: { value: date } });
  fireEvent.change(field(/^Godzina wizyty/), { target: { value: time } });
}

describe('add appointment: the form', () => {
  it('starts empty, with no date or time pre-filled, and says what is required', async () => {
    renderApp();

    expect(await screen.findByRole('heading', { level: 1, name: 'Dodaj wizytę' })).toBeVisible();
    expect(field(/^Lekarz/)).toHaveValue('');
    expect(field(/^Specjalizacja/)).toHaveValue('');
    expect(field(/^Data wizyty/)).toHaveValue('');
    expect(field(/^Godzina wizyty/)).toHaveValue('');
    expect(screen.getByText(/wystarczy jedno z nich/)).toBeVisible();
    expect(document.title).toBe('Dodaj wizytę – Pigoowa');
  });

  it('shows every problem next to its field, focuses the first one, writes nothing, and ties the errors to the fields', async () => {
    const user = userEvent.setup();
    const { services } = renderApp();

    await user.click(submit('Dodaj wizytę'));

    const doctor = field(/^Lekarz/);
    const specialty = field(/^Specjalizacja/);
    const date = field(/^Data wizyty/);
    const time = field(/^Godzina wizyty/);
    await waitFor(() => {
      expect(doctor).toBeInvalid();
    });
    for (const input of [doctor, specialty]) {
      expect(input).toBeInvalid();
      expect(input).toHaveAccessibleDescription(
        'Wpisz lekarza lub specjalizację (wystarczy jedno z nich).',
      );
    }
    expect(date).toHaveAccessibleDescription('Wybierz poprawną datę wizyty.');
    expect(time).toHaveAccessibleDescription(
      expect.stringContaining('Wpisz godzinę wizyty w formacie GG:MM, na przykład 10:30.'),
    );
    expect(doctor).toHaveFocus();
    expect(await all(services)).toEqual([]);
  });

  it('accepts a doctor alone, and a specialty alone', async () => {
    const user = userEvent.setup();
    const { services } = renderApp();
    await user.type(field(/^Lekarz/), 'dr Nowak');
    fireEvent.change(field(/^Data wizyty/), { target: { value: '2026-10-20' } });
    fireEvent.change(field(/^Godzina wizyty/), { target: { value: '10:00' } });
    await user.click(submit('Dodaj wizytę'));
    await screen.findByRole('heading', { level: 1, name: 'Wizyty' });
    cleanup();

    renderApp(services);
    await user.type(field(/^Specjalizacja/), 'Okulista');
    fireEvent.change(field(/^Data wizyty/), { target: { value: '2026-10-21' } });
    fireEvent.change(field(/^Godzina wizyty/), { target: { value: '11:00' } });
    await user.click(submit('Dodaj wizytę'));
    await screen.findByRole('heading', { level: 1, name: 'Wizyty' });

    expect((await all(services)).map((entry) => [entry.doctorName, entry.specialty])).toEqual([
      ['dr Nowak', null],
      [null, 'Okulista'],
    ]);
  });

  it('refuses text that is only spaces as a doctor or specialty', async () => {
    const user = userEvent.setup();
    const { services } = renderApp();
    await user.type(field(/^Lekarz/), '   ');
    await user.type(field(/^Specjalizacja/), '  ');
    fireEvent.change(field(/^Data wizyty/), { target: { value: '2026-10-20' } });
    fireEvent.change(field(/^Godzina wizyty/), { target: { value: '10:00' } });

    await user.click(submit('Dodaj wizytę'));

    expect(await screen.findAllByText(/Wpisz lekarza lub specjalizację/)).toHaveLength(2);
    expect(await all(services)).toEqual([]);
  });

  it('keeps everything typed when validation fails, and clears an error once it is fixed', async () => {
    const user = userEvent.setup();
    renderApp();
    await user.type(field(/^Specjalizacja/), 'Kardiolog');
    await user.type(field(/^Miejsce/), 'Gabinet 5');
    await user.type(field(/^Notatki/), 'Wyniki badań');

    await user.click(submit('Dodaj wizytę'));

    await waitFor(() => {
      expect(field(/^Data wizyty/)).toBeInvalid();
    });
    expect(field(/^Specjalizacja/)).toHaveValue('Kardiolog');
    expect(field(/^Miejsce/)).toHaveValue('Gabinet 5');
    expect(field(/^Notatki/)).toHaveValue('Wyniki badań');
    fireEvent.change(field(/^Data wizyty/), { target: { value: '2026-10-20' } });
    await waitFor(() => {
      expect(field(/^Data wizyty/)).toBeValid();
    });
  });

  it.each([
    [
      'a doctor name over 120 characters',
      'Lekarz',
      'x'.repeat(121),
      'Nazwa lekarza może mieć najwyżej 120 znaków.',
    ],
    [
      'a specialty over 120 characters',
      'Specjalizacja',
      'x'.repeat(121),
      'Specjalizacja może mieć najwyżej 120 znaków.',
    ],
    [
      'a place over 200 characters',
      'Miejsce',
      'x'.repeat(201),
      'Miejsce może mieć najwyżej 200 znaków.',
    ],
    [
      'notes over 1000 characters',
      'Notatki',
      'x'.repeat(1001),
      'Notatki mogą mieć najwyżej 1000 znaków.',
    ],
  ])('refuses %s', async (_name, label, text, message) => {
    const user = userEvent.setup();
    const { services } = renderApp();
    await fillValid(user);
    fireEvent.change(field(new RegExp(`^${label}`)), { target: { value: text } });

    await user.click(submit('Dodaj wizytę'));

    expect(await screen.findByText(message)).toBeVisible();
    expect(await all(services)).toEqual([]);
  });

  it('refuses a time that does not exist because the clocks jump forward', async () => {
    const user = userEvent.setup();
    const { services } = renderApp();
    await fillValid(user, { date: '2026-03-29', time: '02:30' });

    await user.click(submit('Dodaj wizytę'));

    expect(
      await screen.findByText(
        'Tej godziny nie ma w wybranym dniu z powodu zmiany czasu. Wybierz inną godzinę.',
      ),
    ).toBeVisible();
    expect(field(/^Godzina wizyty/)).toBeInvalid();
    expect(await all(services)).toEqual([]);
  });

  it('warns about a time that happens twice when the clocks go back, and saves the earlier one', async () => {
    const user = userEvent.setup();
    const { services } = renderApp();
    await fillValid(user, { date: '2026-10-25', time: '02:30' });

    expect(await screen.findByText(/ta godzina występuje dwa razy/)).toBeVisible();
    await user.click(submit('Dodaj wizytę'));
    await screen.findByRole('heading', { level: 1, name: 'Wizyty' });

    expect((await all(services))[0]?.scheduledAt).toBe('2026-10-25T00:30:00.000Z');
  });

  it('does not warn about an ordinary time', async () => {
    const user = userEvent.setup();
    renderApp();
    await fillValid(user);
    expect(screen.queryByText(/występuje dwa razy/)).not.toBeInTheDocument();
  });
});

describe('add appointment: saving', () => {
  it('saves one scheduled appointment, tells the user, and lists it under Upcoming', async () => {
    const user = userEvent.setup();
    const { services, router } = renderApp();
    await fillValid(user);
    await user.type(field(/^Specjalizacja/), '  Kardiolog ');
    await user.type(field(/^Miejsce/), 'Gabinet 5');

    await user.click(submit('Dodaj wizytę'));

    expect(await screen.findByText('Dodano wizytę: dr Nowak.')).toBeVisible();
    expect(router.state.location.pathname).toBe('/appointments');
    expect(router.state.location.search).toBe('');
    expect(await all(services)).toEqual([
      expect.objectContaining({
        doctorName: 'dr Nowak',
        specialty: 'Kardiolog',
        location: 'Gabinet 5',
        notes: null,
        status: 'scheduled',
        scheduledAt: '2026-10-20T08:00:00.000Z', // 10:00 in Warsaw
        createdAt: '2026-10-15T10:00:00.000Z',
        updatedAt: '2026-10-15T10:00:00.000Z',
      }),
    ]);
    expect(await screen.findByRole('tab', { name: 'Nadchodzące (1)' })).toBeVisible();
  });

  it('takes the user to the Past tab when the date is already past, where it waits for confirmation', async () => {
    const user = userEvent.setup();
    const { services, router } = renderApp();
    await fillValid(user, { date: '2026-10-01', time: '09:00' });

    await user.click(submit('Dodaj wizytę'));

    expect(await screen.findByText('Do potwierdzenia')).toBeVisible();
    expect(router.state.location.search).toBe('?tab=past');
    expect((await all(services))[0]?.status).toBe('scheduled'); // not completed automatically
  });

  it('shows the notice only once (it is gone after a reload of the list)', async () => {
    const user = userEvent.setup();
    const { services } = renderApp();
    await fillValid(user);
    await user.click(submit('Dodaj wizytę'));
    await screen.findByText('Dodano wizytę: dr Nowak.');
    cleanup();

    renderApp(services, '/appointments');

    expect(await screen.findByRole('tab', { name: 'Nadchodzące (1)' })).toBeVisible();
    expect(screen.queryByText('Dodano wizytę: dr Nowak.')).not.toBeInTheDocument();
  });

  it('shows a failed save as an error with the input kept, and a retry then saves exactly one', async () => {
    const user = userEvent.setup();
    const { services, router } = renderApp();
    await fillValid(user);
    services.storage.failWrites();

    await user.click(submit('Dodaj wizytę'));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Nie zapisano wizyty');
    expect(alert).toHaveTextContent('Zmiany nie zostały zapisane');
    expect(router.state.location.pathname).toBe('/appointments/new');
    expect(field(/^Lekarz/)).toHaveValue('dr Nowak');
    expect(field(/^Data wizyty/)).toHaveValue('2026-10-20');
    expect(field(/^Godzina wizyty/)).toHaveValue('10:00');
    services.storage.heal();
    expect(await all(services)).toEqual([]);

    await user.click(submit('Dodaj wizytę'));
    expect(await screen.findByText('Dodano wizytę: dr Nowak.')).toBeVisible();
    expect(await all(services)).toHaveLength(1);
  });

  it('shows damaged storage as an error and does not overwrite it', async () => {
    const user = userEvent.setup();
    const services = createTestServices(
      createFakeStorage({ [STORAGE_KEYS.appointments]: '{broken' }),
    );
    renderApp(services);
    await fillValid(user);

    await user.click(submit('Dodaj wizytę'));

    expect(await screen.findByRole('alert')).toHaveTextContent('Zapisane dane są uszkodzone');
    expect(services.storage.data.get(STORAGE_KEYS.appointments)).toBe('{broken');
  });

  it('a double submit creates one appointment, and the button shows it is saving', async () => {
    const user = userEvent.setup();
    const services = createTestServices();
    const gate = createDeferred<undefined>();
    const create = services.repositories.appointments.create.bind(
      services.repositories.appointments,
    );
    const spy = vi
      .spyOn(services.repositories.appointments, 'create')
      .mockImplementation(async (entry) => {
        await gate.promise;
        return create(entry);
      });
    renderApp(services);
    await fillValid(user);

    await user.dblClick(submit('Dodaj wizytę'));

    const busy = await screen.findByRole('button', { name: 'Zapisywanie…' });
    expect(busy).toBeDisabled();
    expect(busy).toHaveAttribute('aria-busy', 'true');
    gate.resolve(undefined);
    await screen.findByText('Dodano wizytę: dr Nowak.');
    expect(spy).toHaveBeenCalledTimes(1);
    expect(await all(services)).toHaveLength(1);
  });

  it('cancelling goes back to the list and writes nothing', async () => {
    const user = userEvent.setup();
    const { router, services } = renderApp();
    await fillValid(user);

    await user.click(screen.getByRole('link', { name: 'Anuluj' }));

    expect(router.state.location.pathname).toBe('/appointments');
    expect(await all(services)).toEqual([]);
  });

  it('can be filled in and submitted with the keyboard alone', async () => {
    const user = userEvent.setup();
    const { services } = renderApp();
    field(/^Lekarz/).focus();

    await user.keyboard('dr Nowak');
    fireEvent.change(field(/^Data wizyty/), { target: { value: '2026-10-20' } });
    fireEvent.change(field(/^Godzina wizyty/), { target: { value: '10:00' } });
    submit('Dodaj wizytę').focus();
    await user.keyboard('{Enter}');

    expect(await screen.findByText('Dodano wizytę: dr Nowak.')).toBeVisible();
    expect(await all(services)).toHaveLength(1);
  });
});

describe('edit appointment', () => {
  const original = {
    id: 'a-1',
    doctorName: 'dr Nowak',
    specialty: 'Kardiolog',
    location: 'Gabinet 5',
    notes: 'Wyniki badań',
    scheduledAt: asTimestamp('2026-10-20T08:00:00.000Z'),
    status: 'completed' as const,
    createdAt: asTimestamp('2026-10-01T08:00:00.000Z'),
    updatedAt: asTimestamp('2026-10-02T08:00:00.000Z'),
  };
  const open = async () => {
    const services = createTestServices();
    await services.repositories.appointments.create(makeAppointment(original));
    return renderApp(services, '/appointments/a-1/edit');
  };

  it('opens with the stored values, the time as the wall clock in the zone shows it', async () => {
    await open();

    expect(await screen.findByDisplayValue('dr Nowak')).toBeVisible();
    expect(field(/^Specjalizacja/)).toHaveValue('Kardiolog');
    expect(field(/^Data wizyty/)).toHaveValue('2026-10-20');
    expect(field(/^Godzina wizyty/)).toHaveValue('10:00');
    expect(field(/^Miejsce/)).toHaveValue('Gabinet 5');
    expect(field(/^Notatki/)).toHaveValue('Wyniki badań');
    expect(screen.getByRole('heading', { level: 1, name: 'Edytuj wizytę' })).toBeVisible();
  });

  it('saves the change, keeping the id, the status and the creation time, and does not touch other appointments', async () => {
    const user = userEvent.setup();
    const { services } = await open();
    await services.repositories.appointments.create(makeAppointment({ id: 'a-2' }));
    const otherBefore = await services.repositories.appointments.get('a-2');
    await screen.findByDisplayValue('dr Nowak');

    await user.clear(field(/^Miejsce/));
    await user.type(field(/^Miejsce/), 'Gabinet 7');
    await user.click(submit('Zapisz zmiany'));

    expect(await screen.findByText('Zapisano zmiany w wizycie: dr Nowak.')).toBeVisible();
    expect(await services.repositories.appointments.get('a-1')).toEqual({
      ...original,
      location: 'Gabinet 7',
      updatedAt: asTimestamp('2026-10-15T10:00:00.000Z'),
    });
    expect(await services.repositories.appointments.get('a-2')).toEqual(otherBefore);
    expect((await all(services)).filter((entry) => entry.id === 'a-1')).toHaveLength(1);
  });

  it('moves the appointment when the date or time is changed, and clears a field that was emptied', async () => {
    const user = userEvent.setup();
    const { services } = await open();
    await screen.findByDisplayValue('dr Nowak');

    fireEvent.change(field(/^Data wizyty/), { target: { value: '2026-11-03' } });
    fireEvent.change(field(/^Godzina wizyty/), { target: { value: '15:45' } });
    await user.clear(field(/^Notatki/));
    await user.click(submit('Zapisz zmiany'));
    await screen.findByText(/Zapisano zmiany/);

    expect(await services.repositories.appointments.get('a-1')).toMatchObject({
      scheduledAt: '2026-11-03T14:45:00.000Z', // winter time again: 15:45 is UTC+1
      notes: null,
    });
  });

  it('says so, and writes nothing, when nothing was changed', async () => {
    const user = userEvent.setup();
    const { services } = await open();
    await screen.findByDisplayValue('dr Nowak');
    const writesBefore = services.storage.writes.length;

    await user.click(submit('Zapisz zmiany'));

    expect(await screen.findByText('Nie wprowadzono zmian w wizycie: dr Nowak.')).toBeVisible();
    expect(services.storage.writes).toHaveLength(writesBefore);
  });

  it('does not undo a status that was changed elsewhere while the form was open', async () => {
    const user = userEvent.setup();
    const { services } = await open();
    await screen.findByDisplayValue('dr Nowak');
    await services.repositories.appointments.update(
      makeAppointment({ ...original, status: 'scheduled' }),
    );

    await user.type(field(/^Notatki/), ' Nowe');
    await user.click(submit('Zapisz zmiany'));
    await screen.findByText(/Zapisano zmiany/);

    expect(await services.repositories.appointments.get('a-1')).toMatchObject({
      status: 'scheduled',
      notes: 'Wyniki badań Nowe',
    });
  });

  it('shows the same validation problems as the add form, keeps the input, and writes nothing', async () => {
    const user = userEvent.setup();
    const { services } = await open();
    await screen.findByDisplayValue('dr Nowak');

    await user.clear(field(/^Lekarz/));
    await user.clear(field(/^Specjalizacja/));
    await user.type(field(/^Miejsce/), ' dopisek');
    await user.click(submit('Zapisz zmiany'));

    expect(await screen.findAllByText(/Wpisz lekarza lub specjalizację/)).toHaveLength(2);
    expect(field(/^Lekarz/)).toHaveFocus();
    expect(field(/^Miejsce/)).toHaveValue('Gabinet 5 dopisek');
    expect(await services.repositories.appointments.get('a-1')).toEqual(original);
  });

  it('shows a failed save as an error with the input kept, and the stored appointment unchanged', async () => {
    const user = userEvent.setup();
    const { services, router } = await open();
    await screen.findByDisplayValue('dr Nowak');
    await user.type(field(/^Notatki/), ' dopisek');
    services.storage.failWrites();

    await user.click(submit('Zapisz zmiany'));

    expect(await screen.findByRole('alert')).toHaveTextContent('Nie zapisano wizyty');
    expect(field(/^Notatki/)).toHaveValue('Wyniki badań dopisek');
    expect(router.state.location.pathname).toBe('/appointments/a-1/edit');
    services.storage.heal();
    expect(await services.repositories.appointments.get('a-1')).toEqual(original);
  });

  it('a double submit saves once', async () => {
    const user = userEvent.setup();
    const { services } = await open();
    await screen.findByDisplayValue('dr Nowak');
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
    await user.type(field(/^Notatki/), ' x');

    await user.dblClick(submit('Zapisz zmiany'));
    expect(await screen.findByRole('button', { name: 'Zapisywanie…' })).toBeDisabled();
    gate.resolve(undefined);

    await screen.findByText(/Zapisano zmiany/);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('says so for an appointment that does not exist, with a way back', async () => {
    const user = userEvent.setup();
    const { router } = renderApp(createTestServices(), '/appointments/missing/edit');

    expect(await screen.findByRole('heading', { name: 'Nie znaleziono wizyty' })).toBeVisible();
    await user.click(screen.getByRole('link', { name: 'Wróć do listy wizyt' }));
    expect(router.state.location.pathname).toBe('/appointments');
  });

  it('shows a loading failure as an error with a retry, not as "not found"', async () => {
    const user = userEvent.setup();
    const services = createTestServices(
      createFakeStorage({ [STORAGE_KEYS.appointments]: '{broken' }),
    );
    renderApp(services, '/appointments/a-1/edit');

    expect(await screen.findByRole('alert')).toHaveTextContent('Nie udało się wczytać wizyty');
    expect(screen.queryByText('Nie znaleziono wizyty')).not.toBeInTheDocument();
    services.storage.data.set(
      STORAGE_KEYS.appointments,
      JSON.stringify({ version: 1, items: [makeAppointment(original)] }),
    );
    await user.click(screen.getByRole('button', { name: 'Spróbuj ponownie' }));

    expect(await screen.findByDisplayValue('dr Nowak')).toBeVisible();
  });

  it('keeps the exact instant of a visit at the second 02:30 when only something else is edited', async () => {
    const user = userEvent.setup();
    const services = createTestServices();
    await services.repositories.appointments.create(
      makeAppointment({
        id: 'late',
        scheduledAt: asTimestamp('2026-10-25T01:30:00.000Z'),
        location: null,
      }),
    );
    renderApp(services, '/appointments/late/edit');
    await screen.findByDisplayValue('dr Nowak');
    expect(field(/^Godzina wizyty/)).toHaveValue('02:30');

    await user.type(field(/^Miejsce/), 'Nowe miejsce');
    await user.click(submit('Zapisz zmiany'));
    await screen.findByText(/Zapisano zmiany/);

    expect(await services.repositories.appointments.get('late')).toMatchObject({
      location: 'Nowe miejsce',
      scheduledAt: '2026-10-25T01:30:00.000Z',
    });
  });

  it('shows the edited appointment in the list afterwards', async () => {
    const user = userEvent.setup();
    const { services } = await open();
    await screen.findByDisplayValue('dr Nowak');
    fireEvent.change(field(/^Data wizyty/), { target: { value: '2026-10-01' } });
    await user.click(submit('Zapisz zmiany'));

    // Now in the past, still marked completed: the Past tab.
    const card = (await screen.findByText('dr Nowak')).closest('li');
    if (card === null) throw new Error('no card');
    expect(within(card).getByText('Odbyła się')).toBeVisible();
    expect((await services.repositories.appointments.get('a-1')).status).toBe('completed');
  });
});
