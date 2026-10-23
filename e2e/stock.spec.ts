import { expect, test, type Page } from '@playwright/test';

// F6 in a real browser on a small phone: the refill, starting to track the stock, the history of
// stock events, the three stock states and what happens to the events with the medication. Real
// localStorage; the clock (12:00 on Thursday 15 October 2026 in Warsaw) and the time zone are
// fixed like in the other specs.

const NOW = new Date('2026-10-15T10:00:00Z');
const MEDICATIONS_KEY = 'pigoowa:v1:medications';
const EVENTS_KEY = 'pigoowa:v1:stock-events';
const BACKUP_KEY = 'pigoowa:v1:backup';
const DOSE_LOGS_KEY = 'pigoowa:v1:dose-logs';

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

interface StoredEvent {
  id: string;
  medicationId: string;
  kind: string;
  amount: number;
  unit: string;
  recordedAt: string;
  note: string | null;
  reversedAt: string | null;
}

interface StoredMedication {
  id: string;
  name: string;
  doseUnit: string;
  stock: { quantity: number; unit: string; asOf: string; basis?: string } | null;
  lowStockThreshold?: { quantity: number; unit: string };
  endDate?: string | null;
  scheduleTimes: { timeOfDay: string; doseAmount: number }[];
}

async function items<T>(page: Page, key: string): Promise<T[]> {
  const raw = await page.evaluate((storageKey) => window.localStorage.getItem(storageKey), key);
  // JSON.parse returns `any`; the storage envelope `{ version, items }` is the app's own format.
  return raw === null ? [] : (JSON.parse(raw) as { items: T[] }).items;
}

const events = (page: Page) => items<StoredEvent>(page, EVENTS_KEY);
const medications = (page: Page) => items<StoredMedication>(page, MEDICATIONS_KEY);

function medication(overrides: Partial<StoredMedication> = {}): StoredMedication {
  return {
    id: 'm-1',
    name: 'Demoxal',
    doseUnit: 'tabletka',
    stock: { quantity: 5, unit: 'tabletka', asOf: '2026-10-01T08:00:00.000Z' },
    scheduleTimes: [{ timeOfDay: '08:00', doseAmount: 1 }],
    ...overrides,
  };
}

async function seed(page: Page, list: StoredMedication[], stored: StoredEvent[] = []) {
  await page.goto('/');
  await page.evaluate(
    ({ medicationsKey, eventsKey, meds, evs }) => {
      const full = meds.map((item, index) => ({
        startDate: '2026-01-01',
        endDate: null,
        scheduleEffectiveFrom: '2026-01-01',
        notes: null,
        createdAt: '2026-01-01T08:00:00.000Z',
        updatedAt: '2026-01-01T08:00:00.000Z',
        ...item,
        scheduleTimes: item.scheduleTimes.map((entry, row) => ({
          id: `t-${String(index)}-${String(row)}`,
          ...entry,
        })),
      }));
      window.localStorage.setItem(medicationsKey, JSON.stringify({ version: 2, items: full }));
      if (evs.length > 0) {
        window.localStorage.setItem(eventsKey, JSON.stringify({ version: 2, items: evs }));
      }
    },
    { medicationsKey: MEDICATIONS_KEY, eventsKey: EVENTS_KEY, meds: list, evs: stored },
  );
}

function storedEvent(overrides: Partial<StoredEvent> = {}): StoredEvent {
  return {
    id: 'ev-1',
    medicationId: 'm-1',
    kind: 'refill',
    amount: 20,
    unit: 'tabletka',
    recordedAt: '2026-10-10T08:00:00.000Z',
    note: null,
    reversedAt: null,
    ...overrides,
  };
}

const overflows = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);

const dialog = (page: Page) => page.getByRole('dialog');
const amountField = (page: Page) => dialog(page).getByRole('textbox', { name: /^Ile dokładasz/ });
const confirmRefill = (page: Page) =>
  dialog(page).getByRole('button', { name: 'Uzupełnij zapas', exact: true });

test.describe('refill from the medication card', () => {
  test('records one event after the confirmation, shows the new estimate, and survives a reload', async ({
    page,
  }) => {
    await seed(page, [medication()]);
    await page.goto('/medications');
    const card = page.getByRole('article', { name: 'Demoxal' });
    await expect(card.getByText('Niski zapas', { exact: true })).toBeVisible();

    await card.getByRole('button', { name: 'Uzupełnij zapas leku Demoxal' }).tap();
    await expect(dialog(page)).toBeVisible();
    expect(await events(page)).toEqual([]); // opening records nothing
    await amountField(page).fill('30');
    await dialog(page)
      .getByRole('textbox', { name: /^Notatka/ })
      .fill('Nowe opakowanie');
    await confirmRefill(page).tap();

    await expect(
      page.getByText('Uzupełniono zapas leku „Demoxal”: dodano 30 tabletek.'),
    ).toBeVisible();
    await expect(
      card.getByText(/Pozostało ok\. 35 tabletek, wystarczy na ok\. 35 dni/),
    ).toBeVisible();
    await expect(card.getByText('Niski zapas', { exact: true })).toHaveCount(0);
    const [event] = await events(page);
    expect(event).toMatchObject({
      medicationId: 'm-1',
      kind: 'refill',
      amount: 30,
      unit: 'tabletka',
      recordedAt: '2026-10-15T10:00:00.000Z',
      note: 'Nowe opakowanie',
      reversedAt: null,
    });
    expect(await events(page)).toHaveLength(1);

    await page.reload();
    await expect(
      page.getByRole('article', { name: 'Demoxal' }).getByText(/Pozostało ok\. 35 tabletek/),
    ).toBeVisible();
  });

  test('refuses an empty or invalid amount, says what to type, keeps the dialog and records nothing', async ({
    page,
  }) => {
    await seed(page, [medication()]);
    await page.goto('/medications');
    await page.getByRole('button', { name: 'Uzupełnij zapas leku Demoxal' }).tap();

    await confirmRefill(page).tap();
    await expect(dialog(page).getByText(/Wpisz ilość większą od zera/)).toBeVisible();
    await amountField(page).fill('0');
    await confirmRefill(page).tap();
    await expect(dialog(page).getByText(/Wpisz ilość większą od zera/)).toBeVisible();
    await amountField(page).fill('1,2345');
    await confirmRefill(page).tap();

    await expect(dialog(page).getByText(/Wpisz ilość większą od zera/)).toBeVisible();
    await expect(amountField(page)).toHaveAttribute('aria-invalid', 'true');
    expect(await events(page)).toEqual([]);
  });

  test('a double tap on the confirmation records one event', async ({ page }) => {
    await seed(page, [medication()]);
    await page.goto('/medications');
    await page.getByRole('button', { name: 'Uzupełnij zapas leku Demoxal' }).tap();
    await amountField(page).fill('30');

    await confirmRefill(page).dblclick();

    await expect(page.getByText(/Uzupełniono zapas leku/)).toBeVisible();
    expect(await events(page)).toHaveLength(1);
  });

  test('a failed write keeps the dialog and what was typed, and shows the reason', async ({
    page,
  }) => {
    await seed(page, [medication()]);
    await page.goto('/medications');
    await page.getByRole('button', { name: 'Uzupełnij zapas leku Demoxal' }).tap();
    await amountField(page).fill('30');
    await page.evaluate(() => {
      Storage.prototype.setItem = () => {
        throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
      };
    });

    await confirmRefill(page).tap();

    await expect(dialog(page).getByRole('alert')).toContainText(
      'W pamięci przeglądarki brakuje miejsca',
    );
    await expect(amountField(page)).toHaveValue('30');
    await expect(page.getByText(/Uzupełniono zapas leku/)).toHaveCount(0);
    expect(await events(page)).toEqual([]);
  });

  test('the dialog fits a small phone, its controls are at least 44 px tall, and cancelling records nothing', async ({
    page,
  }) => {
    await seed(page, [medication()]);
    await page.goto('/medications');
    await page.getByRole('button', { name: 'Uzupełnij zapas leku Demoxal' }).tap();
    await confirmRefill(page).tap(); // so the error message is part of the layout too

    expect(await overflows(page)).toBe(false);
    for (const control of [
      amountField(page),
      dialog(page).getByRole('textbox', { name: /^Notatka/ }),
      confirmRefill(page),
      dialog(page).getByRole('button', { name: 'Anuluj' }),
    ]) {
      const box = await control.boundingBox();
      expect(box?.height).toBeGreaterThanOrEqual(44);
      expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(360);
    }
    await dialog(page).getByRole('button', { name: 'Anuluj' }).tap();
    await expect(dialog(page)).toBeHidden();
    expect(await events(page)).toEqual([]);
  });

  test('is not offered for an ended medication', async ({ page }) => {
    await seed(page, [medication({ endDate: '2026-10-01' })]);
    await page.goto('/medications');

    const card = page.getByRole('article', { name: 'Demoxal' });
    await expect(card).toBeVisible();
    await expect(card.getByRole('button', { name: /Uzupełnij zapas/ })).toHaveCount(0);
  });
});

test.describe('refill from the dashboard stock panel', () => {
  test('records the event, and the row, the warning line and the own threshold follow', async ({
    page,
  }) => {
    await seed(page, [medication({ lowStockThreshold: { quantity: 20, unit: 'tabletka' } })]);
    await page.goto('/');
    const stock = page.getByRole('region', { name: 'Zapasy leków' });
    await expect(
      stock.getByText(/Zapas jest na poziomie Twojego progu \(20 tabletek\)/),
    ).toBeVisible();

    await stock.getByRole('button', { name: 'Uzupełnij zapas leku Demoxal' }).tap();
    await amountField(page).fill('15');
    await confirmRefill(page).tap();
    // 5 + 15 = 20: exactly at the threshold, still low.
    await expect(stock.getByText(/Pozostało ok\. 20 tabletek/)).toBeVisible();
    await expect(stock.getByText(/Twojego progu/)).toBeVisible();

    await stock.getByRole('button', { name: 'Uzupełnij zapas leku Demoxal' }).tap();
    await amountField(page).fill('1');
    await confirmRefill(page).tap();

    await expect(stock.getByText(/Pozostało ok\. 21 tabletek/)).toBeVisible();
    await expect(stock.getByText(/Twojego progu/)).toHaveCount(0);
    await expect(stock.getByText(/^Niski zapas/)).toHaveCount(0);
    expect(await events(page)).toHaveLength(2);
    expect(await overflows(page)).toBe(false);
  });
});

test.describe('starting to track the stock', () => {
  const unknown = () => medication({ stock: null });
  const startButton = (page: Page) =>
    page.getByRole('button', { name: 'Zacznij śledzić zapas leku Demoxal' });
  const confirmStart = (page: Page) =>
    dialog(page).getByRole('button', { name: 'Zacznij śledzić zapas', exact: true });

  test('neither choice, or an empty field, creates nothing and leaves the estimate unavailable', async ({
    page,
  }) => {
    await seed(page, [unknown()]);
    await page.goto('/medications');
    const card = page.getByRole('article', { name: 'Demoxal' });
    await expect(card.getByText('Nie śledzisz zapasu.')).toBeVisible();
    await expect(card.getByText('Szacunek niedostępny: zapas nie został policzony.')).toBeVisible();

    await startButton(page).tap();
    await expect(dialog(page).getByRole('radio', { name: /Policzyłem/ })).not.toBeChecked();
    await dialog(page)
      .getByRole('textbox', { name: /^Ilość/ })
      .fill('10');
    await confirmStart(page).tap();
    await expect(dialog(page).getByText(/Wybierz, jak zaczynasz/)).toBeVisible();

    await dialog(page)
      .getByRole('radio', { name: /Policzyłem/ })
      .check();
    await dialog(page)
      .getByRole('textbox', { name: /^Ile masz teraz/ })
      .fill('');
    await confirmStart(page).tap();
    await expect(dialog(page).getByText(/Puste pole nie oznacza zera/)).toBeVisible();
    expect((await medications(page))[0]?.stock).toBeNull();
    await dialog(page).getByRole('button', { name: 'Anuluj' }).tap();
    await expect(card.getByText('Szacunek niedostępny: zapas nie został policzony.')).toBeVisible();
    await expect(card.getByText(/Pozostało|wyczerpany/)).toHaveCount(0);
  });

  test('counted: a typed zero is a real count, shown as used up; the stock is stored with its basis', async ({
    page,
  }) => {
    await seed(page, [unknown()]);
    await page.goto('/medications');
    await startButton(page).tap();

    await dialog(page)
      .getByRole('radio', { name: /Policzyłem/ })
      .check();
    await dialog(page)
      .getByRole('textbox', { name: /^Ile masz teraz/ })
      .fill('0');
    await confirmStart(page).tap();

    const card = page.getByRole('article', { name: 'Demoxal' });
    await expect(card.getByText(/Zapas wyczerpany \(0 tabletek\)/)).toBeVisible();
    await expect(
      card.getByText(/Policzono 15 października 2026 12:00: 0 tabletek\./),
    ).toBeVisible();
    expect((await medications(page))[0]?.stock).toEqual({
      quantity: 0,
      unit: 'tabletka',
      asOf: '2026-10-15T10:00:00.000Z',
      basis: 'counted',
    });
  });

  test('new package: the label and the statement stay on every screen that shows the number', async ({
    page,
  }) => {
    await seed(page, [unknown()]);
    await page.goto('/medications');
    await startButton(page).tap();

    await dialog(page)
      .getByRole('radio', { name: /Zaczynam od nowego opakowania/ })
      .check();
    await dialog(page)
      .getByRole('textbox', { name: /^Ile jest w nowym opakowaniu/ })
      .fill('30');
    await confirmStart(page).tap();

    const statement =
      'Liczone od nowego opakowania z 15 października 2026: 30 tabletek. Wcześniejszej pozostałości nie uwzględniamy, więc zapas może być większy.';
    expect((await medications(page))[0]?.stock).toMatchObject({
      quantity: 30,
      basis: 'new-package',
    });
    const card = page.getByRole('article', { name: 'Demoxal' });
    await expect(card.getByText(statement)).toBeVisible();
    await expect(card.getByText('od nowego opakowania', { exact: true })).toBeVisible();
    await expect(card.getByText(/Policzono/)).toHaveCount(0);

    await page.goto('/medications/m-1');
    const details = page.getByRole('region', { name: 'Zapas', exact: true });
    await expect(details.getByText(statement)).toBeVisible();
    await expect(details.getByText('od nowego opakowania', { exact: true })).toBeVisible();

    await page.goto('/');
    const stock = page.getByRole('region', { name: 'Zapasy leków' });
    await expect(stock.getByText(statement)).toBeVisible();
    await expect(stock.getByText('od nowego opakowania', { exact: true })).toBeVisible();

    await page.goto('/doses');
    await expect(page.getByText(statement)).toBeVisible();
    await expect(page.getByText('od nowego opakowania', { exact: true })).toBeVisible();
  });

  test('is reachable from the details page too, and its dialog fits a small phone', async ({
    page,
  }) => {
    await seed(page, [unknown()]);
    await page.goto('/medications/m-1');

    await page.getByRole('button', { name: 'Zacznij śledzić zapas', exact: true }).tap();
    await confirmStart(page).tap();

    await expect(dialog(page).getByText(/Wybierz, jak zaczynasz/)).toBeVisible();
    expect(await overflows(page)).toBe(false);
    for (const control of [
      dialog(page).getByRole('radio', { name: /Policzyłem/ }),
      dialog(page).getByRole('textbox', { name: /^Ilość/ }),
      confirmStart(page),
    ]) {
      const box = await control.boundingBox();
      expect(box?.height).toBeGreaterThanOrEqual(20);
      expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(360);
    }
    // The whole choice (the label around the radio) is a large target.
    const choice = await dialog(page).getByText('Policzyłem, ile mam teraz').boundingBox();
    expect(choice).not.toBeNull();
    const label = await dialog(page).locator('label', { hasText: 'Policzyłem' }).boundingBox();
    expect(label?.height).toBeGreaterThanOrEqual(44);
  });
});

test.describe('the history on the details page', () => {
  test('lists the events with their states, and a reversal keeps the event and stops counting it', async ({
    page,
  }) => {
    await seed(
      page,
      [medication({ stock: { quantity: 10, unit: 'tabletka', asOf: '2026-10-05T08:00:00.000Z' } })],
      [
        storedEvent({
          id: 'old',
          recordedAt: '2026-10-01T08:00:00.000Z',
          amount: 15,
          note: 'Przed liczeniem',
        }),
        storedEvent({
          id: 'new',
          recordedAt: '2026-10-10T08:00:00.000Z',
          amount: 20,
          note: 'Z apteki',
        }),
      ],
    );
    await page.goto('/medications/m-1');
    const history = page.getByRole('region', { name: 'Historia zdarzeń zapasu' });

    await expect(history.getByText('Wliczone w szacunek')).toBeVisible();
    await expect(history.getByText('Sprzed ostatniego liczenia, nie wlicza się')).toBeVisible();
    await expect(history.getByText('Z apteki')).toBeVisible();
    const stock = page.getByRole('region', { name: 'Zapas', exact: true });
    await expect(stock.getByText(/Pozostało ok\. 30 tabletek/)).toBeVisible();

    await history.getByRole('button', { name: /^Cofnij: Uzupełnienie: dodano 20 tabletek/ }).tap();
    await expect(dialog(page)).toBeVisible();
    expect((await events(page)).find((event) => event.id === 'new')?.reversedAt).toBeNull();
    await dialog(page).getByRole('button', { name: 'Cofnij zdarzenie' }).tap();

    await expect(history.getByText(/Cofnięto 15 października 2026 12:00/)).toBeVisible();
    await expect(stock.getByText(/Pozostało ok\. 10 tabletek/)).toBeVisible();
    expect(await events(page)).toHaveLength(2);
    expect((await events(page)).find((event) => event.id === 'new')?.reversedAt).toBe(
      '2026-10-15T10:00:00.000Z',
    );
    expect(await overflows(page)).toBe(false);
  });

  test('refilling from the page puts the event first in the history', async ({ page }) => {
    await seed(page, [medication()]);
    await page.goto('/medications/m-1');
    await expect(page.getByText(/Brak zdarzeń zapasu/)).toBeVisible();

    await page.getByRole('button', { name: 'Uzupełnij zapas', exact: true }).tap();
    await amountField(page).fill('12,5');
    await confirmRefill(page).tap();

    const history = page.getByRole('region', { name: 'Historia zdarzeń zapasu' });
    await expect(history.getByText('Uzupełnienie: dodano 12,5 tabletki')).toBeVisible();
    await expect(history.getByText('Wliczone w szacunek')).toBeVisible();
    await expect(page.getByText(/Brak zdarzeń zapasu/)).toHaveCount(0);
  });
});

test.describe('the events and the rest of the data', () => {
  test("deleting a medication deletes its events and no one else's, after stating them", async ({
    page,
  }) => {
    await seed(
      page,
      [medication(), medication({ id: 'm-2', name: 'Inny' })],
      [
        storedEvent({ id: 'a' }),
        storedEvent({ id: 'b', recordedAt: '2026-10-11T08:00:00.000Z' }),
        storedEvent({ id: 'c', medicationId: 'm-2' }),
      ],
    );
    await page.goto('/medications');

    await page.getByRole('button', { name: 'Usuń trwale… lek Demoxal' }).tap();
    await expect(dialog(page)).toContainText('oraz historia zapasu: 2 zdarzenia');
    await dialog(page).getByRole('button', { name: 'Usuń trwale' }).tap();

    await expect(page.getByText(/razem z historią zapasu \(2 zdarzenia\)/)).toBeVisible();
    expect((await events(page)).map((event) => event.id)).toEqual(['c']);
  });

  test('the demo data has events, and resetting it replaces them and keeps the previous ones in the backup', async ({
    page,
  }) => {
    await page.goto('/dev/data');
    await page.getByRole('button', { name: 'Wczytaj dane demonstracyjne' }).click();
    await expect(page.getByText('Wczytano dane demonstracyjne.')).toBeVisible();
    const demoEvents = await events(page);
    expect(demoEvents.length).toBeGreaterThan(0);
    await page.goto('/medications/demo-medication-demoxal');
    const history = page.getByRole('region', { name: 'Historia zdarzeń zapasu' });
    // Two demo events are before the count (a refill and a waste event), the third was reversed.
    await expect(history.getByText('Sprzed ostatniego liczenia, nie wlicza się')).toHaveCount(2);
    await expect(history.getByText('Strata: odjęto 2 tabletki')).toBeVisible();
    await expect(history.getByText('Cofnięte', { exact: true })).toBeVisible();
    // Neither demo event is counted: the estimate is the stored count.
    await expect(
      page
        .getByRole('region', { name: 'Zapas', exact: true })
        .getByText(/Pozostało ok\. 28 tabletek/),
    ).toBeVisible();

    // The person adds an event of their own, then resets the demo data.
    await page.getByRole('button', { name: 'Uzupełnij zapas', exact: true }).tap();
    await amountField(page).fill('3');
    await confirmRefill(page).tap();
    await expect(page.getByText(/Uzupełniono zapas leku/)).toBeVisible();
    const withMine = await page.evaluate((key) => window.localStorage.getItem(key), EVENTS_KEY);
    await page.goto('/dev/data');
    await page.getByRole('button', { name: 'Przywróć dane demonstracyjne…' }).click();
    await page
      .getByRole('dialog')
      .getByRole('button', { name: /Przywróć/ })
      .click();
    await expect(page.getByText(/Przywrócono|Wczytano|dane demonstracyjne/).first()).toBeVisible();

    const afterReset = await events(page);
    expect(afterReset.map((event) => event.id).sort()).toEqual(
      demoEvents.map((event) => event.id).sort(),
    );
    const backup = await page.evaluate((key) => window.localStorage.getItem(key), BACKUP_KEY);
    const entries = (JSON.parse(backup ?? 'null') as { entries: Record<string, string | null> })
      .entries;
    expect(entries[EVENTS_KEY]).toBe(withMine);
  });
});

test.describe('wasted medicine', () => {
  const wasteField = (page: Page) =>
    dialog(page).getByRole('textbox', { name: /^Ile się zmarnowało/ });
  const confirmWaste = (page: Page) =>
    dialog(page).getByRole('button', { name: 'Zapisz stratę', exact: true });
  const openWaste = (page: Page) =>
    page.getByRole('button', { name: 'Zapisz stratę leku Demoxal' }).tap();

  test('records a waste event that lowers the estimate and is not a dose: no intake record, doses unchanged', async ({
    page,
  }) => {
    await seed(page, [
      medication({ stock: { quantity: 20, unit: 'tabletka', asOf: '2026-10-01T08:00:00.000Z' } }),
    ]);
    await page.goto('/medications');
    const card = page.getByRole('article', { name: 'Demoxal' });
    await expect(card.getByText(/Pozostało ok\. 20 tabletek/)).toBeVisible();

    await openWaste(page);
    await expect(dialog(page).getByText(/To nie jest przyjęcie dawki/)).toBeVisible();
    expect(await events(page)).toEqual([]); // opening records nothing
    await wasteField(page).fill('2,5');
    await dialog(page)
      .getByRole('textbox', { name: /^Notatka/ })
      .fill('Wypadły do zlewu');
    await confirmWaste(page).tap();

    await expect(
      page.getByText(/Zapisano stratę leku „Demoxal”: odjęto 2,5 tabletki od zapasu/),
    ).toBeVisible();
    await expect(card.getByText(/Pozostało ok\. 17,5 tabletki/)).toBeVisible();
    expect(await events(page)).toHaveLength(1);
    expect((await events(page))[0]).toMatchObject({
      medicationId: 'm-1',
      kind: 'waste',
      amount: 2.5,
      unit: 'tabletka',
      recordedAt: '2026-10-15T10:00:00.000Z',
      note: 'Wypadły do zlewu',
      reversedAt: null,
    });
    // Not a dose: nothing was written to the intake records, and the day's dose is still unrecorded.
    expect(
      await page.evaluate((key) => window.localStorage.getItem(key), DOSE_LOGS_KEY),
    ).toBeNull();
    expect((await medications(page))[0]?.scheduleTimes).toEqual(
      medication().scheduleTimes.map((entry) => expect.objectContaining(entry)),
    );

    await page.reload();
    await expect(
      page.getByRole('article', { name: 'Demoxal' }).getByText(/Pozostało ok\. 17,5 tabletki/),
    ).toBeVisible();
    await page.goto('/');
    const doses = page.getByRole('region', { name: 'Dzisiejsze dawki' });
    await expect(
      doses.getByText('Przyjęte: 0. Pominięte: 0. Bez zapisu: 1. Razem dziś: 1.'),
    ).toBeVisible();
    await expect(doses.getByText('Nie zapisano')).toBeVisible();
  });

  test('says when the amount is larger than the estimate, and still records it: the estimate shows as used up', async ({
    page,
  }) => {
    await seed(page, [medication()]);
    await page.goto('/medications');
    await openWaste(page);

    await wasteField(page).fill('8');

    await expect(dialog(page).getByRole('status')).toContainText(
      'Ta ilość jest większa niż szacowany zapas (5 tabletek). Zapiszemy ją mimo to',
    );
    expect(await overflows(page)).toBe(false);
    await confirmWaste(page).tap();
    await expect(
      page.getByRole('article', { name: 'Demoxal' }).getByText(/Zapas wyczerpany \(0 tabletek\)/),
    ).toBeVisible();
    expect((await events(page))[0]?.amount).toBe(8);
  });

  test('refuses an invalid amount, a double tap records one event, and a failed write keeps the dialog', async ({
    page,
  }) => {
    await seed(page, [medication()]);
    await page.goto('/medications');
    await openWaste(page);

    await confirmWaste(page).tap();
    await expect(
      dialog(page).getByText(/Wpisz ilość większą od zera, na przykład 2 lub 0,5/),
    ).toBeVisible();
    await wasteField(page).fill('0');
    await confirmWaste(page).tap();
    await expect(wasteField(page)).toHaveAttribute('aria-invalid', 'true');
    expect(await events(page)).toEqual([]);

    await wasteField(page).fill('1');
    await page.evaluate(() => {
      Storage.prototype.setItem = () => {
        throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
      };
    });
    await confirmWaste(page).tap();
    await expect(dialog(page).getByRole('alert')).toContainText(
      'W pamięci przeglądarki brakuje miejsca',
    );
    await expect(wasteField(page)).toHaveValue('1');
    expect(await events(page)).toEqual([]);
  });

  test('a double tap on the confirmation records one event', async ({ page }) => {
    await seed(page, [medication()]);
    await page.goto('/medications');
    await openWaste(page);
    await wasteField(page).fill('1');

    await confirmWaste(page).dblclick();

    await expect(page.getByText(/Zapisano stratę leku/)).toBeVisible();
    expect(await events(page)).toHaveLength(1);
  });

  test('is in the history with the others, and reversing it restores the estimate and keeps the event', async ({
    page,
  }) => {
    await seed(
      page,
      [medication({ stock: { quantity: 20, unit: 'tabletka', asOf: '2026-10-01T08:00:00.000Z' } })],
      [storedEvent({ id: 'w', kind: 'waste', amount: 5, note: 'Rozlane' })],
    );
    await page.goto('/medications/m-1');
    const history = page.getByRole('region', { name: 'Historia zdarzeń zapasu' });
    const stock = page.getByRole('region', { name: 'Zapas', exact: true });
    await expect(history.getByText('Strata: odjęto 5 tabletek')).toBeVisible();
    await expect(history.getByText('Rozlane')).toBeVisible();
    await expect(history.getByText('Wliczone w szacunek')).toBeVisible();
    await expect(stock.getByText(/Pozostało ok\. 15 tabletek/)).toBeVisible();

    await history.getByRole('button', { name: /^Cofnij: Strata: odjęto 5 tabletek/ }).tap();
    await dialog(page).getByRole('button', { name: 'Cofnij zdarzenie' }).tap();

    await expect(stock.getByText(/Pozostało ok\. 20 tabletek/)).toBeVisible();
    await expect(history.getByText(/Cofnięto 15 października 2026 12:00/)).toBeVisible();
    await expect(history.getByText('Strata: odjęto 5 tabletek')).toBeVisible();
    expect((await events(page))[0]?.reversedAt).toBe('2026-10-15T10:00:00.000Z');
    expect(await events(page)).toHaveLength(1);
  });

  test('records a waste from the details page, and the history shows it first', async ({
    page,
  }) => {
    await seed(page, [medication()]);
    await page.goto('/medications/m-1');

    await page.getByRole('button', { name: 'Zapisz stratę', exact: true }).tap();
    await wasteField(page).fill('1');
    await confirmWaste(page).tap();

    const history = page.getByRole('region', { name: 'Historia zdarzeń zapasu' });
    await expect(history.getByText('Strata: odjęto 1 tabletka')).toBeVisible();
    expect(
      await page.evaluate((key) => window.localStorage.getItem(key), DOSE_LOGS_KEY),
    ).toBeNull();
  });

  test('is not offered when the stock is unknown or the medication has ended', async ({ page }) => {
    await seed(page, [
      medication({ stock: null }),
      medication({ id: 'm-2', name: 'Skończony', endDate: '2026-10-01' }),
    ]);
    await page.goto('/medications');

    await expect(page.getByRole('article', { name: 'Demoxal' })).toBeVisible();
    await expect(page.getByRole('button', { name: /Zapisz stratę/ })).toHaveCount(0);
  });

  test('the dialog fits a small phone and its controls are at least 44 px tall', async ({
    page,
  }) => {
    await seed(page, [medication()]);
    await page.goto('/medications');
    await openWaste(page);
    // Both the warning (the amount is larger than the estimate) and an error are part of the layout.
    await wasteField(page).fill('9');
    await expect(dialog(page).getByRole('status')).toBeVisible();
    expect(await overflows(page)).toBe(false);
    await wasteField(page).fill('');
    await confirmWaste(page).tap();
    await expect(dialog(page).getByText(/Wpisz ilość większą od zera/)).toBeVisible();

    expect(await overflows(page)).toBe(false);
    for (const control of [
      wasteField(page),
      dialog(page).getByRole('textbox', { name: /^Notatka/ }),
      confirmWaste(page),
      dialog(page).getByRole('button', { name: 'Anuluj' }),
    ]) {
      const box = await control.boundingBox();
      expect(box?.height).toBeGreaterThanOrEqual(44);
      expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(360);
    }
    await dialog(page).getByRole('button', { name: 'Anuluj' }).tap();
    expect(await events(page)).toEqual([]);
  });
});
