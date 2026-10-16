import { expect, test, type Page } from '@playwright/test';

// The main journey of the MVP, in one real browser session with a fixed clock (Thursday 15 October
// 2026, 12:00 in Warsaw) and an empty storage: first visit -> add a medication -> see it on the
// list and the dashboard -> record a dose and see it kept after a reload -> history -> add an
// appointment -> see it on the dashboard -> edit it -> cancel it and restore it. Every step checks
// the effect (what is shown and what is stored), not only that some text is present.

const NOW = new Date('2026-10-15T10:00:00Z');

test.use({ timezoneId: 'Europe/Warsaw', locale: 'pl-PL' });

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(NOW);
});

const region = (page: Page, name: string) => page.getByRole('region', { name });

async function stored<T>(page: Page, key: string): Promise<T[]> {
  const raw = await page.evaluate((storageKey) => window.localStorage.getItem(storageKey), key);
  // JSON.parse returns `any`; the storage envelope `{ version, items }` is the app's own format
  // (see README), and the test names the item type it expects.
  return raw === null ? [] : (JSON.parse(raw) as { items: T[] }).items;
}

test('the main journey: from an empty start to a medication, a recorded dose and an appointment', async ({
  page,
}) => {
  // 1. First visit: an empty dashboard that explains what to do, and says it is a demo.
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1, name: 'Pulpit' })).toBeVisible();
  await expect(
    page.getByRole('region', { name: 'Informacja o wersji demonstracyjnej' }),
  ).toContainText('dane fikcyjne');
  await expect(
    region(page, 'Dzisiejsze dawki').getByText('Nie dodano jeszcze żadnego leku'),
  ).toBeVisible();
  await expect(
    region(page, 'Najbliższe wizyty').getByText('Nie dodano jeszcze żadnej wizyty'),
  ).toBeVisible();
  expect(await stored(page, 'pigoowa:v1:medications')).toEqual([]);

  // 2. Add a medication with two doses a day and a stock.
  await region(page, 'Dzisiejsze dawki').getByRole('link', { name: 'Dodaj pierwszy lek' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Dodaj lek' })).toBeVisible();
  await page.getByRole('textbox', { name: /^Nazwa leku/ }).fill('Lek przykładowy');
  await page.getByRole('textbox', { name: /^Jednostka dawki/ }).fill('tabletka');
  await page.getByLabel(/^Godzina 1/).fill('08:00');
  await page.getByRole('textbox', { name: /^Dawka 1/ }).fill('1');
  await page.getByRole('button', { name: 'Dodaj godzinę' }).click();
  await page.getByLabel(/^Godzina 2/).fill('20:00');
  await page.getByRole('textbox', { name: /^Dawka 2/ }).fill('1');
  await page.getByRole('textbox', { name: /^Aktualny zapas/ }).fill('10');
  await page.getByRole('button', { name: 'Dodaj lek', exact: true }).click();

  // 3. It is on the list, with its schedule, and nothing else was invented.
  await expect(page.getByText('Dodano lek „Lek przykładowy”.')).toBeVisible();
  const card = page.getByRole('article', { name: 'Lek przykładowy' });
  await expect(card).toContainText('08:00 — 1 tabletka');
  await expect(card).toContainText('20:00 — 1 tabletka');
  await expect(card).toContainText('Pozostało ok. 10 tabletek');
  const [medication] = await stored<{ name: string; scheduleTimes: unknown[] }>(
    page,
    'pigoowa:v1:medications',
  );
  expect(medication?.name).toBe('Lek przykładowy');
  expect(medication?.scheduleTimes).toHaveLength(2);
  expect(await stored(page, 'pigoowa:v1:dose-logs')).toEqual([]); // planned doses are not stored

  // 4. The dashboard shows today's two doses (unrecorded) and the stock, flagged as low.
  await page.getByRole('link', { name: 'Pulpit', exact: true }).click();
  const doses = region(page, 'Dzisiejsze dawki');
  await expect(
    doses.getByText('Przyjęte: 0. Pominięte: 0. Bez zapisu: 2. Razem dziś: 2.'),
  ).toBeVisible();
  const stock = region(page, 'Zapasy leków');
  await expect(stock.getByText('Pozostało ok. 10 tabletek, wystarczy na ok. 5 dni.')).toBeVisible();
  await expect(stock.getByText('Niski zapas')).toBeVisible();

  // 5. Record the morning dose as taken: the counts and the stock follow, and it survives a reload.
  await page.getByRole('button', { name: 'Oznacz jako przyjętą: Lek przykładowy, 08:00' }).click();
  await expect(doses.getByText('Zapisano jako przyjętą: Lek przykładowy, 08:00.')).toBeVisible();
  await expect(
    doses.getByText('Przyjęte: 1. Pominięte: 0. Bez zapisu: 1. Razem dziś: 2.'),
  ).toBeVisible();
  await expect(stock.getByText('Pozostało ok. 9 tabletek, wystarczy na ok. 4 dni.')).toBeVisible();
  await page.reload();
  await expect(
    region(page, 'Dzisiejsze dawki').getByText(
      'Przyjęte: 1. Pominięte: 0. Bez zapisu: 1. Razem dziś: 2.',
    ),
  ).toBeVisible();
  const logs = await stored<{
    status: string;
    scheduledTime: string;
    doseAmount: number;
    doseUnit: string;
  }>(page, 'pigoowa:v1:dose-logs');
  expect(logs).toEqual([
    expect.objectContaining({
      status: 'taken',
      scheduledTime: '08:00',
      doseAmount: 1,
      doseUnit: 'tabletka',
    }),
  ]);

  // 6. The day view and the history show it, with the dose as it was recorded.
  await page.getByRole('link', { name: 'Dawki', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Dawki' })).toBeVisible();
  await expect(
    page.locator('p[tabindex="-1"]').filter({ hasText: 'Lek przykładowy, 08:00:' }),
  ).toContainText('Przyjęta');
  await page.getByRole('link', { name: 'Historia przyjmowania' }).click();
  await expect(page.getByRole('heading', { name: 'Znaleziono 1 zapis' })).toBeVisible();
  await expect(page.getByText('Zapisana dawka: 1 tabletka')).toBeVisible();

  // 7. Add an appointment: it is listed under Upcoming and shown on the dashboard.
  await page.getByRole('link', { name: 'Pulpit', exact: true }).click();
  await region(page, 'Najbliższe wizyty')
    .getByRole('link', { name: 'Dodaj pierwszą wizytę' })
    .click();
  await page.getByRole('textbox', { name: /^Lekarz/ }).fill('dr Testowa');
  await page.getByRole('textbox', { name: /^Specjalizacja/ }).fill('Kardiolog');
  await page.getByLabel(/^Data wizyty/).fill('2026-10-20');
  await page.getByLabel(/^Godzina wizyty/).fill('10:00');
  await page.getByRole('button', { name: 'Dodaj wizytę', exact: true }).click();
  await expect(page.getByText('Dodano wizytę: dr Testowa.')).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Nadchodzące (1)' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await page.getByRole('link', { name: 'Pulpit', exact: true }).click();
  const appointments = region(page, 'Najbliższe wizyty');
  await expect(appointments.getByRole('listitem')).toHaveCount(1);
  await expect(appointments).toContainText('wtorek, 20 października 2026, 10:00');
  await expect(appointments).toContainText('dr Testowa');

  // 8. Edit it: the new time is kept after a reload; the status is not touched by an edit.
  await page.getByRole('link', { name: 'Wizyty', exact: true }).click();
  await page.getByRole('link', { name: /^Edytuj wizytę: dr Testowa/ }).click();
  await page.getByLabel(/^Godzina wizyty/).fill('11:30');
  await page.getByRole('textbox', { name: /^Miejsce/ }).fill('Gabinet 5');
  await page.getByRole('button', { name: 'Zapisz zmiany' }).click();
  await expect(page.getByText('Zapisano zmiany w wizycie: dr Testowa.')).toBeVisible();
  await page.reload();
  await expect(page.getByRole('listitem').filter({ hasText: 'dr Testowa' })).toContainText('11:30');
  await expect(page.getByRole('listitem').filter({ hasText: 'dr Testowa' })).toContainText(
    'Gabinet 5',
  );
  const [appointment] = await stored<{ status: string; scheduledAt: string }>(
    page,
    'pigoowa:v1:appointments',
  );
  expect(appointment).toMatchObject({
    status: 'scheduled',
    scheduledAt: '2026-10-20T09:30:00.000Z',
  });

  // 9. Cancel it: it moves to the past list as "Odwołana" and the dashboard has nothing upcoming.
  await page.getByRole('button', { name: /^Oznacz jako odwołaną: dr Testowa/ }).click();
  await expect(page.getByText(/Oznaczono jako odwołaną: dr Testowa/)).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Minione (1)' })).toBeVisible();
  await page.getByRole('tab', { name: 'Minione (1)' }).click();
  await expect(page.getByRole('listitem').filter({ hasText: 'dr Testowa' })).toContainText(
    'Odwołana',
  );
  await page.getByRole('link', { name: 'Pulpit', exact: true }).click();
  await expect(
    region(page, 'Najbliższe wizyty').getByText('Brak nadchodzących wizyt'),
  ).toBeVisible();

  // 10. Restore it: it is upcoming again (the correction goes through "scheduled").
  await page.getByRole('link', { name: 'Wizyty', exact: true }).click();
  await page.getByRole('tab', { name: 'Minione (1)' }).click();
  await page.getByRole('button', { name: /^Przywróć jako zaplanowaną: dr Testowa/ }).click();
  await expect(page.getByText(/Przywrócono jako zaplanowaną: dr Testowa/)).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Nadchodzące (1)' })).toBeVisible();
  expect((await stored<{ status: string }>(page, 'pigoowa:v1:appointments'))[0]?.status).toBe(
    'scheduled',
  );
});

test('the main actions can be done with the keyboard alone', async ({ page }) => {
  // Set up one medication and one appointment through the repositories' own storage keys is not
  // allowed to shortcut the UI, so this journey starts from the demo data like a reviewer would.
  await page.goto('/dev/data');
  await page.getByRole('button', { name: 'Wczytaj dane demonstracyjne' }).click();
  await expect(page.getByText('Wczytano dane demonstracyjne.')).toBeVisible();
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1, name: 'Pulpit' })).toBeVisible();

  // Skip the navigation straight to the content, then mark a dose with Enter.
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Przejdź do treści' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('#main-content')).toBeFocused();
  await page.getByRole('button', { name: 'Oznacz jako przyjętą: Przykładyna, 07:30' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByText('Zapisano jako przyjętą: Przykładyna, 07:30.')).toBeVisible();
  // Focus stays on that dose, and the next Tab reaches an action of the same dose.
  await expect(
    page.locator('p[tabindex="-1"]').filter({ hasText: 'Przykładyna, 07:30:' }),
  ).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(
    page.getByRole('button', { name: 'Zmień na pominiętą: Przykładyna, 07:30' }),
  ).toBeFocused();

  // Reach "Dodaj wizytę" with the keyboard, fill the form by typing, and submit with Enter.
  await page.goto('/appointments');
  await expect(page.getByRole('heading', { level: 1, name: 'Wizyty' })).toBeVisible();
  await page.getByRole('link', { name: 'Dodaj wizytę' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { level: 1, name: 'Dodaj wizytę' })).toBeVisible();
  await page.getByRole('textbox', { name: /^Lekarz/ }).focus();
  await page.keyboard.type('dr Klawiatura');
  await page.keyboard.press('Tab'); // Specjalizacja is reachable right after the doctor field.
  await expect(page.getByRole('textbox', { name: /^Specjalizacja/ })).toBeFocused();
  // The segments of a native date/time field follow the browser's UI language (day-month-year or
  // month-day-year, 12 or 24 hours), which the test cannot control, so these two are filled in.
  await page.getByLabel(/^Data wizyty/).fill('2026-10-20');
  await page.getByLabel(/^Godzina wizyty/).fill('10:30');
  await page.getByRole('button', { name: 'Dodaj wizytę', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByText('Dodano wizytę: dr Klawiatura.')).toBeVisible();

  // The tabs work with the arrow keys.
  await page.getByRole('tab', { name: /^Nadchodzące/ }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', { name: /^Minione/ })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await page.keyboard.press('ArrowLeft');
  await expect(page.getByRole('tab', { name: /^Nadchodzące/ })).toHaveAttribute(
    'aria-selected',
    'true',
  );

  // The delete dialog opens with focus on Cancel, Escape closes it and gives focus back.
  const deleteButton = page.getByRole('button', { name: /^Usuń trwale…: dr Klawiatura/ });
  await deleteButton.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog').getByRole('button', { name: 'Anuluj' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toBeHidden();
  await expect(deleteButton).toBeFocused();
});
