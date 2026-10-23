import { expect, test, type Page } from '@playwright/test';

// Real browser, real localStorage, demo data loaded through the development page. The demo
// data is dated relative to "today", and so are these tests.

const LOGS_KEY = 'pigoowa:v1:dose-logs';
const MEDICATIONS_KEY = 'pigoowa:v1:medications';

interface StoredLog {
  id: string;
  medicationId: string;
  scheduledDate: string;
  scheduledTime: string;
  status: string;
  doseAmount: number;
  doseUnit: string;
}

async function readItems<T>(page: Page, key: string): Promise<T[]> {
  const raw = await page.evaluate((storageKey) => window.localStorage.getItem(storageKey), key);
  // JSON.parse returns `any`; the storage envelope `{ version, items }` is the app's own format
  // (see README), and the test names the item type it expects.
  return raw === null ? [] : (JSON.parse(raw) as { items: T[] }).items;
}

const logs = (page: Page) => readItems<StoredLog>(page, LOGS_KEY);
const demoxalLogsToday = async (page: Page) => {
  const todayText = await dayOffset(page, 0);
  return (await logs(page)).filter(
    (entry) =>
      entry.medicationId === 'demo-medication-demoxal' && entry.scheduledDate === todayText,
  );
};

/** A date `days` away from today, as the browser (and so the app) sees it: `YYYY-MM-DD`. */
const dayOffset = (page: Page, days: number) =>
  page.evaluate((offset) => {
    const date = new Date();
    date.setDate(date.getDate() + offset);
    return date.toLocaleDateString('en-CA');
  }, days);

async function loadDemoData(page: Page) {
  await page.goto('/dev/data');
  await page.getByRole('button', { name: 'Wczytaj dane demonstracyjne' }).click();
  await expect(page.getByText('Wczytano dane demonstracyjne.')).toBeVisible();
}

async function openDoses(page: Page, query = '') {
  await page.goto(`/doses${query}`);
  await expect(page.getByRole('heading', { level: 1, name: 'Dawki' })).toBeVisible();
}

const takenButton = (page: Page, name: string, time: string) =>
  page.getByRole('button', { name: `Oznacz jako przyjętą: ${name}, ${time}`, exact: true });
const skippedButton = (page: Page, name: string, time: string) =>
  page.getByRole('button', { name: `Oznacz jako pominiętą: ${name}, ${time}`, exact: true });
const clearButton = (page: Page, name: string, time: string) =>
  page.getByRole('button', { name: `Cofnij zapis: ${name}, ${time}`, exact: true });
/** The status of one row, e.g. "Demoxal, 08:00: Przyjęta". */
const statusOf = (page: Page, name: string, time: string) =>
  page.locator('p[tabindex="-1"]').filter({ hasText: `${name}, ${time}:` });

test.describe('the day view', () => {
  test('lists the planned doses of today as unrecorded, never as skipped or missed', async ({
    page,
  }) => {
    await loadDemoData(page);
    await openDoses(page);

    await expect(page.getByRole('heading', { level: 2, name: /^Dziś: / })).toBeVisible();
    for (const [name, time] of [
      ['Przykładyna', '07:30'],
      ['Demoxal', '08:00'],
      ['Testovit', '13:00'],
      ['Demoxal', '20:00'],
    ]) {
      await expect(statusOf(page, name ?? '', time ?? '')).toContainText('Nie zapisano');
    }
    await expect(page.getByText('Pominięta', { exact: true })).toHaveCount(0);
    await expect(page.getByText('Przyjęte: 0. Pominięte: 0. Bez zapisu: 4.')).toBeVisible();
    // Dawnoxin ended before today and has no dose today.
    await expect(page.getByText('Dawnoxin')).toHaveCount(0);
  });

  test('marks taken, changes to skipped, clears: always one record, and it survives a reload', async ({
    page,
  }) => {
    await loadDemoData(page);
    await openDoses(page);
    const logsBefore = (await logs(page)).length;

    await takenButton(page, 'Demoxal', '08:00').click();
    await expect(page.getByText('Zapisano jako przyjętą: Demoxal, 08:00.')).toBeVisible();
    await expect(statusOf(page, 'Demoxal', '08:00')).toContainText('Przyjęta');
    expect(await demoxalLogsToday(page)).toEqual([
      expect.objectContaining({
        scheduledTime: '08:00',
        status: 'taken',
        doseAmount: 1,
        doseUnit: 'tabletka',
      }),
    ]);
    expect(await logs(page)).toHaveLength(logsBefore + 1);

    await page.reload();
    await expect(statusOf(page, 'Demoxal', '08:00')).toContainText('Przyjęta');
    // The 20:00 dose of the same medication is untouched.
    await expect(statusOf(page, 'Demoxal', '20:00')).toContainText('Nie zapisano');

    const [recorded] = await demoxalLogsToday(page);
    await page
      .getByRole('button', { name: 'Zmień na pominiętą: Demoxal, 08:00', exact: true })
      .click();
    await expect(page.getByText(/Zmieniono zapis: Demoxal, 08:00 — teraz pominięta/)).toBeVisible();
    await expect(statusOf(page, 'Demoxal', '08:00')).toContainText('Pominięta');
    const afterChange = await demoxalLogsToday(page);
    expect(afterChange).toHaveLength(1);
    expect(afterChange[0]).toMatchObject({ id: recorded?.id, status: 'skipped' });

    await clearButton(page, 'Demoxal', '08:00').click();
    await expect(page.getByText(/Cofnięto zapis: Demoxal, 08:00/)).toBeVisible();
    await expect(statusOf(page, 'Demoxal', '08:00')).toContainText('Nie zapisano');
    expect(await demoxalLogsToday(page)).toEqual([]);
    expect(await logs(page)).toHaveLength(logsBefore);
  });

  test('a double click records the dose once', async ({ page }) => {
    await loadDemoData(page);
    await openDoses(page);

    await takenButton(page, 'Przykładyna', '07:30').dblclick();

    await expect(statusOf(page, 'Przykładyna', '07:30')).toContainText('Przyjęta');
    const today = await dayOffset(page, 0);
    const records = (await logs(page)).filter(
      (entry) =>
        entry.medicationId === 'demo-medication-przykladyna' && entry.scheduledDate === today,
    );
    expect(records).toHaveLength(1);
  });

  test('keeps the keyboard user in place: focus goes to the dose that changed', async ({
    page,
  }) => {
    await loadDemoData(page);
    await openDoses(page);

    await takenButton(page, 'Testovit', '13:00').focus();
    await page.keyboard.press('Enter');

    await expect(page.getByText('Zapisano jako przyjętą: Testovit, 13:00.')).toBeVisible();
    await expect(statusOf(page, 'Testovit', '13:00')).toBeFocused();
    // The next Tab reaches an action of that same dose.
    await page.keyboard.press('Tab');
    await expect(
      page.getByRole('button', { name: 'Zmień na pominiętą: Testovit, 13:00', exact: true }),
    ).toBeFocused();
  });

  test('shows a failed write as an error and changes nothing', async ({ page }) => {
    await loadDemoData(page);
    await openDoses(page);
    const logsBefore = await logs(page);
    await page.evaluate(() => {
      Storage.prototype.setItem = () => {
        throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
      };
    });

    await takenButton(page, 'Demoxal', '08:00').click();

    await expect(page.getByRole('alert')).toContainText('Nie zapisano zmiany');
    await expect(page.getByRole('alert')).toContainText('brakuje miejsca');
    await expect(page.getByText(/Zapisano jako/)).toHaveCount(0);
    await expect(statusOf(page, 'Demoxal', '08:00')).toContainText('Nie zapisano');
    expect(await logs(page)).toEqual(logsBefore);
  });

  test('shows earlier days with their records, and the records of a changed schedule outside it', async ({
    page,
  }) => {
    await loadDemoData(page);
    const twoDaysAgo = await dayOffset(page, -2);
    await openDoses(page, `?date=${twoDaysAgo}`);

    await expect(statusOf(page, 'Demoxal', '08:00')).toContainText('Przyjęta');
    await expect(statusOf(page, 'Demoxal', '20:00')).toContainText('Pominięta');
    await expect(page.getByText('Przyjęte: 2. Pominięte: 1. Bez zapisu: 1.')).toBeVisible();

    // 12 days ago: before Demoxal's current schedule took effect, so the record is outside it.
    const twelveAgo = await dayOffset(page, -12);
    await openDoses(page, `?date=${twelveAgo}`);
    const outside = page.getByRole('region', { name: /^Wpisy poza aktualnym harmonogramem/ });
    await expect(outside).toBeVisible();
    await expect(outside.getByText('Demoxal')).toBeVisible();
    await expect(outside.getByText('Poza aktualnym harmonogramem', { exact: true })).toBeVisible();
    await expect(outside.getByRole('button')).toHaveCount(0);
  });

  test('moves between days, and does not let the future be recorded', async ({ page }) => {
    await loadDemoData(page);
    await openDoses(page);

    await page.getByRole('button', { name: /Następny dzień/ }).click();
    await expect(page.getByRole('heading', { level: 2, name: /^Jutro: / })).toBeVisible();
    await expect(page.getByText(/To dzień w przyszłości/)).toBeVisible();
    await expect(page.getByRole('button', { name: /Oznacz jako/ })).toHaveCount(0);
    await expect(page).toHaveURL(/\?date=\d{4}-\d{2}-\d{2}$/);

    await page.getByRole('button', { name: /Poprzedni dzień/ }).click();
    await page.getByRole('button', { name: /Poprzedni dzień/ }).click();
    await expect(page.getByRole('heading', { level: 2, name: /^Wczoraj: / })).toBeVisible();

    await page.getByRole('button', { name: 'Dziś', exact: true }).click();
    await expect(page.getByRole('heading', { level: 2, name: /^Dziś: / })).toBeVisible();
    await expect(page).toHaveURL(/\/doses$/);
  });

  test('stock follows taken doses only: skipped and unrecorded doses do not reduce it', async ({
    page,
  }) => {
    await loadDemoData(page);
    await openDoses(page);
    const stock = page.getByRole('region', { name: 'Szacunkowy zapas (stan na dziś)' });
    const demoxalStock = stock.getByRole('listitem').filter({ hasText: 'Demoxal' });
    await expect(demoxalStock).toContainText('Pozostało ok. 28 tabletek');
    await expect(stock.getByRole('listitem').filter({ hasText: 'Testovit' })).toContainText(
      'Szacunek niedostępny: zapas nie został policzony.',
    );

    await skippedButton(page, 'Demoxal', '20:00').click();
    await expect(page.getByText('Zapisano jako pominiętą: Demoxal, 20:00.')).toBeVisible();
    await expect(demoxalStock).toContainText('Pozostało ok. 28 tabletek');

    await takenButton(page, 'Demoxal', '08:00').click();
    await expect(page.getByText('Zapisano jako przyjętą: Demoxal, 08:00.')).toBeVisible();
    await expect(demoxalStock).toContainText('Pozostało ok. 27 tabletek');

    await clearButton(page, 'Demoxal', '08:00').click();
    await expect(page.getByText(/Cofnięto zapis: Demoxal, 08:00/)).toBeVisible();
    await expect(demoxalStock).toContainText('Pozostało ok. 28 tabletek');

    await page.getByText('Jak liczymy szacunkowy zapas?').click();
    await expect(page.getByText(/To szacunek, a nie dokładny stan/)).toBeVisible();
  });

  test('editing the medication afterwards does not rewrite the recorded dose', async ({ page }) => {
    await loadDemoData(page);
    await openDoses(page);
    await takenButton(page, 'Demoxal', '08:00').click();
    await expect(statusOf(page, 'Demoxal', '08:00')).toContainText('Przyjęta');

    await page.goto('/medications');
    await page.getByRole('link', { name: 'Edytuj lek Demoxal' }).click();
    await page.getByRole('textbox', { name: /^Dawka 1/ }).fill('2');
    await page.getByRole('button', { name: 'Zapisz zmiany' }).click();
    await expect(page.getByText(/Zapisano zmiany w leku/)).toBeVisible();

    const [record] = await demoxalLogsToday(page);
    expect(record).toMatchObject({ scheduledTime: '08:00', doseAmount: 1, doseUnit: 'tabletka' });
    await openDoses(page);
    await expect(
      page.getByText('Zapisana dawka: 1 tabletka (obecnie w harmonogramie: 2 tabletki).'),
    ).toBeVisible();
    const medicationsAfter = await readItems<{ id: string }>(page, MEDICATIONS_KEY);
    expect(medicationsAfter).toHaveLength(4);
  });
});

test.describe('the history', () => {
  test('shows recorded doses with the dose as recorded, newest day first, with outside-schedule records labelled', async ({
    page,
  }) => {
    await loadDemoData(page);
    await page.goto('/doses/history');
    await expect(
      page.getByRole('heading', { level: 1, name: 'Historia przyjmowania' }),
    ).toBeVisible();

    await expect(page.getByRole('heading', { name: 'Znaleziono 12 zapisów' })).toBeVisible();
    // Newest day first: yesterday's records come before older ones.
    const days = page.getByRole('heading', { level: 3 });
    const yesterday = await dayOffset(page, -1);
    const first = await days.first().textContent();
    const expected = await page.evaluate((iso) => {
      const [year, month, day] = iso.split('-').map(Number);
      return new Intl.DateTimeFormat('pl-PL', {
        timeZone: 'UTC',
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      }).format(new Date(Date.UTC(year ?? 0, (month ?? 1) - 1, day)));
    }, yesterday);
    expect(first).toBe(expected);
    await expect(page.getByText('Zapisana dawka: 5 ml').first()).toBeVisible();
    await expect(page.getByText('Poza aktualnym harmonogramem')).toHaveCount(1);
    await expect(page.getByText('Pominięta', { exact: true })).toHaveCount(1);
  });

  test('filters by medication, status and date, says when nothing matches, and clears the filters', async ({
    page,
  }) => {
    await loadDemoData(page);
    await page.goto('/doses/history');
    await expect(page.getByRole('heading', { name: 'Znaleziono 12 zapisów' })).toBeVisible();

    await page.getByLabel('Lek').selectOption({ label: 'Demoxal' });
    await expect(page.getByRole('heading', { name: /^Znaleziono 7 zapisów/ })).toBeVisible();
    await page.getByLabel('Status').selectOption('skipped');
    await expect(
      page.getByRole('heading', { name: 'Znaleziono 1 zapis dla wybranych filtrów' }),
    ).toBeVisible();
    await expect(page).toHaveURL(/medication=demo-medication-demoxal&status=skipped/);

    await page.getByLabel('Lek').selectOption({ label: 'Testovit' });
    await expect(
      page.getByRole('heading', { name: 'Brak zapisów dla wybranych filtrów' }),
    ).toBeVisible();

    await page
      .getByRole('heading', { name: 'Brak zapisów dla wybranych filtrów' })
      .locator('..')
      .getByRole('button', { name: 'Wyczyść filtry' })
      .click();
    await expect(page.getByRole('heading', { name: 'Znaleziono 12 zapisów' })).toBeVisible();

    const recent = await dayOffset(page, -3);
    await page.getByLabel('Od dnia').fill(recent);
    await expect(page.getByRole('heading', { name: /^Znaleziono 9 zapisów/ })).toBeVisible();
  });

  test('keeps the filters after a reload', async ({ page }) => {
    await loadDemoData(page);
    await page.goto('/doses/history?medication=demo-medication-przykladyna');

    await expect(page.getByRole('heading', { name: /^Znaleziono 3 zapisy/ })).toBeVisible();
    await expect(page.getByLabel('Lek')).toHaveValue('demo-medication-przykladyna');
  });

  test('shows the record made in the day view', async ({ page }) => {
    await loadDemoData(page);
    await openDoses(page);
    await takenButton(page, 'Testovit', '13:00').click();
    await expect(page.getByText('Zapisano jako przyjętą: Testovit, 13:00.')).toBeVisible();

    await page.getByRole('link', { name: 'Historia przyjmowania' }).click();

    await expect(page.getByRole('heading', { name: 'Znaleziono 13 zapisów' })).toBeVisible();
    await page.getByLabel('Lek').selectOption({ label: 'Testovit' });
    await expect(page.getByRole('heading', { name: /^Znaleziono 1 zapis/ })).toBeVisible();
  });
});

test.describe('correcting a record outside the current schedule', () => {
  const deleteButton = (page: Page) => page.getByRole('button', { name: /^Usuń zapis…: Demoxal/ });

  test('is offered only for the record that no longer matches the schedule', async ({ page }) => {
    await loadDemoData(page);
    await page.goto('/doses/history');
    await expect(page.getByRole('heading', { name: 'Znaleziono 12 zapisów' })).toBeVisible();

    // Demo data has exactly one such record (Demoxal, from before its schedule changed).
    await expect(page.getByRole('button', { name: /^Usuń zapis…/ })).toHaveCount(1);
    await expect(deleteButton(page)).toBeVisible();
  });

  test('Cancel and Escape change nothing and give focus back to the button', async ({ page }) => {
    await loadDemoData(page);
    await page.goto('/doses/history');
    const logsBefore = await logs(page);

    await deleteButton(page).click();
    const dialog = page.getByRole('dialog', { name: 'Usunąć ten zapis z historii?' });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('trwale usunięty');
    await expect(dialog).toContainText('Tej operacji nie można cofnąć');
    await expect(dialog.getByRole('button', { name: 'Anuluj' })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(deleteButton(page)).toBeFocused();

    await deleteButton(page).click();
    await dialog.getByRole('button', { name: 'Anuluj' }).click();
    await expect(dialog).toBeHidden();
    await expect(deleteButton(page)).toBeFocused();
    expect(await logs(page)).toEqual(logsBefore);
  });

  test('deletes exactly that record, keeps everything else, and survives a reload', async ({
    page,
  }) => {
    await loadDemoData(page);
    await page.goto('/doses/history');
    const logsBefore = await logs(page);
    const demoxalBefore = logsBefore.filter(
      (entry) => entry.medicationId === 'demo-medication-demoxal',
    );

    await deleteButton(page).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Usuń zapis' }).click();

    await expect(page.getByText(/^Usunięto zapis: Demoxal/)).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Znaleziono 11 zapisów' })).toBeFocused();
    await expect(page.getByRole('button', { name: /^Usuń zapis…/ })).toHaveCount(0);
    const logsAfter = await logs(page);
    expect(logsAfter).toHaveLength(logsBefore.length - 1);
    const removed = logsBefore.filter((entry) => !logsAfter.some((kept) => kept.id === entry.id));
    expect(removed).toHaveLength(1);
    expect(removed[0]?.medicationId).toBe('demo-medication-demoxal');
    expect(
      logsAfter.filter((entry) => entry.medicationId === 'demo-medication-demoxal'),
    ).toHaveLength(demoxalBefore.length - 1);

    await page.reload();
    await expect(page.getByRole('heading', { name: 'Znaleziono 11 zapisów' })).toBeVisible();
  });

  test('shows a failed deletion in the dialog and keeps the record', async ({ page }) => {
    await loadDemoData(page);
    await page.goto('/doses/history');
    const logsBefore = await logs(page);
    await deleteButton(page).click();
    await page.evaluate(() => {
      Storage.prototype.setItem = () => {
        throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
      };
    });

    await page.getByRole('dialog').getByRole('button', { name: 'Usuń zapis' }).click();

    await expect(page.getByRole('dialog').getByRole('alert')).toContainText('Nie usunięto zapisu.');
    await expect(page.getByText(/^Usunięto zapis/)).toHaveCount(0);
    expect(await logs(page)).toEqual(logsBefore);
  });

  test('the day view points there', async ({ page }) => {
    await loadDemoData(page);
    await openDoses(page, `?date=${await dayOffset(page, -12)}`);

    await page.getByRole('link', { name: 'Zobacz te zapisy w historii' }).click();

    await expect(
      page.getByRole('heading', { name: 'Znaleziono 2 zapisy dla wybranych filtrów' }),
    ).toBeVisible();
    // Of the two records of that day (Demoxal and Dawnoxin), only Demoxal's is outside its schedule.
    await expect(page.getByRole('button', { name: /^Usuń zapis…/ })).toHaveCount(1);
    await expect(deleteButton(page)).toBeVisible();
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

    test('the day view fits, and its actions are comfortable to touch', async ({ page }) => {
      await loadDemoData(page);
      await openDoses(page);
      expect(await overflows(page)).toBe(false);

      for (const button of [
        takenButton(page, 'Demoxal', '08:00'),
        skippedButton(page, 'Demoxal', '08:00'),
      ]) {
        const box = await button.boundingBox();
        expect(box?.height).toBeGreaterThanOrEqual(44);
        expect(box?.x).toBeGreaterThanOrEqual(0);
        expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(viewport.width);
      }
      // Both statuses and their buttons also fit.
      await takenButton(page, 'Demoxal', '08:00').click();
      await expect(statusOf(page, 'Demoxal', '08:00')).toContainText('Przyjęta');
      expect(await overflows(page)).toBe(false);
      await page.getByLabel('Przejdź do dnia').focus();
      expect(await overflows(page)).toBe(false);
    });

    test('the history and its filters fit', async ({ page }) => {
      await loadDemoData(page);
      await page.goto('/doses/history');
      await expect(page.getByRole('heading', { name: /^Znaleziono/ })).toBeVisible();

      expect(await overflows(page)).toBe(false);
      for (const label of ['Od dnia', 'Do dnia', 'Lek', 'Status']) {
        const box = await page.getByLabel(label).boundingBox();
        expect(box?.height).toBeGreaterThanOrEqual(44);
        expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(viewport.width);
      }
    });

    test('the deletion dialog fits and its buttons are comfortable to touch', async ({ page }) => {
      await loadDemoData(page);
      await page.goto('/doses/history');
      await page.getByRole('button', { name: /^Usuń zapis…: Demoxal/ }).click();

      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible();
      const box = await dialog.boundingBox();
      expect(box?.x).toBeGreaterThanOrEqual(0);
      expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(viewport.width);
      for (const label of ['Anuluj', 'Usuń zapis']) {
        const button = await dialog.getByRole('button', { name: label, exact: true }).boundingBox();
        expect(button?.height).toBeGreaterThanOrEqual(44);
      }
      expect(await overflows(page)).toBe(false);
    });

    test('long names and units do not break the layout', async ({ page }) => {
      await page.goto('/medications/new');
      const longName = 'Bardzo-długa-nazwa-leku-bez-spacji-'.repeat(3);
      await page.getByRole('textbox', { name: /^Nazwa leku/ }).fill(longName);
      await page
        .getByRole('textbox', { name: /^Jednostka dawki/ })
        .fill('niestandardowajednostkadawki');
      await page.getByLabel(/^Godzina 1/).fill('08:00');
      await page.getByRole('textbox', { name: /^Dawka 1/ }).fill('1');
      await page.getByRole('button', { name: 'Dodaj lek', exact: true }).click();
      await expect(page.getByRole('heading', { level: 1, name: 'Leki' })).toBeVisible();

      await openDoses(page);
      await expect(statusOf(page, longName, '08:00')).toBeVisible();
      expect(await overflows(page)).toBe(false);
      await page.goto('/doses/history');
      expect(await overflows(page)).toBe(false);
    });
  });
}
