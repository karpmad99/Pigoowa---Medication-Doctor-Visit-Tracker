import { expect, test, type Page } from '@playwright/test';

// Real browser, real localStorage. Every Playwright test starts with an empty storage.

const MEDICATIONS_KEY = 'pigoowa:v1:medications';
const LOGS_KEY = 'pigoowa:v1:dose-logs';
const EVENTS_KEY = 'pigoowa:v1:stock-events';

interface StoredMedication {
  id: string;
  name: string;
  endDate: string | null;
  scheduleEffectiveFrom: string;
  scheduleTimes: { id: string; timeOfDay: string; doseAmount: number }[];
  stock: { quantity: number; unit: string; asOf: string } | null;
}

async function readItems<T>(page: Page, key: string): Promise<T[]> {
  const raw = await page.evaluate((storageKey) => window.localStorage.getItem(storageKey), key);
  // JSON.parse returns `any`; the storage envelope `{ version, items }` is the app's own format
  // (see README), and the test names the item type it expects.
  return raw === null ? [] : (JSON.parse(raw) as { items: T[] }).items;
}

const medications = (page: Page) => readItems<StoredMedication>(page, MEDICATIONS_KEY);
const logs = (page: Page) => readItems<{ id: string; medicationId: string }>(page, LOGS_KEY);
const stockEvents = (page: Page) =>
  readItems<{ id: string; medicationId: string }>(page, EVENTS_KEY);

/** Today as the browser sees it (the app uses the same time zone). */
const today = (page: Page) => page.evaluate(() => new Date().toLocaleDateString('en-CA'));

async function loadDemoData(page: Page) {
  await page.goto('/dev/data');
  await page.getByRole('button', { name: 'Wczytaj dane demonstracyjne' }).click();
  await expect(page.getByText('Wczytano dane demonstracyjne.')).toBeVisible();
}

async function openMedications(page: Page) {
  await page.goto('/medications');
  await expect(page.getByRole('heading', { level: 1, name: 'Leki' })).toBeVisible();
}

async function fillValidForm(page: Page, name = 'Moj lek') {
  await page.getByRole('textbox', { name: /^Nazwa leku/ }).fill(name);
  await page.getByRole('textbox', { name: /^Jednostka dawki/ }).fill('tabletka');
  await page.getByLabel(/^Godzina 1/).fill('08:00');
  await page.getByRole('textbox', { name: /^Dawka 1/ }).fill('1');
}

test.describe('adding a medication', () => {
  test('from the empty state to a saved medication that survives a reload', async ({ page }) => {
    await openMedications(page);
    await expect(
      page.getByRole('heading', { name: 'Nie dodano jeszcze żadnego leku' }),
    ).toBeVisible();

    await page.getByRole('link', { name: 'Dodaj pierwszy lek' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Dodaj lek' })).toBeVisible();
    await fillValidForm(page);
    await page.getByRole('button', { name: 'Dodaj godzinę' }).click();
    await page.getByLabel(/^Godzina 2/).fill('20:00');
    await page.getByRole('textbox', { name: /^Dawka 2/ }).fill('0,5');
    await page.getByRole('textbox', { name: /^Aktualny zapas/ }).fill('28');
    await page.getByRole('button', { name: 'Dodaj lek' }).click();

    await expect(page).toHaveURL(/\/medications$/);
    await expect(page.getByText('Dodano lek „Moj lek”.')).toBeVisible();
    const card = page.getByRole('article', { name: 'Moj lek' });
    await expect(card.getByText('08:00 — 1 tabletka')).toBeVisible();
    await expect(card.getByText('20:00 — 0,5 tabletki')).toBeVisible();
    await expect(card.getByText(/Pozostało ok\. 28 tabletek/)).toBeVisible();

    await page.reload();

    await expect(page.getByRole('article', { name: 'Moj lek' })).toBeVisible();
    await expect(page.getByText('Dodano lek')).toHaveCount(0);
    const saved = await medications(page);
    expect(saved).toHaveLength(1);
    expect(saved[0]?.scheduleEffectiveFrom).toBe(await today(page));
    expect(saved[0]?.stock).toMatchObject({ quantity: 28, unit: 'tabletka' });
  });

  test('shows validation errors at the fields, focuses the first one, and keeps the input', async ({
    page,
  }) => {
    await page.goto('/medications/new');
    await page.getByRole('textbox', { name: /^Notatki/ }).fill('Moja notatka');

    await page.getByRole('button', { name: 'Dodaj lek' }).click();

    const name = page.getByRole('textbox', { name: /^Nazwa leku/ });
    await expect(name).toBeFocused();
    await expect(name).toHaveAttribute('aria-invalid', 'true');
    await expect(page.getByText('Wpisz nazwę leku.')).toBeVisible();
    await expect(
      page.getByText('Wpisz godzinę w formacie GG:MM, na przykład 07:30.'),
    ).toBeVisible();
    await expect(page.getByRole('textbox', { name: /^Notatki/ })).toHaveValue('Moja notatka');
    expect(await medications(page)).toEqual([]);

    await fillValidForm(page);
    await page.getByRole('button', { name: 'Dodaj lek' }).click();
    await expect(page).toHaveURL(/\/medications$/);
  });

  test('refuses the same time twice and an end date before the start', async ({ page }) => {
    await page.goto('/medications/new');
    await fillValidForm(page);
    await page.getByRole('button', { name: 'Dodaj godzinę' }).click();
    await expect(page.getByLabel(/^Godzina 2/)).toBeFocused();
    await page.getByLabel(/^Godzina 2/).fill('08:00');
    await page.getByRole('textbox', { name: /^Dawka 2/ }).fill('1');
    await page.getByLabel(/^Data rozpoczęcia/).fill('2026-10-10');
    await page.getByLabel(/^Data zakończenia/).fill('2026-10-09');

    await page.getByRole('button', { name: 'Dodaj lek' }).click();

    await expect(page.getByText(/Ta godzina jest już na liście/)).toBeVisible();
    await expect(page.getByText(/nie może być wcześniejsza niż data rozpoczęcia/)).toBeVisible();
    expect(await medications(page)).toEqual([]);
  });

  test('a double click creates one medication', async ({ page }) => {
    await page.goto('/medications/new');
    await fillValidForm(page);

    await page.getByRole('button', { name: 'Dodaj lek' }).dblclick();

    await expect(page).toHaveURL(/\/medications$/);
    await expect(page.getByRole('article')).toHaveCount(1);
    expect(await medications(page)).toHaveLength(1);
  });

  test('removes a schedule row and renumbers the rest', async ({ page }) => {
    await page.goto('/medications/new');
    await page.getByLabel(/^Godzina 1/).fill('08:00');
    await page.getByRole('button', { name: 'Dodaj godzinę' }).click();
    await page.getByLabel(/^Godzina 2/).fill('20:00');

    await page.getByRole('button', { name: 'Usuń godzinę 1' }).click();

    await expect(page.getByLabel(/^Godzina 2/)).toHaveCount(0);
    await expect(page.getByLabel(/^Godzina 1/)).toHaveValue('20:00');
    await expect(page.getByRole('button', { name: 'Dodaj godzinę' })).toBeFocused();
  });
});

test.describe('the list with demo data', () => {
  test('shows examples, ended medications and honest stock estimates', async ({ page }) => {
    await loadDemoData(page);
    await openMedications(page);

    await expect(
      page.getByRole('heading', { level: 2, name: 'Aktywne i zaplanowane (3)' }),
    ).toBeVisible();
    await expect(page.getByRole('heading', { level: 2, name: 'Zakończone (1)' })).toBeVisible();
    const demoxal = page.getByRole('article', { name: 'Demoxal' });
    await expect(demoxal.getByText('Przykład', { exact: true })).toBeVisible();
    await expect(demoxal.getByText('08:00 — 1 tabletka')).toBeVisible();
    await expect(demoxal.getByText(/Pozostało ok\. 28 tabletek/)).toBeVisible();
    await expect(
      page
        .getByRole('article', { name: 'Testovit' })
        .getByText('Szacunek niedostępny: zapas nie został policzony.'),
    ).toBeVisible();
    await expect(
      page.getByRole('article', { name: 'Dawnoxin' }).getByText('Zakończony'),
    ).toBeVisible();
  });
});

test.describe('editing a medication', () => {
  test('renaming does not move scheduleEffectiveFrom; changing the schedule does; history stays untouched', async ({
    page,
  }) => {
    await loadDemoData(page);
    await openMedications(page);
    const before = (await medications(page)).find((medication) => medication.name === 'Demoxal');
    const logsBefore = await logs(page);

    await page.getByRole('link', { name: 'Edytuj lek Demoxal' }).click();
    await page.getByRole('textbox', { name: /^Nazwa leku/ }).fill('Demoxal Forte');
    await page.getByRole('button', { name: 'Zapisz zmiany' }).click();
    await expect(page.getByText('Zapisano zmiany w leku „Demoxal Forte”.')).toBeVisible();
    const renamed = (await medications(page)).find(
      (medication) => medication.name === 'Demoxal Forte',
    );
    expect(renamed?.scheduleEffectiveFrom).toBe(before?.scheduleEffectiveFrom);
    expect(renamed?.stock?.asOf).toBe(before?.stock?.asOf);

    await page.getByRole('link', { name: 'Edytuj lek Demoxal Forte' }).click();
    await page.getByLabel(/^Godzina 1/).fill('07:45');
    await page.getByRole('button', { name: 'Zapisz zmiany' }).click();
    await expect(page.getByText(/Zapisano zmiany/)).toBeVisible();

    const changed = (await medications(page)).find(
      (medication) => medication.name === 'Demoxal Forte',
    );
    expect(changed?.scheduleEffectiveFrom).toBe(await today(page));
    expect(changed?.scheduleTimes.map((entry) => entry.timeOfDay).sort()).toEqual([
      '07:45',
      '20:00',
    ]);
    expect(await logs(page)).toEqual(logsBefore);
  });

  test('a failed save keeps the form and what was typed', async ({ page }) => {
    await loadDemoData(page);
    await openMedications(page);
    await page.getByRole('link', { name: 'Edytuj lek Testovit' }).click();
    await page.getByRole('textbox', { name: /^Nazwa leku/ }).fill('Testovit Plus');
    await page.evaluate(() => {
      Storage.prototype.setItem = function () {
        throw new DOMException('full', 'QuotaExceededError');
      };
    });

    await page.getByRole('button', { name: 'Zapisz zmiany' }).click();

    await expect(page.getByRole('alert').filter({ hasText: 'Nie zapisano leku' })).toBeVisible();
    await expect(page.getByRole('textbox', { name: /^Nazwa leku/ })).toHaveValue('Testovit Plus');
    await expect(page.getByText(/Zapisano zmiany/)).toHaveCount(0);
    expect(
      (await medications(page)).some((medication) => medication.name === 'Testovit Plus'),
    ).toBe(false);
  });
});

test.describe('ending a medication', () => {
  test('keeps every intake record and the medication moves to "Zakończone" after its last day', async ({
    page,
  }) => {
    await loadDemoData(page);
    await openMedications(page);
    const logsBefore = await logs(page);

    await page.getByRole('button', { name: 'Zakończ lek Testovit' }).click();
    const dialog = page.getByRole('dialog', { name: 'Zakończyć lek „Testovit”?' });
    await expect(dialog.getByLabel(/Ostatni dzień przyjmowania/)).toHaveValue(await today(page));
    await dialog.getByLabel(/Ostatni dzień przyjmowania/).fill('2000-01-01');
    await dialog.getByRole('button', { name: 'Zakończ lek' }).click();
    await expect(dialog.getByText(/nie może być wcześniejszy niż data rozpoczęcia/)).toBeVisible();

    const yesterday = await page.evaluate(() => {
      const date = new Date();
      date.setDate(date.getDate() - 1);
      return date.toLocaleDateString('en-CA');
    });
    await dialog.getByLabel(/Ostatni dzień przyjmowania/).fill(yesterday);
    await dialog.getByRole('button', { name: 'Zakończ lek' }).click();

    await expect(
      page.getByText('Zakończono lek „Testovit”. Historia przyjmowania została zachowana.'),
    ).toBeVisible();
    await expect(page.getByRole('heading', { level: 2, name: 'Zakończone (2)' })).toBeVisible();
    expect(await logs(page)).toEqual(logsBefore);
    await page.reload();
    await expect(page.getByRole('heading', { level: 2, name: 'Zakończone (2)' })).toBeVisible();
  });
});

test.describe('deleting a medication permanently', () => {
  test('states the consequences and the number of records, and Cancel changes nothing', async ({
    page,
  }) => {
    await loadDemoData(page);
    await openMedications(page);
    const logsBefore = await logs(page);

    await page.getByRole('button', { name: 'Usuń trwale… lek Demoxal' }).click();

    const dialog = page.getByRole('dialog', { name: 'Trwale usunąć lek „Demoxal”?' });
    await expect(dialog).toContainText('cała historia przyjmowania: 7 zapisów');
    // The demo data has three stock events for it, and the dialog says they go too.
    await expect(dialog).toContainText('oraz historia zapasu: 3 zdarzenia');
    await expect(dialog).toContainText('Tej operacji nie można cofnąć');
    await expect(dialog.getByRole('button', { name: 'Zakończ lek zamiast usuwać' })).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Anuluj' })).toBeFocused();

    await dialog.getByRole('button', { name: 'Anuluj' }).click();

    await expect(dialog).toBeHidden();
    expect(await logs(page)).toEqual(logsBefore);
    expect((await medications(page)).some((medication) => medication.name === 'Demoxal')).toBe(
      true,
    );
  });

  test('Escape closes the dialog without deleting and returns focus to the button', async ({
    page,
  }) => {
    await loadDemoData(page);
    await openMedications(page);
    const logsBefore = await logs(page);

    await page.getByRole('button', { name: 'Usuń trwale… lek Demoxal' }).click();
    await expect(page.getByRole('dialog', { name: 'Trwale usunąć lek „Demoxal”?' })).toBeVisible();
    await page.keyboard.press('Escape');

    await expect(page.getByRole('dialog')).toBeHidden();
    await expect(page.getByRole('button', { name: 'Usuń trwale… lek Demoxal' })).toBeFocused();
    expect(await logs(page)).toEqual(logsBefore);
  });

  test('"end instead" keeps the whole history', async ({ page }) => {
    await loadDemoData(page);
    await openMedications(page);
    const logsBefore = await logs(page);

    await page.getByRole('button', { name: 'Usuń trwale… lek Demoxal' }).click();
    await page.getByRole('button', { name: 'Zakończ lek zamiast usuwać' }).click();
    const endDialog = page.getByRole('dialog', { name: 'Zakończyć lek „Demoxal”?' });
    await expect(endDialog).toBeVisible();
    await endDialog.getByRole('button', { name: 'Zakończ lek' }).click();

    await expect(page.getByText(/Zakończono lek „Demoxal”/)).toBeVisible();
    expect(await logs(page)).toEqual(logsBefore);
    const demoxal = (await medications(page)).find((medication) => medication.name === 'Demoxal');
    expect(demoxal?.endDate).toBe(await today(page));
  });

  test('on confirmation removes the medication and exactly its history, also after a reload', async ({
    page,
  }) => {
    await loadDemoData(page);
    await openMedications(page);
    const logsBefore = await logs(page);
    const demoxalId = (await medications(page)).find(
      (medication) => medication.name === 'Demoxal',
    )?.id;

    await page.getByRole('button', { name: 'Usuń trwale… lek Demoxal' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Usuń trwale' }).click();

    await expect(
      page.getByText(
        'Usunięto lek „Demoxal” razem z historią przyjmowania (7 zapisów) oraz historią zapasu (3 zdarzenia).',
      ),
    ).toBeVisible();
    await expect(page.getByRole('article', { name: 'Demoxal' })).toHaveCount(0);
    await page.reload();
    await expect(page.getByRole('article', { name: 'Przykładyna' })).toBeVisible();
    await expect(page.getByRole('article', { name: 'Demoxal' })).toHaveCount(0);
    const logsAfter = await logs(page);
    expect(logsBefore.length - logsAfter.length).toBe(7);
    expect(logsAfter.some((log) => log.medicationId === demoxalId)).toBe(false);
    // Its stock events went with it, and nobody else's did.
    expect((await stockEvents(page)).some((event) => event.medicationId === demoxalId)).toBe(false);
  });
});

test.describe('phone width', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('the list, the form and the delete dialog fit and stay usable', async ({ page }) => {
    await loadDemoData(page);
    await openMedications(page);
    const overflows = () =>
      page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
      );
    expect(await overflows()).toBe(false);

    await page.getByRole('button', { name: 'Usuń trwale… lek Demoxal' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    const box = await dialog.boundingBox();
    expect(box?.x).toBeGreaterThanOrEqual(0);
    expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(390);
    await dialog.getByRole('button', { name: 'Anuluj' }).click();

    await page.getByRole('link', { name: 'Dodaj lek' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Dodaj lek' })).toBeVisible();
    await page.getByRole('button', { name: 'Dodaj godzinę' }).click();
    expect(await overflows()).toBe(false);
    for (const label of [/^Godzina 1/, /^Dawka 1/, /^Godzina 2/, /^Dawka 2/]) {
      const field = await page.getByLabel(label).boundingBox();
      expect(field?.width).toBeGreaterThanOrEqual(120);
      expect(field?.height).toBeGreaterThanOrEqual(44);
    }
  });
});
