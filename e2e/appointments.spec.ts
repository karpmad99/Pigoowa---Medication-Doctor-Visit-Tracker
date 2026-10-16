import { expect, test, type Page } from '@playwright/test';

// Real browser, real localStorage. The clock is fixed (Thursday 15 October 2026, 12:00 in Warsaw)
// and so is the time zone, so nothing depends on the real date. The demo data is dated relative
// to that day: Sunday 18 October 09:30 and Tuesday 27 October 14:15 are upcoming; the 14th at
// 11:00 was never confirmed; 1 October (completed) and 10 October (cancelled) are past.

const NOW = new Date('2026-10-15T10:00:00Z');
const APPOINTMENTS_KEY = 'pigoowa:v1:appointments';

test.use({ timezoneId: 'Europe/Warsaw', locale: 'pl-PL' });

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(NOW);
});

interface StoredAppointment {
  id: string;
  doctorName: string | null;
  specialty: string | null;
  scheduledAt: string;
  location: string | null;
  notes: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
}

async function stored(page: Page): Promise<StoredAppointment[]> {
  const raw = await page.evaluate((key) => window.localStorage.getItem(key), APPOINTMENTS_KEY);
  // JSON.parse returns `any`; the storage envelope `{ version, items }` is the app's own format
  // (see README), and the test names the item type it expects.
  return raw === null ? [] : (JSON.parse(raw) as { items: StoredAppointment[] }).items;
}

async function loadDemoData(page: Page) {
  await page.goto('/dev/data');
  await page.getByRole('button', { name: 'Wczytaj dane demonstracyjne' }).click();
  await expect(page.getByText('Wczytano dane demonstracyjne.')).toBeVisible();
}

async function openAppointments(page: Page, query = '') {
  await page.goto(`/appointments${query}`);
  await expect(page.getByRole('heading', { level: 1, name: 'Wizyty' })).toBeVisible();
}

async function fillValid(
  page: Page,
  { doctor = 'dr Testowy', date = '2026-10-20', time = '10:00' } = {},
) {
  await page.getByRole('textbox', { name: /^Lekarz/ }).fill(doctor);
  await page.getByLabel(/^Data wizyty/).fill(date);
  await page.getByLabel(/^Godzina wizyty/).fill(time);
}

const card = (page: Page, title: string) =>
  page.getByRole('listitem').filter({ has: page.getByText(title, { exact: true }) });

test.describe('the list', () => {
  test('shows upcoming appointments grouped by day, soonest first, with the counts in the tabs', async ({
    page,
  }) => {
    await loadDemoData(page);
    await openAppointments(page);

    await expect(page.getByRole('tab', { name: 'Nadchodzące (2)' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(page.getByRole('tab', { name: 'Minione (3)' })).toHaveAttribute(
      'aria-selected',
      'false',
    );
    const days = page.getByRole('heading', { level: 3 });
    await expect(days).toHaveText([
      'niedziela, 18 października 2026',
      'wtorek, 27 października 2026',
    ]);
    await expect(card(page, 'dr Anna Przykładowska')).toContainText('09:30');
    await expect(card(page, 'dr Anna Przykładowska')).toContainText('Zaplanowana');
    await expect(card(page, 'Okulista')).toContainText('14:15');
    await expect(
      page.getByText('Masz 1 wizytę do potwierdzenia na liście minionych.'),
    ).toBeVisible();
  });

  test('the Past tab labels what needs confirmation, what was completed and what was cancelled, in words', async ({
    page,
  }) => {
    await loadDemoData(page);
    await openAppointments(page);

    await page.getByRole('tab', { name: 'Minione (3)' }).click();

    await expect(page).toHaveURL(/\?tab=past$/);
    await expect(page.getByRole('heading', { level: 3 })).toHaveText([
      'środa, 14 października 2026',
      'sobota, 10 października 2026',
      'czwartek, 1 października 2026',
    ]);
    await expect(card(page, 'dr Ewa Demonstracyjna')).toContainText('Do potwierdzenia');
    await expect(card(page, 'Dermatolog')).toContainText('Odwołana');
    await expect(card(page, 'dr Jan Testowy')).toContainText('Odbyła się');
    // The elapsed one is still "scheduled" in storage: nothing was decided for the user.
    const elapsed = (await stored(page)).find(
      (entry) => entry.id === 'demo-appointment-needs-confirmation',
    );
    expect(elapsed?.status).toBe('scheduled');
  });

  test('the tabs work with the keyboard and keep the choice after a reload', async ({ page }) => {
    await loadDemoData(page);
    await openAppointments(page);

    await page.getByRole('tab', { name: 'Nadchodzące (2)' }).focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.getByRole('tab', { name: 'Minione (3)' })).toBeFocused();
    await expect(page.getByRole('heading', { level: 2, name: 'Minione wizyty' })).toBeVisible();
    await page.reload();
    await expect(page.getByRole('tab', { name: 'Minione (3)' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await page.getByRole('tab', { name: 'Minione (3)' }).focus();
    await page.keyboard.press('Home');
    await expect(page.getByRole('tab', { name: 'Nadchodzące (2)' })).toBeFocused();
    await expect(page.getByRole('heading', { level: 2, name: 'Nadchodzące wizyty' })).toBeVisible();
  });

  test('explains an empty list and offers to add the first appointment', async ({ page }) => {
    await openAppointments(page);

    await expect(
      page.getByRole('heading', { name: 'Nie dodano jeszcze żadnej wizyty' }),
    ).toBeVisible();
    await page.getByRole('link', { name: 'Dodaj pierwszą wizytę' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Dodaj wizytę' })).toBeVisible();
  });
});

test.describe('adding and editing', () => {
  test('creates an appointment, which survives a reload, and edits it, which also survives', async ({
    page,
  }) => {
    await openAppointments(page);
    await page.getByRole('link', { name: 'Dodaj pierwszą wizytę' }).click();
    await fillValid(page);
    await page.getByRole('textbox', { name: /^Specjalizacja/ }).fill('Kardiolog');
    await page.getByRole('textbox', { name: /^Miejsce/ }).fill('Gabinet 5');
    await page.getByRole('button', { name: 'Dodaj wizytę' }).click();

    await expect(page.getByText('Dodano wizytę: dr Testowy.')).toBeVisible();
    await expect(page).toHaveURL(/\/appointments$/);
    const [created] = await stored(page);
    expect(created).toMatchObject({
      doctorName: 'dr Testowy',
      specialty: 'Kardiolog',
      location: 'Gabinet 5',
      status: 'scheduled',
      scheduledAt: '2026-10-20T08:00:00.000Z',
    });

    await page.reload();
    await expect(page.getByText('Dodano wizytę')).toHaveCount(0);
    await expect(card(page, 'dr Testowy')).toContainText('10:00');
    await expect(page.getByRole('heading', { level: 3 })).toHaveText([
      'wtorek, 20 października 2026',
    ]);

    await page.getByRole('link', { name: /^Edytuj wizytę: dr Testowy/ }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Edytuj wizytę' })).toBeVisible();
    await expect(page.getByLabel(/^Godzina wizyty/)).toHaveValue('10:00');
    await page.getByLabel(/^Data wizyty/).fill('2026-10-22');
    await page.getByLabel(/^Godzina wizyty/).fill('16:30');
    await page.getByRole('textbox', { name: /^Miejsce/ }).fill('Gabinet 7');
    await page.getByRole('button', { name: 'Zapisz zmiany' }).click();
    await expect(page.getByText('Zapisano zmiany w wizycie: dr Testowy.')).toBeVisible();

    await page.reload();
    await expect(page.getByRole('heading', { level: 3 })).toHaveText([
      'czwartek, 22 października 2026',
    ]);
    await expect(card(page, 'dr Testowy')).toContainText('16:30');
    await expect(card(page, 'dr Testowy')).toContainText('Gabinet 7');
    const [edited] = await stored(page);
    expect(edited).toMatchObject({
      id: created?.id,
      createdAt: created?.createdAt,
      status: 'scheduled',
      scheduledAt: '2026-10-22T14:30:00.000Z',
      location: 'Gabinet 7',
    });
    expect(await stored(page)).toHaveLength(1);
  });

  test('shows the problems next to their fields, focuses the first, keeps the input, and writes nothing', async ({
    page,
  }) => {
    await page.goto('/appointments/new');
    await page.getByRole('textbox', { name: /^Miejsce/ }).fill('Gabinet 5');

    await page.getByRole('button', { name: 'Dodaj wizytę' }).click();

    await expect(page.getByRole('textbox', { name: /^Lekarz/ })).toBeFocused();
    await expect(page.getByRole('textbox', { name: /^Lekarz/ })).toHaveAttribute(
      'aria-invalid',
      'true',
    );
    await expect(
      page.getByText('Wpisz lekarza lub specjalizację (wystarczy jedno z nich).'),
    ).toHaveCount(2);
    await expect(page.getByText('Wybierz poprawną datę wizyty.')).toBeVisible();
    await expect(page.getByText('Wybierz poprawną godzinę wizyty.')).toBeVisible();
    await expect(page.getByRole('textbox', { name: /^Miejsce/ })).toHaveValue('Gabinet 5');
    expect(await stored(page)).toEqual([]);
  });

  test('refuses a time that does not exist on the clock-change day, and warns about a repeated one', async ({
    page,
  }) => {
    await page.goto('/appointments/new');
    await fillValid(page, { date: '2026-03-29', time: '02:30' });
    await page.getByRole('button', { name: 'Dodaj wizytę' }).click();
    await expect(page.getByText(/Tej godziny nie ma w wybranym dniu/)).toBeVisible();
    expect(await stored(page)).toEqual([]);

    await page.getByLabel(/^Data wizyty/).fill('2026-10-25');
    await expect(page.getByText(/ta godzina występuje dwa razy/)).toBeVisible();
  });

  test('a double click creates one appointment', async ({ page }) => {
    await page.goto('/appointments/new');
    await fillValid(page);

    await page.getByRole('button', { name: 'Dodaj wizytę' }).dblclick();

    await expect(page.getByText('Dodano wizytę: dr Testowy.')).toBeVisible();
    expect(await stored(page)).toHaveLength(1);
  });

  test('shows a failed save as an error and keeps what was typed', async ({ page }) => {
    await page.goto('/appointments/new');
    await fillValid(page);
    await page.evaluate(() => {
      Storage.prototype.setItem = () => {
        throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
      };
    });

    await page.getByRole('button', { name: 'Dodaj wizytę' }).click();

    await expect(page.getByRole('alert')).toContainText('Nie zapisano wizyty');
    await expect(page.getByRole('alert')).toContainText('brakuje miejsca');
    await expect(page.getByRole('textbox', { name: /^Lekarz/ })).toHaveValue('dr Testowy');
    await expect(page).toHaveURL(/\/appointments\/new$/);
    expect(await stored(page)).toEqual([]);
  });

  test('an appointment dated in the past appears under Minione as "Do potwierdzenia", not as completed', async ({
    page,
  }) => {
    await page.goto('/appointments/new');
    await fillValid(page, { date: '2026-10-01', time: '09:00' });

    await page.getByRole('button', { name: 'Dodaj wizytę' }).click();

    await expect(page).toHaveURL(/\?tab=past$/);
    await expect(card(page, 'dr Testowy')).toContainText('Do potwierdzenia');
    expect((await stored(page))[0]?.status).toBe('scheduled');
  });
});

test.describe('status', () => {
  test('marks an upcoming appointment completed and restores it, with the state kept after a reload', async ({
    page,
  }) => {
    await loadDemoData(page);
    await openAppointments(page);

    await page.getByRole('button', { name: /^Oznacz jako odbytą: dr Anna Przykładowska/ }).click();
    await expect(page.getByText(/Oznaczono jako odbytą: dr Anna Przykładowska/)).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Nadchodzące (1)' })).toBeVisible();
    await page.reload();
    await page.getByRole('tab', { name: 'Minione (4)' }).click();
    await expect(card(page, 'dr Anna Przykładowska')).toContainText('Odbyła się');
    const before = (await stored(page)).find(
      (entry) => entry.id === 'demo-appointment-upcoming-cardiology',
    );
    expect(before?.status).toBe('completed');
    expect(before?.scheduledAt).toBe('2026-10-18T07:30:00.000Z'); // date and time untouched

    await page
      .getByRole('button', { name: /^Przywróć jako zaplanowaną: dr Anna Przykładowska/ })
      .click();
    await expect(
      page.getByText(/Przywrócono jako zaplanowaną: dr Anna Przykładowska/),
    ).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Nadchodzące (2)' })).toBeVisible();
    await page.reload();
    await expect(page.getByRole('tab', { name: 'Nadchodzące (2)' })).toBeVisible();
  });

  test('confirms an elapsed appointment as cancelled, and can undo that', async ({ page }) => {
    await loadDemoData(page);
    await openAppointments(page, '?tab=past');

    await page
      .getByRole('button', { name: /^Oznacz jako odwołaną: dr Ewa Demonstracyjna/ })
      .click();

    await expect(card(page, 'dr Ewa Demonstracyjna')).toContainText('Odwołana');
    await expect(page.getByText('Masz 1 wizytę do potwierdzenia')).toHaveCount(0);
    await page.reload();
    await expect(card(page, 'dr Ewa Demonstracyjna')).toContainText('Odwołana');

    await page
      .getByRole('button', { name: /^Przywróć jako zaplanowaną: dr Ewa Demonstracyjna/ })
      .click();
    await expect(page.getByText(/Jej termin już minął/)).toBeVisible();
    await expect(card(page, 'dr Ewa Demonstracyjna')).toContainText('Do potwierdzenia');
  });

  test('a failed status change shows an error and changes nothing', async ({ page }) => {
    await loadDemoData(page);
    await openAppointments(page);
    const before = await stored(page);
    await page.evaluate(() => {
      Storage.prototype.setItem = () => {
        throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
      };
    });

    await page.getByRole('button', { name: /^Oznacz jako odbytą: dr Anna Przykładowska/ }).click();

    await expect(page.getByRole('alert')).toContainText('Nie zmieniono statusu');
    await expect(page.getByText(/Oznaczono jako/)).toHaveCount(0);
    expect(await stored(page)).toEqual(before);
  });

  test('keeps keyboard focus on the appointment that changed', async ({ page }) => {
    await loadDemoData(page);
    await openAppointments(page, '?tab=past');

    await page.getByRole('button', { name: /^Oznacz jako odbytą: dr Ewa Demonstracyjna/ }).focus();
    await page.keyboard.press('Enter');

    await expect(card(page, 'dr Ewa Demonstracyjna')).toContainText('Odbyła się');
    await expect(card(page, 'dr Ewa Demonstracyjna').locator('p[tabindex="-1"]')).toBeFocused();
  });
});

test.describe('deleting', () => {
  const deleteButton = (page: Page) =>
    page.getByRole('button', { name: /^Usuń trwale…: Okulista/ });

  test('Escape and Cancel change nothing and give focus back to the button', async ({ page }) => {
    await loadDemoData(page);
    await openAppointments(page);
    const before = await stored(page);

    await deleteButton(page).click();
    const dialog = page.getByRole('dialog', { name: 'Trwale usunąć wizytę „Okulista”?' });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('trwale usunięta');
    await expect(dialog.getByRole('button', { name: 'Anuluj' })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(deleteButton(page)).toBeFocused();

    await deleteButton(page).click();
    await dialog.getByRole('button', { name: 'Anuluj' }).click();
    await expect(dialog).toBeHidden();
    await expect(deleteButton(page)).toBeFocused();
    expect(await stored(page)).toEqual(before);
    await expect(card(page, 'Okulista')).toBeVisible();
  });

  test('deletes exactly that appointment, also after a reload', async ({ page }) => {
    await loadDemoData(page);
    await openAppointments(page);
    const before = await stored(page);

    await deleteButton(page).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Usuń wizytę' }).click();

    await expect(page.getByText(/Usunięto wizytę: Okulista/)).toBeVisible();
    await expect(page.getByRole('heading', { level: 2, name: 'Nadchodzące wizyty' })).toBeFocused();
    await page.reload();
    await expect(card(page, 'Okulista')).toHaveCount(0);
    const after = await stored(page);
    expect(after).toHaveLength(before.length - 1);
    expect(after.some((entry) => entry.specialty === 'Okulista')).toBe(false);
    await expect(page.getByRole('tab', { name: 'Nadchodzące (1)' })).toBeVisible();
  });

  test('shows a failed deletion in the dialog and keeps the appointment', async ({ page }) => {
    await loadDemoData(page);
    await openAppointments(page);
    const before = await stored(page);
    await deleteButton(page).click();
    await page.evaluate(() => {
      Storage.prototype.setItem = () => {
        throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
      };
    });

    await page.getByRole('dialog').getByRole('button', { name: 'Usuń wizytę' }).click();

    await expect(page.getByRole('dialog').getByRole('alert')).toContainText('Nie usunięto wizyty.');
    expect(await stored(page)).toEqual(before);
  });

  test('does not offer to delete automatically: an elapsed appointment stays until the user decides', async ({
    page,
  }) => {
    await loadDemoData(page);
    await openAppointments(page, '?tab=past');

    await expect(card(page, 'dr Ewa Demonstracyjna')).toBeVisible();
    expect(
      (await stored(page)).some((entry) => entry.id === 'demo-appointment-needs-confirmation'),
    ).toBe(true);
  });
});

for (const [name, viewport] of [
  ['small phone (360 px)', { width: 360, height: 740 }],
  ['phone (390 px)', { width: 390, height: 844 }],
  ['desktop (1280 px)', { width: 1280, height: 800 }],
] as const) {
  test.describe(`layout on ${name}`, () => {
    test.use({ viewport });

    const overflows = (page: Page) =>
      page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
      );

    test('the list fits in both tabs, and its actions are comfortable to touch', async ({
      page,
    }) => {
      await loadDemoData(page);
      await openAppointments(page);
      expect(await overflows(page)).toBe(false);

      for (const button of [
        page.getByRole('button', { name: /^Oznacz jako odbytą: dr Anna Przykładowska/ }),
        page.getByRole('button', { name: /^Usuń trwale…: Okulista/ }),
        page.getByRole('link', { name: /^Edytuj wizytę: Okulista/ }),
      ]) {
        const box = await button.boundingBox();
        expect(box?.height).toBeGreaterThanOrEqual(44);
        expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(viewport.width);
      }
      for (const tabName of [/^Nadchodzące/, /^Minione/]) {
        const tab = await page.getByRole('tab', { name: tabName }).boundingBox();
        expect(tab?.height).toBeGreaterThanOrEqual(44);
      }
      await page.getByRole('tab', { name: /^Minione/ }).click();
      await expect(page.getByRole('heading', { level: 2, name: 'Minione wizyty' })).toBeVisible();
      expect(await overflows(page)).toBe(false);
    });

    test('the form and the deletion dialog fit', async ({ page }) => {
      await page.goto('/appointments/new');
      await page.getByRole('button', { name: 'Dodaj wizytę' }).click();
      await expect(page.getByText('Wybierz poprawną datę wizyty.')).toBeVisible();
      expect(await overflows(page)).toBe(false);
      for (const label of [/^Lekarz/, /^Data wizyty/, /^Godzina wizyty/]) {
        const box = await page.getByLabel(label).boundingBox();
        expect(box?.height).toBeGreaterThanOrEqual(44);
        expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(viewport.width);
      }

      await loadDemoData(page);
      await openAppointments(page);
      await page.getByRole('button', { name: /^Usuń trwale…: Okulista/ }).click();
      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible();
      const box = await dialog.boundingBox();
      expect(box?.x).toBeGreaterThanOrEqual(0);
      expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(viewport.width);
      for (const label of ['Anuluj', 'Usuń wizytę']) {
        const button = await dialog.getByRole('button', { name: label, exact: true }).boundingBox();
        expect(button?.height).toBeGreaterThanOrEqual(44);
      }
    });

    test('long names, places and notes do not break the layout', async ({ page }) => {
      await page.goto('/appointments/new');
      const long = 'Bardzo-długa-nazwa-bez-spacji-'.repeat(4);
      await fillValid(page, { doctor: long });
      await page.getByRole('textbox', { name: /^Miejsce/ }).fill(long);
      await page.getByLabel(/^Notatki/).fill(long);
      await page.getByRole('button', { name: 'Dodaj wizytę' }).click();
      await expect(page.getByRole('heading', { level: 1, name: 'Wizyty' })).toBeVisible();

      await expect(page.getByText(long, { exact: true }).first()).toBeVisible();
      expect(await overflows(page)).toBe(false);
    });
  });
}
