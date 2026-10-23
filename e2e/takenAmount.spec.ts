import { expect, test, type Page } from '@playwright/test';

// F8 in a real browser on a small phone: the amount actually taken and the note. Real
// localStorage; the clock (12:00 on Thursday 15 October 2026 in Warsaw) and the time zone are
// fixed like in the other specs.

const NOW = new Date('2026-10-15T10:00:00Z');
const MEDICATIONS_KEY = 'pigoowa:v1:medications';
const LOGS_KEY = 'pigoowa:v1:dose-logs';

test.use({
  timezoneId: 'Europe/Warsaw',
  locale: 'pl-PL',
  viewport: { width: 360, height: 740 },
  isMobile: true,
  hasTouch: true,
});

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(NOW);
});

interface StoredLog {
  id: string;
  medicationId: string;
  scheduledDate: string;
  scheduledTime: string;
  status: string;
  doseAmount: number;
  doseUnit: string;
  recordedAt: string;
  takenAmount?: number;
  note?: string | null;
}

async function items<T>(page: Page, key: string): Promise<T[]> {
  const raw = await page.evaluate((storageKey) => window.localStorage.getItem(storageKey), key);
  // JSON.parse returns `any`; the storage envelope `{ version, items }` is the app's own format.
  return raw === null ? [] : (JSON.parse(raw) as { items: T[] }).items;
}

const logs = (page: Page) => items<StoredLog>(page, LOGS_KEY);

/** One medication with doses today at 08:00 (1 tablet) and 20:00 (2 tablets), a stock of 20 counted on 1 October. */
async function seed(page: Page, storedLogs: StoredLog[] = []) {
  await page.goto('/');
  await page.evaluate(
    ({ medicationsKey, logsKey, existing }) => {
      const medication = {
        id: 'm-1',
        name: 'Demoxal',
        doseUnit: 'tabletka',
        notes: null,
        startDate: '2026-01-01',
        endDate: null,
        scheduleEffectiveFrom: '2026-03-01',
        scheduleTimes: [
          { id: 't-1', timeOfDay: '08:00', doseAmount: 1 },
          { id: 't-2', timeOfDay: '20:00', doseAmount: 2 },
        ],
        stock: { quantity: 20, unit: 'tabletka', asOf: '2026-10-01T08:00:00.000Z' },
        createdAt: '2026-01-01T08:00:00.000Z',
        updatedAt: '2026-01-01T08:00:00.000Z',
      };
      window.localStorage.setItem(
        medicationsKey,
        JSON.stringify({ version: 2, items: [medication] }),
      );
      if (existing.length > 0) {
        window.localStorage.setItem(logsKey, JSON.stringify({ version: 2, items: existing }));
      }
    },
    { medicationsKey: MEDICATIONS_KEY, logsKey: LOGS_KEY, existing: storedLogs },
  );
}

function storedLog(overrides: Partial<StoredLog> = {}): StoredLog {
  return {
    id: 'l-1',
    medicationId: 'm-1',
    scheduledDate: '2026-10-15',
    scheduledTime: '08:00',
    status: 'taken',
    doseAmount: 1,
    doseUnit: 'tabletka',
    recordedAt: '2026-10-15T06:05:00.000Z',
    ...overrides,
  };
}

const overflows = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);

const dialog = (page: Page) => page.getByRole('dialog');
const amountField = (page: Page) => dialog(page).getByRole('textbox', { name: /^Ile przyjęto/ });
const noteField = (page: Page) => dialog(page).getByRole('textbox', { name: /^Notatka/ });
const save = (page: Page, label = 'Zapisz jako przyjętą') =>
  dialog(page).getByRole('button', { name: label, exact: true });
const doses = (page: Page) => page.getByRole('region', { name: 'Dzisiejsze dawki' });
const dose = (page: Page, time: string) =>
  doses(page)
    .getByRole('listitem')
    .filter({ has: page.locator(`time:text-is("${time}")`) });

test.describe('the usual one tap is unchanged', () => {
  test('"Oznacz jako przyjętą" records the plan with no dialog and no new field', async ({
    page,
  }) => {
    await seed(page);
    await page.goto('/');

    await page.getByRole('button', { name: 'Oznacz jako przyjętą: Demoxal, 08:00' }).tap();

    await expect(page.getByText('Zapisano jako przyjętą: Demoxal, 08:00.')).toBeVisible();
    await expect(dialog(page)).toHaveCount(0);
    const [log] = await logs(page);
    expect(log).toMatchObject({ status: 'taken', doseAmount: 1 });
    expect(log && 'takenAmount' in log).toBe(false);
    expect(log && 'note' in log).toBe(false);
  });
});

test.describe('recording the amount actually taken', () => {
  test('a larger amount with a note: saved next to the plan, shown with both, in the stock and in the history, after a reload', async ({
    page,
  }) => {
    await seed(page);
    await page.goto('/');
    const stock = page.getByRole('region', { name: 'Zapasy leków' });
    await expect(stock.getByText(/Pozostało ok\. 20 tabletek/)).toBeVisible();

    await page.getByRole('button', { name: 'Przyjęto inną ilość: Demoxal, 08:00' }).tap();
    await expect(dialog(page).getByText(/Zaplanowano: 1 tabletka/)).toBeVisible();
    expect(await logs(page)).toEqual([]); // opening records nothing
    await amountField(page).fill('3');
    await noteField(page).fill('Zgodnie z zaleceniem lekarza');
    await save(page).tap();

    await expect(
      page.getByText(
        /Zapisano jako przyjętą: Demoxal, 08:00\. Przyjęto 3 tabletki, planowano 1 tabletka\./,
      ),
    ).toBeVisible();
    const first = dose(page, '08:00');
    await expect(first.getByText('Przyjęto: 3 tabletki.')).toBeVisible();
    await expect(first.getByText(/Planowano wtedy: 1 tabletka\./)).toBeVisible();
    await expect(first.getByText('Zgodnie z zaleceniem lekarza')).toBeVisible();
    // The stock goes down by what was taken (3), not by the plan (1).
    await expect(stock.getByText(/Pozostało ok\. 17 tabletek/)).toBeVisible();
    const [log] = await logs(page);
    expect(log).toMatchObject({
      status: 'taken',
      doseAmount: 1,
      takenAmount: 3,
      note: 'Zgodnie z zaleceniem lekarza',
      recordedAt: '2026-10-15T10:00:00.000Z',
    });

    await page.reload();
    await expect(dose(page, '08:00').getByText('Przyjęto: 3 tabletki.')).toBeVisible();
    await page.goto('/doses/history');
    await expect(page.getByText('Przyjęto: 3 tabletki', { exact: true })).toBeVisible();
    await expect(page.getByText('Planowano: 1 tabletka', { exact: true })).toBeVisible();
    await expect(page.getByText('Zgodnie z zaleceniem lekarza')).toBeVisible();
  });

  test('a smaller amount is saved the same way, and the other dose is untouched', async ({
    page,
  }) => {
    await seed(page);
    await page.goto('/');

    await page.getByRole('button', { name: 'Przyjęto inną ilość: Demoxal, 20:00' }).tap();
    await amountField(page).fill('0,5');
    await save(page).tap();

    await expect(dose(page, '20:00').getByText('Przyjęto: 0,5 tabletki.')).toBeVisible();
    await expect(dose(page, '08:00').getByText('Nie zapisano')).toBeVisible();
    expect(await logs(page)).toHaveLength(1);
    expect((await logs(page))[0]).toMatchObject({ doseAmount: 2, takenAmount: 0.5 });
  });

  test('a very different amount is saved without any warning or error, and nothing suggests a dose', async ({
    page,
  }) => {
    await seed(page);
    await page.goto('/');
    await page.getByRole('button', { name: 'Przyjęto inną ilość: Demoxal, 08:00' }).tap();
    await amountField(page).fill('50');

    const dialogText = await dialog(page).textContent();
    expect(dialogText).not.toMatch(
      /zalec(amy|a się)|powinien|należy|lepiej|za dużo|za mało|bezpiecz|ostrzeż/i,
    );
    await expect(page.getByRole('alert')).toHaveCount(0);
    await save(page).tap();

    await expect(dose(page, '08:00').getByText('Przyjęto: 50 tabletek.')).toBeVisible();
    await expect(page.getByRole('alert')).toHaveCount(0);
  });

  test('refuses an empty, zero, negative or over-precise amount and a long note, and records nothing', async ({
    page,
  }) => {
    await seed(page);
    await page.goto('/');
    await page.getByRole('button', { name: 'Przyjęto inną ilość: Demoxal, 08:00' }).tap();

    for (const value of ['', '0', '-1', 'abc', '1,2345']) {
      await amountField(page).fill(value);
      await save(page).tap();
      await expect(
        dialog(page).getByText(/Wpisz ilość większą od zera, na przykład 1 lub 0,5/),
      ).toBeVisible();
      await expect(amountField(page)).toHaveAttribute('aria-invalid', 'true');
    }
    await amountField(page).fill('2');
    await noteField(page).fill('x'.repeat(501));
    await save(page).tap();
    await expect(dialog(page).getByText('Notatka może mieć najwyżej 500 znaków.')).toBeVisible();
    expect(await logs(page)).toEqual([]);
  });

  test('a double tap records one dose, and a failed write keeps the dialog and what was typed', async ({
    page,
  }) => {
    await seed(page);
    await page.goto('/');
    await page.getByRole('button', { name: 'Przyjęto inną ilość: Demoxal, 08:00' }).tap();
    await amountField(page).fill('2');
    await noteField(page).fill('Moja notatka');
    await page.evaluate(() => {
      const original = Object.getOwnPropertyDescriptor(Storage.prototype, 'setItem');
      Storage.prototype.setItem = () => {
        throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
      };
      (window as unknown as { restoreStorage: () => void }).restoreStorage = () => {
        if (original !== undefined) Object.defineProperty(Storage.prototype, 'setItem', original);
      };
    });

    await save(page).tap();

    await expect(dialog(page).getByRole('alert')).toContainText(
      'W pamięci przeglądarki brakuje miejsca',
    );
    await expect(amountField(page)).toHaveValue('2');
    await expect(noteField(page)).toHaveValue('Moja notatka');
    expect(await logs(page)).toEqual([]);

    await page.evaluate(() => {
      (window as unknown as { restoreStorage: () => void }).restoreStorage();
    });
    // Two clicks arriving together on the same button, before the page can react to the first.
    await save(page).evaluate((button: HTMLElement) => {
      button.click();
      button.click();
    });
    await expect(page.getByText(/Zapisano jako przyjętą: Demoxal, 08:00/)).toBeVisible();
    expect(await logs(page)).toHaveLength(1);
  });

  test('the dialog fits a small phone and its controls are at least 44 px tall', async ({
    page,
  }) => {
    await seed(page);
    await page.goto('/');
    await page.getByRole('button', { name: 'Przyjęto inną ilość: Demoxal, 08:00' }).tap();
    await amountField(page).fill('0');
    await save(page).tap();
    await expect(dialog(page).getByText(/Wpisz ilość większą od zera/)).toBeVisible();

    expect(await overflows(page)).toBe(false);
    for (const control of [
      amountField(page),
      noteField(page),
      save(page),
      dialog(page).getByRole('button', { name: 'Anuluj' }),
    ]) {
      const box = await control.boundingBox();
      expect(box?.height).toBeGreaterThanOrEqual(44);
      expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(360);
    }
    await dialog(page).getByRole('button', { name: 'Anuluj' }).tap();
    expect(await logs(page)).toEqual([]);
  });
});

test.describe('editing a taken dose', () => {
  test('changes the amount and the note without moving recordedAt, and the stock follows', async ({
    page,
  }) => {
    await seed(page, [storedLog({ takenAmount: 5, note: 'Stara' })]);
    await page.goto('/');
    const stock = page.getByRole('region', { name: 'Zapasy leków' });
    await expect(stock.getByText(/Pozostało ok\. 15 tabletek/)).toBeVisible();

    await page.getByRole('button', { name: 'Zmień ilość lub notatkę: Demoxal, 08:00' }).tap();
    await expect(amountField(page)).toHaveValue('5');
    await expect(noteField(page)).toHaveValue('Stara');
    await amountField(page).fill('2');
    await noteField(page).fill('Nowa');
    await save(page, 'Zapisz zmiany').tap();

    await expect(
      page.getByText(
        /Zapisano zmiany: Demoxal, 08:00\. Przyjęto 2 tabletki, planowano 1 tabletka\./,
      ),
    ).toBeVisible();
    await expect(stock.getByText(/Pozostało ok\. 18 tabletek/)).toBeVisible();
    const [log] = await logs(page);
    expect(log).toMatchObject({ id: 'l-1', takenAmount: 2, note: 'Nowa', doseAmount: 1 });
    expect(log?.recordedAt).toBe('2026-10-15T06:05:00.000Z');
    expect(await logs(page)).toHaveLength(1);
  });

  test('marking it skipped removes the amount and the note; clearing removes the record; a skipped dose offers neither', async ({
    page,
  }) => {
    await seed(page, [storedLog({ takenAmount: 3, note: 'Notatka' })]);
    await page.goto('/');

    await page.getByRole('button', { name: 'Zmień na pominiętą: Demoxal, 08:00' }).tap();

    await expect(dose(page, '08:00').getByText('Pominięta', { exact: true })).toBeVisible();
    await expect(dose(page, '08:00').getByText(/Przyjęto: /)).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Zmień ilość lub notatkę/ })).toHaveCount(0);
    const [log] = await logs(page);
    expect(log && 'takenAmount' in log).toBe(false);
    expect(log && 'note' in log).toBe(false);
    expect(log?.doseAmount).toBe(1);
  });

  test('a record saved before these fields looks as before and can be given an amount and a note', async ({
    page,
  }) => {
    await seed(page, [storedLog()]);
    await page.goto('/');
    await expect(dose(page, '08:00').getByText('Przyjęta', { exact: true })).toBeVisible();
    await expect(dose(page, '08:00').getByText(/Przyjęto: /)).toHaveCount(0);

    await page.getByRole('button', { name: 'Zmień ilość lub notatkę: Demoxal, 08:00' }).tap();
    await expect(amountField(page)).toHaveValue('1');
    await amountField(page).fill('2');
    await save(page, 'Zapisz zmiany').tap();

    await expect(dose(page, '08:00').getByText('Przyjęto: 2 tabletki.')).toBeVisible();
    expect((await logs(page))[0]).toMatchObject({ doseAmount: 1, takenAmount: 2 });
  });

  test('a record changed in another tab meanwhile is not overwritten, and the person is told', async ({
    page,
  }) => {
    await seed(page, [storedLog({ takenAmount: 2 })]);
    await page.goto('/');
    await page.getByRole('button', { name: 'Zmień ilość lub notatkę: Demoxal, 08:00' }).tap();
    await amountField(page).fill('5');
    // Another tab changes the record first.
    await page.evaluate(
      ({ key, log }) => {
        window.localStorage.setItem(key, JSON.stringify({ version: 2, items: [log] }));
      },
      { key: LOGS_KEY, log: storedLog({ takenAmount: 3, note: 'z innej karty' }) },
    );

    await save(page, 'Zapisz zmiany').tap();

    await expect(page.getByText(/Zapis tej dawki zmienił się w międzyczasie/)).toBeVisible();
    expect((await logs(page))[0]).toMatchObject({ takenAmount: 3, note: 'z innej karty' });
    await expect(dialog(page)).toHaveCount(0);
  });

  test('neither the schedule nor the medication is touched, and tomorrow still shows the plan', async ({
    page,
  }) => {
    await seed(page);
    const before = await page.evaluate((key) => window.localStorage.getItem(key), MEDICATIONS_KEY);
    await page.goto('/');
    await page.getByRole('button', { name: 'Przyjęto inną ilość: Demoxal, 08:00' }).tap();
    await amountField(page).fill('7');
    await save(page).tap();
    await expect(dose(page, '08:00').getByText('Przyjęto: 7 tabletek.')).toBeVisible();

    expect(await page.evaluate((key) => window.localStorage.getItem(key), MEDICATIONS_KEY)).toBe(
      before,
    );
    await page.goto('/doses?date=2026-10-16');
    await expect(page.getByText('1 tabletka', { exact: true })).toBeVisible();
    await expect(page.getByText('2 tabletki', { exact: true })).toBeVisible();
    await expect(page.getByText(/Przyjęto: /)).toHaveCount(0);
  });
});
