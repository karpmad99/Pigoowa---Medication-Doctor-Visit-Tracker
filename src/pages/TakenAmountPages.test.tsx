import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it } from 'vitest';
import { ServicesProvider } from '@/app/ServicesProvider';
import { routes } from '@/app/routes';
import { STORAGE_KEYS } from '@/services/local/collections';
import { createQuotaError } from '@/test/fakeStorage';
import { makeDoseLog, makeMedication, scheduleTime } from '@/test/fixtures';
import { createTestServices } from '@/test/services';
import { asLocalDate, asLocalTime, asTimestamp } from '@/utils/date';

// F8: the amount actually taken and the note, through the real screens and repositories over a
// fake storage. The test clock says 12:00 on 15 October 2026 in Warsaw (2026-10-15T10:00:00Z).

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

const TODAY = asLocalDate('2026-10-15');
const COUNTED = asTimestamp('2026-10-01T08:00:00Z');
const NOW = '2026-10-15T10:00:00.000Z';
const WIDE = [asLocalDate('2000-01-01'), asLocalDate('2999-12-31')] as const;

/** One medication with doses today at 08:00 (1 tablet) and 20:00 (2 tablets), and a stock of 20. */
async function seed(extra: Parameters<typeof makeMedication>[0] = {}): Promise<Services> {
  const services = createTestServices();
  await services.repositories.medications.create(
    makeMedication({
      id: 'm-1',
      name: 'Demoxal',
      startDate: asLocalDate('2026-01-01'),
      scheduleEffectiveFrom: asLocalDate('2026-03-01'),
      scheduleTimes: [scheduleTime('t-1', '08:00', 1), scheduleTime('t-2', '20:00', 2)],
      stock: { quantity: 20, unit: 'tabletka', asOf: COUNTED },
      ...extra,
    }),
  );
  return services;
}

const logs = (services: Services) => services.repositories.doseLogs.listByDateRange(...WIDE);
const dialog = () => within(screen.getByRole('dialog'));
const rowItem = (time: string) =>
  screen
    .queryAllByRole('listitem')
    .find((item) => item.querySelector('time')?.textContent === time);
/** The row of the dose at `time`, once it is there (the page loads asynchronously). */
const row = async (time: string) => {
  await waitFor(() => {
    expect(rowItem(time)).toBeDefined();
  });
  const found = rowItem(time);
  if (found === undefined) throw new Error(`No dose row at ${time}`);
  return within(found);
};
const panel = (name: string) => screen.findByRole('region', { name });

async function openOtherAmount(user: ReturnType<typeof userEvent.setup>, time = '08:00') {
  await user.click(
    await screen.findByRole('button', { name: `Przyjęto inną ilość: Demoxal, ${time}` }),
  );
  return dialog();
}

describe('the usual way of recording a dose is not made harder', () => {
  it('"Oznacz jako przyjętą" still records the plan in one tap, with no dialog and no new field', async () => {
    const user = userEvent.setup();
    const services = await seed();
    renderApp('/', services);

    await user.click(
      await screen.findByRole('button', { name: 'Oznacz jako przyjętą: Demoxal, 08:00' }),
    );

    await waitFor(async () => {
      expect(await logs(services)).toHaveLength(1);
    });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    const [log] = await logs(services);
    expect(log).toMatchObject({ status: 'taken', doseAmount: 1, recordedAt: NOW });
    expect(log && 'takenAmount' in log).toBe(false);
    expect(log && 'note' in log).toBe(false);
    expect(await screen.findByText('Zapisano jako przyjętą: Demoxal, 08:00.')).toBeVisible();
  });

  it('offers the other amount as a quiet extra next to the two usual buttons, not instead of them', async () => {
    const services = await seed();
    renderApp('/', services);

    const first = await row('08:00');
    expect(
      first.getByRole('button', { name: 'Oznacz jako przyjętą: Demoxal, 08:00' }),
    ).toBeVisible();
    expect(
      first.getByRole('button', { name: 'Oznacz jako pominiętą: Demoxal, 08:00' }),
    ).toBeVisible();
    expect(
      first.getByRole('button', { name: 'Przyjęto inną ilość: Demoxal, 08:00' }),
    ).toBeVisible();
  });
});

describe('recording a dose with the amount actually taken', () => {
  it('a LARGER amount is saved next to the plan, which stays; the row shows both and the note', async () => {
    const user = userEvent.setup();
    const services = await seed();
    renderApp('/', services);

    const form = await openOtherAmount(user);
    expect(form.getByText(/Zaplanowano:/)).toHaveTextContent(
      'Zaplanowano: 1 tabletka. Plan zostaje taki, jaki był.',
    );
    expect(form.getByRole('textbox', { name: /^Ile przyjęto/ })).toHaveValue('1'); // starts from the plan
    expect(await logs(services)).toEqual([]); // opening records nothing
    await user.clear(form.getByRole('textbox', { name: /^Ile przyjęto/ }));
    await user.type(form.getByRole('textbox', { name: /^Ile przyjęto/ }), '3');
    await user.type(
      form.getByRole('textbox', { name: /^Notatka/ }),
      'Zgodnie z zaleceniem lekarza',
    );
    await user.click(form.getByRole('button', { name: 'Zapisz jako przyjętą' }));

    await waitFor(async () => {
      expect(await logs(services)).toHaveLength(1);
    });
    expect((await logs(services))[0]).toMatchObject({
      status: 'taken',
      doseAmount: 1,
      doseUnit: 'tabletka',
      takenAmount: 3,
      note: 'Zgodnie z zaleceniem lekarza',
      recordedAt: NOW,
    });
    expect(
      await screen.findByText(
        /Zapisano jako przyjętą: Demoxal, 08:00\. Przyjęto 3 tabletki, planowano 1 tabletka\./,
      ),
    ).toBeVisible();
    const first = await row('08:00');
    expect(await first.findByText('Przyjęto: 3 tabletki.')).toBeVisible();
    expect(first.getByText(/Planowano wtedy: 1 tabletka\./)).toBeVisible();
    expect(first.getByText('Zgodnie z zaleceniem lekarza')).toBeVisible();
    expect(first.getByText('Przyjęta')).toBeVisible();
    // The other dose still shows its plan, untouched.
    expect((await row('20:00')).getByText('2 tabletki')).toBeVisible();
  });

  it('a SMALLER amount is saved the same way', async () => {
    const user = userEvent.setup();
    const services = await seed();
    renderApp('/', services);

    const form = await openOtherAmount(user, '20:00');
    await user.clear(form.getByRole('textbox', { name: /^Ile przyjęto/ }));
    await user.type(form.getByRole('textbox', { name: /^Ile przyjęto/ }), '0,5');
    await user.click(form.getByRole('button', { name: 'Zapisz jako przyjętą' }));

    await waitFor(async () => {
      expect(await logs(services)).toHaveLength(1);
    });
    expect((await logs(services))[0]).toMatchObject({ doseAmount: 2, takenAmount: 0.5 });
    expect(await (await row('20:00')).findByText('Przyjęto: 0,5 tabletki.')).toBeVisible();
  });

  it('a very different amount is saved without a warning, a question or an error: a difference is not a mistake', async () => {
    const user = userEvent.setup();
    const services = await seed();
    renderApp('/', services);

    const form = await openOtherAmount(user);
    await user.clear(form.getByRole('textbox', { name: /^Ile przyjęto/ }));
    await user.type(form.getByRole('textbox', { name: /^Ile przyjęto/ }), '50');
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
    expect(form.queryByRole('status')).not.toBeInTheDocument();
    await user.click(form.getByRole('button', { name: 'Zapisz jako przyjętą' }));

    await waitFor(async () => {
      expect((await logs(services))[0]?.takenAmount).toBe(50);
    });
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
  });

  it('the planned amount typed is stored as "as planned" (no amount field), with just the note', async () => {
    const user = userEvent.setup();
    const services = await seed();
    renderApp('/', services);

    const form = await openOtherAmount(user);
    await user.type(form.getByRole('textbox', { name: /^Notatka/ }), 'Po jedzeniu');
    await user.click(form.getByRole('button', { name: 'Zapisz jako przyjętą' }));

    await waitFor(async () => {
      expect(await logs(services)).toHaveLength(1);
    });
    const [log] = await logs(services);
    expect(log?.note).toBe('Po jedzeniu');
    expect(log && 'takenAmount' in log).toBe(false);
    expect(await screen.findByText('Zapisano jako przyjętą: Demoxal, 08:00.')).toBeVisible();
  });

  it('never suggests a dose: no advice, no judgement in the dialog or in the row', async () => {
    const user = userEvent.setup();
    const services = await seed();
    renderApp('/', services);

    const form = await openOtherAmount(user);
    await user.clear(form.getByRole('textbox', { name: /^Ile przyjęto/ }));
    await user.type(form.getByRole('textbox', { name: /^Ile przyjęto/ }), '4');
    const dialogText = screen.getByRole('dialog').textContent;
    await user.click(form.getByRole('button', { name: 'Zapisz jako przyjętą' }));
    await waitFor(async () => {
      expect(await logs(services)).toHaveLength(1);
    });
    const rowText = (await row('08:00'))
      .getByText(/Przyjęto: 4 tabletki/)
      .closest('li')?.textContent;

    for (const text of [dialogText, rowText]) {
      expect(text).not.toMatch(
        /zalec(amy|a się)|powinien|powinna|należy|lepiej|za dużo|za mało|przekrocz|bezpiecz|zwiększ|zmniejsz|zbyt|ostrzeż/i,
      );
    }
    expect(dialogText).toContain('nie podpowiada dawki');
  });

  it.each(['', '  ', '0', '-1', 'abc', '1,2345', '1e3'])(
    'refuses the amount "%s", says what to type, keeps the dialog and records nothing',
    async (amount) => {
      const user = userEvent.setup();
      const services = await seed();
      renderApp('/', services);
      const form = await openOtherAmount(user);
      await user.clear(form.getByRole('textbox', { name: /^Ile przyjęto/ }));
      if (amount.trim() !== '')
        await user.type(form.getByRole('textbox', { name: /^Ile przyjęto/ }), amount);
      else if (amount !== '')
        await user.type(form.getByRole('textbox', { name: /^Ile przyjęto/ }), amount);

      await user.click(form.getByRole('button', { name: 'Zapisz jako przyjętą' }));

      expect(
        await form.findByText(/Wpisz ilość większą od zera, na przykład 1 lub 0,5/),
      ).toBeVisible();
      expect(form.getByRole('textbox', { name: /^Ile przyjęto/ })).toBeInvalid();
      expect(await logs(services)).toEqual([]);
      expect(screen.getByRole('dialog')).toBeVisible();
    },
  );

  it('refuses a note over 500 characters and accepts exactly 500', async () => {
    const user = userEvent.setup();
    const services = await seed();
    renderApp('/', services);
    const form = await openOtherAmount(user);
    await user.click(form.getByRole('textbox', { name: /^Notatka/ }));
    await user.paste('x'.repeat(501));

    await user.click(form.getByRole('button', { name: 'Zapisz jako przyjętą' }));
    expect(await form.findByText('Notatka może mieć najwyżej 500 znaków.')).toBeVisible();
    expect(await logs(services)).toEqual([]);

    await user.clear(form.getByRole('textbox', { name: /^Notatka/ }));
    await user.click(form.getByRole('textbox', { name: /^Notatka/ }));
    await user.paste('x'.repeat(500));
    await user.click(form.getByRole('button', { name: 'Zapisz jako przyjętą' }));
    await waitFor(async () => {
      expect(await logs(services)).toHaveLength(1);
    });
  });

  it('writes nothing until the person confirms: cancelling leaves the dose unrecorded', async () => {
    const user = userEvent.setup();
    const services = await seed();
    renderApp('/', services);
    const form = await openOtherAmount(user);
    await user.clear(form.getByRole('textbox', { name: /^Ile przyjęto/ }));
    await user.type(form.getByRole('textbox', { name: /^Ile przyjęto/ }), '3');

    await user.click(form.getByRole('button', { name: 'Anuluj' }));

    expect(await logs(services)).toEqual([]);
    expect(services.storage.data.has(STORAGE_KEYS.doseLogs)).toBe(false);
    expect((await row('08:00')).getByText('Nie zapisano')).toBeVisible();
  });

  it('a double click on the confirmation records one dose', async () => {
    const user = userEvent.setup();
    const services = await seed();
    renderApp('/', services);
    const form = await openOtherAmount(user);
    await user.clear(form.getByRole('textbox', { name: /^Ile przyjęto/ }));
    await user.type(form.getByRole('textbox', { name: /^Ile przyjęto/ }), '3');

    await user.dblClick(form.getByRole('button', { name: 'Zapisz jako przyjętą' }));

    await screen.findByText(/Zapisano jako przyjętą: Demoxal, 08:00/);
    expect(await logs(services)).toHaveLength(1);
  });

  it('a failed write keeps the dialog and what was typed, says why, and shows no success', async () => {
    const user = userEvent.setup();
    const services = await seed();
    renderApp('/', services);
    const form = await openOtherAmount(user);
    await user.clear(form.getByRole('textbox', { name: /^Ile przyjęto/ }));
    await user.type(form.getByRole('textbox', { name: /^Ile przyjęto/ }), '3');
    await user.type(form.getByRole('textbox', { name: /^Notatka/ }), 'Moja notatka');

    services.storage.failWrites(createQuotaError(), (key) => key === STORAGE_KEYS.doseLogs);
    await user.click(form.getByRole('button', { name: 'Zapisz jako przyjętą' }));

    expect(await form.findByRole('alert')).toHaveTextContent(
      'W pamięci przeglądarki brakuje miejsca',
    );
    expect(form.getByRole('textbox', { name: /^Ile przyjęto/ })).toHaveValue('3');
    expect(form.getByRole('textbox', { name: /^Notatka/ })).toHaveValue('Moja notatka');
    expect(screen.queryByText(/Zapisano jako przyjętą/)).not.toBeInTheDocument();
    services.storage.heal();
    expect(await logs(services)).toEqual([]);

    await user.click(form.getByRole('button', { name: 'Zapisz jako przyjętą' }));
    await waitFor(async () => {
      expect(await logs(services)).toHaveLength(1);
    });
  });

  it('is not offered for a day that has not come', async () => {
    const services = await seed();
    renderApp('/doses?date=2026-10-16', services);

    await row('08:00');
    expect(screen.queryByRole('button', { name: /Przyjęto inną ilość/ })).not.toBeInTheDocument();
  });
});

describe('editing the amount and the note of a taken dose', () => {
  const takenLog = (overrides = {}) =>
    makeDoseLog({
      id: 'l-1',
      medicationId: 'm-1',
      scheduledDate: TODAY,
      scheduledTime: asLocalTime('08:00'),
      status: 'taken',
      doseAmount: 1,
      recordedAt: asTimestamp('2026-10-15T06:05:00Z'),
      ...overrides,
    });
  const openEdit = async (user: ReturnType<typeof userEvent.setup>) => {
    await user.click(
      await screen.findByRole('button', { name: 'Zmień ilość lub notatkę: Demoxal, 08:00' }),
    );
    return dialog();
  };

  it('starts from what is stored, saves the change, and does not move recordedAt', async () => {
    const user = userEvent.setup();
    const services = await seed();
    await services.repositories.doseLogs.upsert(takenLog({ takenAmount: 2, note: 'Stara' }));
    renderApp('/', services);

    const form = await openEdit(user);
    expect(form.getByRole('textbox', { name: /^Ile przyjęto/ })).toHaveValue('2');
    expect(form.getByRole('textbox', { name: /^Notatka/ })).toHaveValue('Stara');
    await user.clear(form.getByRole('textbox', { name: /^Ile przyjęto/ }));
    await user.type(form.getByRole('textbox', { name: /^Ile przyjęto/ }), '4,5');
    await user.clear(form.getByRole('textbox', { name: /^Notatka/ }));
    await user.type(form.getByRole('textbox', { name: /^Notatka/ }), 'Nowa');
    await user.click(form.getByRole('button', { name: 'Zapisz zmiany' }));

    await waitFor(async () => {
      expect((await logs(services))[0]?.takenAmount).toBe(4.5);
    });
    const [log] = await logs(services);
    expect(log).toMatchObject({ id: 'l-1', doseAmount: 1, note: 'Nowa', status: 'taken' });
    expect(log?.recordedAt).toBe('2026-10-15T06:05:00.000Z');
    expect(
      await screen.findByText(
        /Zapisano zmiany: Demoxal, 08:00\. Przyjęto 4,5 tabletki, planowano 1 tabletka\./,
      ),
    ).toBeVisible();
    expect(await logs(services)).toHaveLength(1);
  });

  it('opens on the plan for a record with no amount, and the same value again is "unchanged" and writes nothing', async () => {
    const user = userEvent.setup();
    const services = await seed();
    await services.repositories.doseLogs.upsert(takenLog());
    renderApp('/', services);
    const writesBefore = services.storage.writes.length;

    const form = await openEdit(user);
    expect(form.getByRole('textbox', { name: /^Ile przyjęto/ })).toHaveValue('1');
    await user.click(form.getByRole('button', { name: 'Zapisz zmiany' }));

    expect(
      await screen.findByText('Ta dawka miała już taki zapis: Demoxal, 08:00. Nic nie zmieniono.'),
    ).toBeVisible();
    expect(services.storage.writes).toHaveLength(writesBefore);
  });

  it('going back to the planned amount removes the amount taken', async () => {
    const user = userEvent.setup();
    const services = await seed();
    await services.repositories.doseLogs.upsert(takenLog({ takenAmount: 3 }));
    renderApp('/', services);

    const form = await openEdit(user);
    await user.clear(form.getByRole('textbox', { name: /^Ile przyjęto/ }));
    await user.type(form.getByRole('textbox', { name: /^Ile przyjęto/ }), '1');
    await user.click(form.getByRole('button', { name: 'Zapisz zmiany' }));

    await waitFor(async () => {
      expect('takenAmount' in ((await logs(services))[0] ?? {})).toBe(false);
    });
    expect(await screen.findByText(/Przyjęto zgodnie z planem: 1 tabletka\./)).toBeVisible();
  });

  it('a record changed in the meantime is not overwritten: the person is told, the dialog closes and the screen refreshes', async () => {
    const user = userEvent.setup();
    const services = await seed();
    await services.repositories.doseLogs.upsert(takenLog({ takenAmount: 2 }));
    renderApp('/', services);
    const form = await openEdit(user);
    await user.clear(form.getByRole('textbox', { name: /^Ile przyjęto/ }));
    await user.type(form.getByRole('textbox', { name: /^Ile przyjęto/ }), '5');
    // Another tab changes the record first.
    await services.repositories.doseLogs.upsert(
      takenLog({ takenAmount: 3, note: 'z innej karty' }),
    );

    await user.click(form.getByRole('button', { name: 'Zapisz zmiany' }));

    expect(await screen.findByText(/Zapis tej dawki zmienił się w międzyczasie/)).toBeVisible();
    expect((await logs(services))[0]).toMatchObject({ takenAmount: 3, note: 'z innej karty' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(await (await row('08:00')).findByText('Przyjęto: 3 tabletki.')).toBeVisible();
  });

  it('is not offered for a skipped dose, and skipping removes the amount and the note from the record and the row', async () => {
    const user = userEvent.setup();
    const services = await seed();
    await services.repositories.doseLogs.upsert(takenLog({ takenAmount: 3, note: 'Notatka' }));
    renderApp('/', services);
    const first = await row('08:00');
    expect(first.getByText('Przyjęto: 3 tabletki.')).toBeVisible();
    expect(first.getByText('Notatka')).toBeVisible();

    await user.click(first.getByRole('button', { name: 'Zmień na pominiętą: Demoxal, 08:00' }));

    await waitFor(async () => {
      expect((await logs(services))[0]?.status).toBe('skipped');
    });
    const [skipped] = await logs(services);
    expect(skipped && 'takenAmount' in skipped).toBe(false);
    expect(skipped && 'note' in skipped).toBe(false);
    expect(skipped?.doseAmount).toBe(1);
    const after = await row('08:00');
    expect(after.queryByText(/Przyjęto: /)).not.toBeInTheDocument();
    expect(after.queryByText('Notatka')).not.toBeInTheDocument();
    expect(
      after.queryByRole('button', { name: /Zmień ilość lub notatkę/ }),
    ).not.toBeInTheDocument();

    await user.click(after.getByRole('button', { name: 'Zmień na przyjętą: Demoxal, 08:00' }));
    await waitFor(async () => {
      expect((await logs(services))[0]?.status).toBe('taken');
    });
    // Back to taken starts from the plan again.
    expect('takenAmount' in ((await logs(services))[0] ?? {})).toBe(false);
  });

  it('clearing the record clears it with its details', async () => {
    const user = userEvent.setup();
    const services = await seed();
    await services.repositories.doseLogs.upsert(takenLog({ takenAmount: 3, note: 'x' }));
    renderApp('/', services);

    await user.click(await screen.findByRole('button', { name: 'Cofnij zapis: Demoxal, 08:00' }));

    await waitFor(async () => {
      expect(await logs(services)).toEqual([]);
    });
    expect((await row('08:00')).getByText('Nie zapisano')).toBeVisible();
  });
});

describe('older records and the schedule', () => {
  it('a record saved before these fields shows as it did, and can get an amount and a note', async () => {
    const user = userEvent.setup();
    const services = await seed({ scheduleTimes: [scheduleTime('t-1', '08:00', 2)] });
    // Recorded under an older plan of 1 tablet: the schedule changed since.
    await services.repositories.doseLogs.upsert(
      makeDoseLog({
        id: 'old',
        medicationId: 'm-1',
        scheduledDate: TODAY,
        scheduledTime: asLocalTime('08:00'),
        status: 'taken',
        doseAmount: 1,
        recordedAt: asTimestamp('2026-10-15T06:05:00Z'),
      }),
    );
    renderApp('/', services);

    const first = await row('08:00');
    expect(
      first.getByText(/Zapisana dawka: 1 tabletka \(obecnie w harmonogramie: 2 tabletki\)\./),
    ).toBeVisible();
    expect(first.queryByText(/Przyjęto: /)).not.toBeInTheDocument();
    await user.click(
      first.getByRole('button', { name: 'Zmień ilość lub notatkę: Demoxal, 08:00' }),
    );
    const form = dialog();
    expect(form.getByText(/Zaplanowano:/)).toHaveTextContent('Zaplanowano: 1 tabletka.'); // the plan of THAT record
    await user.clear(form.getByRole('textbox', { name: /^Ile przyjęto/ }));
    await user.type(form.getByRole('textbox', { name: /^Ile przyjęto/ }), '2');
    await user.click(form.getByRole('button', { name: 'Zapisz zmiany' }));

    await waitFor(async () => {
      expect((await logs(services))[0]?.takenAmount).toBe(2);
    });
    expect((await logs(services))[0]).toMatchObject({ doseAmount: 1, takenAmount: 2 });
    // The two messages mean different things and are both shown.
    const after = await row('08:00');
    expect(await after.findByText('Przyjęto: 2 tabletki.')).toBeVisible();
    expect(
      after.getByText(/Planowano wtedy: 1 tabletka\. Obecnie w harmonogramie: 2 tabletki\./),
    ).toBeVisible();
  });

  it("recording an amount changes neither the schedule, nor scheduleEffectiveFrom, nor tomorrow's plan", async () => {
    const user = userEvent.setup();
    const services = await seed();
    const before = await services.repositories.medications.get('m-1');
    renderApp('/', services);
    const form = await openOtherAmount(user);
    await user.clear(form.getByRole('textbox', { name: /^Ile przyjęto/ }));
    await user.type(form.getByRole('textbox', { name: /^Ile przyjęto/ }), '7');
    await user.click(form.getByRole('button', { name: 'Zapisz jako przyjętą' }));
    await waitFor(async () => {
      expect(await logs(services)).toHaveLength(1);
    });
    cleanup();

    expect(await services.repositories.medications.get('m-1')).toEqual(before);
    renderApp('/doses?date=2026-10-16', services);
    const tomorrow = await row('08:00');
    expect(tomorrow.getByText('1 tabletka')).toBeVisible();
    expect((await row('20:00')).getByText('2 tabletki')).toBeVisible();
    expect(screen.queryByText(/Przyjęto: /)).not.toBeInTheDocument();
  });
});

describe('the stock estimate uses the amount actually taken', () => {
  it('reduces the stock by the amount taken, not by the plan, on the dashboard', async () => {
    const user = userEvent.setup();
    const services = await seed();
    renderApp('/', services);
    const stock = within(await panel('Zapasy leków'));
    expect(await stock.findByText(/Pozostało ok\. 20 tabletek/)).toBeVisible();

    const form = await openOtherAmount(user);
    await user.clear(form.getByRole('textbox', { name: /^Ile przyjęto/ }));
    await user.type(form.getByRole('textbox', { name: /^Ile przyjęto/ }), '3');
    await user.click(form.getByRole('button', { name: 'Zapisz jako przyjętą' }));

    // 20 - 3 (taken), not 20 - 1 (planned).
    expect(await stock.findByText(/Pozostało ok\. 17 tabletek/)).toBeVisible();
    expect(stock.queryByText(/Pozostało ok\. 19 tabletek/)).not.toBeInTheDocument();
  });

  it('follows an edit: a smaller amount lifts the stock, and the same record is not counted twice', async () => {
    const user = userEvent.setup();
    const services = await seed();
    await services.repositories.doseLogs.upsert(
      makeDoseLog({
        id: 'l-1',
        medicationId: 'm-1',
        scheduledDate: TODAY,
        scheduledTime: asLocalTime('08:00'),
        status: 'taken',
        doseAmount: 1,
        takenAmount: 5,
        recordedAt: asTimestamp('2026-10-14T06:05:00Z'),
      }),
    );
    renderApp('/', services);
    const stock = within(await panel('Zapasy leków'));
    expect(await stock.findByText(/Pozostało ok\. 15 tabletek/)).toBeVisible();

    await user.click(
      await screen.findByRole('button', { name: 'Zmień ilość lub notatkę: Demoxal, 08:00' }),
    );
    await user.clear(dialog().getByRole('textbox', { name: /^Ile przyjęto/ }));
    await user.type(dialog().getByRole('textbox', { name: /^Ile przyjęto/ }), '2');
    await user.click(dialog().getByRole('button', { name: 'Zapisz zmiany' }));

    expect(await stock.findByText(/Pozostało ok\. 18 tabletek/)).toBeVisible();
    expect(await logs(services)).toHaveLength(1);
  });

  it('refreshes the low-stock warning from the amount taken', async () => {
    const user = userEvent.setup();
    const services = await seed({ lowStockThreshold: { quantity: 15, unit: 'tabletka' } });
    renderApp('/', services);
    const stock = within(await panel('Zapasy leków'));
    await stock.findByText(/Pozostało ok\. 20 tabletek/);
    expect(stock.queryByText(/^Niski zapas/)).not.toBeInTheDocument();

    const form = await openOtherAmount(user);
    await user.clear(form.getByRole('textbox', { name: /^Ile przyjęto/ }));
    await user.type(form.getByRole('textbox', { name: /^Ile przyjęto/ }), '5');
    await user.click(form.getByRole('button', { name: 'Zapisz jako przyjętą' }));

    // 20 - 5 = 15: exactly at the threshold.
    expect(
      await stock.findByText(/Zapas jest na poziomie Twojego progu \(15 tabletek\)/),
    ).toBeVisible();
  });

  it('a medication whose estimate cannot be computed still records what was taken, and shows no number', async () => {
    const user = userEvent.setup();
    const services = await seed({ stock: null });
    renderApp('/doses', services);

    const form = await openOtherAmount(user);
    await user.clear(form.getByRole('textbox', { name: /^Ile przyjęto/ }));
    await user.type(form.getByRole('textbox', { name: /^Ile przyjęto/ }), '3');
    await user.click(form.getByRole('button', { name: 'Zapisz jako przyjętą' }));

    await waitFor(async () => {
      expect((await logs(services))[0]?.takenAmount).toBe(3);
    });
    expect(
      await screen.findByText('Szacunek niedostępny: zapas nie został policzony.'),
    ).toBeVisible();
  });

  it('works with a unit that is not on any list: the amount is in the unit of the record', async () => {
    const user = userEvent.setup();
    const services = await seed({
      doseUnit: 'inhalacja',
      scheduleTimes: [scheduleTime('t-1', '08:00', 2)],
      stock: { quantity: 20, unit: 'inhalacja', asOf: COUNTED },
    });
    renderApp('/doses', services);

    const form = await openOtherAmount(user);
    expect(form.getByText(/W jednostce dawki: inhalacja/)).toBeVisible();
    await user.clear(form.getByRole('textbox', { name: /^Ile przyjęto/ }));
    await user.type(form.getByRole('textbox', { name: /^Ile przyjęto/ }), '3');
    await user.click(form.getByRole('button', { name: 'Zapisz jako przyjętą' }));

    await waitFor(async () => {
      expect((await logs(services))[0]).toMatchObject({ doseUnit: 'inhalacja', takenAmount: 3 });
    });
    expect(await screen.findByText(/Pozostało ok\. 17 inhalacja/)).toBeVisible();
  });
});

describe('the history and the day view show both amounts', () => {
  it('the history shows what was taken, the plan and the note', async () => {
    const services = await seed();
    await services.repositories.doseLogs.upsert(
      makeDoseLog({
        id: 'l-1',
        medicationId: 'm-1',
        scheduledDate: TODAY,
        scheduledTime: asLocalTime('08:00'),
        status: 'taken',
        doseAmount: 1,
        takenAmount: 3,
        note: 'Zgodnie z zaleceniem lekarza',
      }),
    );
    renderApp('/doses/history', services);

    expect(await screen.findByText('Przyjęto: 3 tabletki')).toBeVisible();
    expect(screen.getByText('Planowano: 1 tabletka')).toBeVisible();
    expect(screen.getByText('Zgodnie z zaleceniem lekarza')).toBeVisible();
  });

  it('the history shows an older record as before', async () => {
    const services = await seed();
    await services.repositories.doseLogs.upsert(
      makeDoseLog({
        id: 'old',
        medicationId: 'm-1',
        scheduledDate: TODAY,
        scheduledTime: asLocalTime('08:00'),
        status: 'taken',
        doseAmount: 1,
      }),
    );
    renderApp('/doses/history', services);

    expect(await screen.findByText('Zapisana dawka: 1 tabletka')).toBeVisible();
    expect(screen.queryByText(/Przyjęto: /)).not.toBeInTheDocument();
  });

  it('the day view works the same as the dashboard', async () => {
    const user = userEvent.setup();
    const services = await seed();
    renderApp('/doses', services);

    const form = await openOtherAmount(user, '20:00');
    await user.clear(form.getByRole('textbox', { name: /^Ile przyjęto/ }));
    await user.type(form.getByRole('textbox', { name: /^Ile przyjęto/ }), '4');
    await user.type(form.getByRole('textbox', { name: /^Notatka/ }), 'Wieczorem');
    await user.click(form.getByRole('button', { name: 'Zapisz jako przyjętą' }));

    const evening = await row('20:00');
    expect(await evening.findByText('Przyjęto: 4 tabletki.')).toBeVisible();
    expect(evening.getByText('Wieczorem')).toBeVisible();
    expect(await screen.findByText(/Pozostało ok\. 16 tabletek/)).toBeVisible();
  });
});
