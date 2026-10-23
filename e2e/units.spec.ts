import { expect, test, type Page } from '@playwright/test';

// F4 in a real browser on a small phone: the dosage form, the unit lists, the strength and the
// stock unit. Real localStorage; the clock and the time zone are fixed like in the other specs.

const NOW = new Date('2026-10-15T10:00:00Z');
const MEDICATIONS_KEY = 'pigoowa:v1:medications';

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

interface StoredMedication {
  id: string;
  name: string;
  doseUnit: string;
  dosageForm?: string;
  strength?: { value: number; unit: string } | null;
  stock: { quantity: number; unit: string; asOf: string } | null;
  scheduleTimes: { timeOfDay: string; doseAmount: number }[];
  notes: string | null;
}

async function stored(page: Page): Promise<StoredMedication[]> {
  const raw = await page.evaluate((key) => window.localStorage.getItem(key), MEDICATIONS_KEY);
  // JSON.parse returns `any`; the storage envelope `{ version, items }` is the app's own format.
  return raw === null ? [] : (JSON.parse(raw) as { items: StoredMedication[] }).items;
}

/** A medication as an older version of the app stored it: no dosage form, no strength. */
function oldMedication(overrides: Partial<StoredMedication> = {}): StoredMedication {
  return {
    id: 'old-1',
    name: 'Stary lek',
    doseUnit: 'tabletka',
    stock: null,
    scheduleTimes: [{ timeOfDay: '08:00', doseAmount: 1 }],
    notes: null,
    ...overrides,
  };
}

async function seed(page: Page, ...items: StoredMedication[]) {
  await page.goto('/');
  await page.evaluate(
    ({ key, list }) => {
      const full = list.map((item, index) => ({
        startDate: '2026-01-01',
        endDate: null,
        scheduleEffectiveFrom: '2026-01-01',
        createdAt: '2026-01-01T08:00:00.000Z',
        updatedAt: '2026-01-01T08:00:00.000Z',
        ...item,
        scheduleTimes: item.scheduleTimes.map((entry, row) => ({
          id: `t-${String(index)}-${String(row)}`,
          ...entry,
        })),
      }));
      window.localStorage.setItem(key, JSON.stringify({ version: 2, items: full }));
    },
    { key: MEDICATIONS_KEY, list: items },
  );
}

const overflows = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);

const form = (page: Page) => page.getByRole('combobox', { name: 'Postać leku' });
const doseUnitSelect = (page: Page) => page.getByRole('combobox', { name: /^Jednostka dawki/ });
const stockUnitSelect = (page: Page) => page.getByRole('combobox', { name: /^Jednostka zapasu/ });
const optionTexts = (page: Page, name: RegExp | string) =>
  page.getByRole('combobox', { name }).locator('option').allTextContents();

async function openNew(page: Page, name = 'Moj lek') {
  await page.goto('/medications/new');
  await expect(page.getByRole('heading', { level: 1, name: 'Dodaj lek' })).toBeVisible();
  await page.getByRole('textbox', { name: /^Nazwa leku/ }).fill(name);
}

async function fillSchedule(page: Page) {
  await page.getByRole('textbox', { name: /^Godzina 1/ }).fill('0800');
  await page.getByRole('textbox', { name: /^Dawka 1/ }).fill('1');
}

test.describe('adding a medication with the lists', () => {
  test('choose the form, the unit and the strength; it is stored, shown and still there after a reload', async ({
    page,
  }) => {
    await openNew(page, 'Demoxal');
    await form(page).selectOption('tablet');
    await expect(doseUnitSelect(page)).toBeVisible();
    expect(await optionTexts(page, /^Jednostka dawki/)).toEqual(['Wybierz jednostkę', 'tabletka']);
    await doseUnitSelect(page).selectOption('tabletka');
    await page.getByRole('textbox', { name: 'Moc: liczba' }).fill('500');
    await page.getByRole('combobox', { name: 'Moc: jednostka' }).selectOption('mg');
    await fillSchedule(page);
    await page.getByRole('textbox', { name: /^Aktualny zapas/ }).fill('30');
    await page.getByRole('button', { name: 'Dodaj lek' }).tap();

    await expect(page).toHaveURL(/\/medications$/);
    const card = page.getByRole('article', { name: 'Demoxal' });
    await expect(card.getByText('Tabletki')).toBeVisible();
    await expect(card.getByText(/^500 mg/)).toBeVisible();
    await expect(card.getByText(/Pozostało ok\. 30 tabletek/)).toBeVisible();

    await page.reload();

    const [saved] = await stored(page);
    expect(saved).toMatchObject({
      dosageForm: 'tablet',
      doseUnit: 'tabletka',
      strength: { value: 500, unit: 'mg' },
      stock: { quantity: 30, unit: 'tabletka' },
    });
    await page.getByRole('link', { name: 'Edytuj lek Demoxal' }).tap();
    await expect(form(page)).toHaveValue('tablet');
    await expect(doseUnitSelect(page)).toHaveValue('tabletka');
    await expect(page.getByRole('textbox', { name: 'Moc: liczba' })).toHaveValue('500');
    await expect(page.getByRole('combobox', { name: 'Moc: jednostka' })).toHaveValue('mg');
  });

  test('without a form the unit is typed and nothing about a form or a strength is stored', async ({
    page,
  }) => {
    await openNew(page);
    await page.getByRole('textbox', { name: /^Jednostka dawki/ }).fill('tabletka');
    await fillSchedule(page);
    await page.getByRole('button', { name: 'Dodaj lek' }).tap();
    await expect(page).toHaveURL(/\/medications$/);

    const [saved] = await stored(page);
    expect(saved && 'dosageForm' in saved).toBe(false);
    expect(saved && 'strength' in saved).toBe(false);
  });

  test('the strength is information: half of it is refused, and it never reaches the dose or the stock', async ({
    page,
  }) => {
    await openNew(page);
    await page.getByRole('textbox', { name: /^Jednostka dawki/ }).fill('tabletka');
    await fillSchedule(page);
    await page.getByRole('textbox', { name: /^Aktualny zapas/ }).fill('20');
    await page.getByRole('textbox', { name: 'Moc: liczba' }).fill('250');

    await page.getByRole('button', { name: 'Dodaj lek' }).tap();

    await expect(page.getByText('Wybierz jednostkę mocy, na przykład mg.')).toBeVisible();
    expect(await stored(page)).toEqual([]);
    await page.getByRole('combobox', { name: 'Moc: jednostka' }).selectOption('mcg');
    await page.getByRole('button', { name: 'Dodaj lek' }).tap();
    await expect(page).toHaveURL(/\/medications$/);

    const [saved] = await stored(page);
    expect(saved?.strength).toEqual({ value: 250, unit: 'mcg' });
    expect(saved?.scheduleTimes[0]?.doseAmount).toBe(1);
    expect(saved?.stock).toMatchObject({ quantity: 20, unit: 'tabletka' });
    await expect(page.getByText(/Pozostało ok\. 20 tabletek/)).toBeVisible();
  });
});

test.describe('the stock unit', () => {
  test('says at once that no estimate is possible when it differs from the dose unit, and the card agrees', async ({
    page,
  }) => {
    await openNew(page, 'Krople');
    await form(page).selectOption('drops');
    await doseUnitSelect(page).selectOption('kropla');
    await fillSchedule(page);
    await page.getByRole('textbox', { name: /^Aktualny zapas/ }).fill('20');
    await expect(page.getByRole('status')).toHaveCount(0);

    await stockUnitSelect(page).selectOption('ml');

    await expect(page.getByRole('status')).toContainText(
      'Zapas jest liczony w jednostce „ml”, a dawka w jednostce „kropla”. Nie przeliczamy jednostek',
    );
    expect(await overflows(page)).toBe(false);
    await page.getByRole('button', { name: 'Dodaj lek' }).tap();
    await expect(page).toHaveURL(/\/medications$/);

    const card = page.getByRole('article', { name: 'Krople' });
    await expect(card.getByText(/Szacunek niedostępny: jednostka zapasu różni się/)).toBeVisible();
    const [saved] = await stored(page);
    expect(saved).toMatchObject({ doseUnit: 'kropla', stock: { quantity: 20, unit: 'ml' } });
  });
});

test.describe('medications saved before the lists existed', () => {
  test('open with their unit as stored and save without changing it, adding no field', async ({
    page,
  }) => {
    await seed(
      page,
      oldMedication({
        doseUnit: 'Tabletka ',
        stock: { quantity: 28, unit: 'Tabletka ', asOf: '2026-09-01T08:00:00.000Z' },
      }),
    );
    const before = (await stored(page))[0];
    await page.goto('/medications/old-1/edit');

    await expect(page.getByRole('textbox', { name: /^Jednostka dawki/ })).toHaveValue('Tabletka ');
    await expect(form(page)).toHaveValue('');
    await page.getByRole('textbox', { name: /^Notatki/ }).fill('Dopisana notatka');
    await page.getByRole('button', { name: 'Zapisz zmiany' }).tap();
    await expect(page.getByText(/Zapisano zmiany/)).toBeVisible();

    const after = (await stored(page))[0];
    expect(after?.doseUnit).toBe('Tabletka ');
    expect(after?.stock).toEqual(before?.stock);
    expect(after && 'dosageForm' in after).toBe(false);
    expect(after && 'strength' in after).toBe(false);
    expect(after?.notes).toBe('Dopisana notatka');
  });

  test('a unit outside the list is the first, selected option, saved unchanged, and gone once another is saved', async ({
    page,
  }) => {
    await seed(page, oldMedication({ doseUnit: 'inhalacja' }));
    await page.goto('/medications/old-1/edit');

    await form(page).selectOption('inhaler');

    expect(await optionTexts(page, /^Jednostka dawki/)).toEqual([
      'inhalacja (dotychczasowa, spoza listy)',
      'dawka',
    ]);
    await expect(doseUnitSelect(page)).toHaveValue('inhalacja');
    await expect(page.getByText(/nie ma jej na liście dla wybranej postaci/)).toBeVisible();
    await page.getByRole('button', { name: 'Zapisz zmiany' }).tap();
    await expect(page.getByText(/Zapisano zmiany/)).toBeVisible();
    expect((await stored(page))[0]).toMatchObject({ dosageForm: 'inhaler', doseUnit: 'inhalacja' });

    await page.getByRole('link', { name: 'Edytuj lek Stary lek' }).tap();
    await doseUnitSelect(page).selectOption('dawka');
    await page.getByRole('button', { name: 'Zapisz zmiany' }).tap();
    await expect(page.getByText(/Zapisano zmiany/)).toBeVisible();
    expect((await stored(page))[0]?.doseUnit).toBe('dawka');

    await page.getByRole('link', { name: 'Edytuj lek Stary lek' }).tap();
    await expect(doseUnitSelect(page)).toHaveValue('dawka');
    expect(await optionTexts(page, /^Jednostka dawki/)).toEqual(['dawka']);
  });

  test('the card marks a unit outside the list of its form and keeps it as stored', async ({
    page,
  }) => {
    await seed(page, oldMedication({ doseUnit: 'inhalacja', dosageForm: 'inhaler' }));
    await page.goto('/medications');

    const card = page.getByRole('article', { name: 'Stary lek' });

    await expect(card.getByText('Jednostka spoza listy')).toBeVisible();
    await expect(card.getByText('08:00 — 1 inhalacja')).toBeVisible();
  });
});

test.describe('on a small phone', () => {
  test('every field of the form is at least 44 px tall, has a label, and nothing overflows', async ({
    page,
  }) => {
    await seed(
      page,
      oldMedication({
        doseUnit: 'inhalacja',
        stock: { quantity: 5, unit: 'opakowanie', asOf: '2026-09-01T08:00:00.000Z' },
      }),
    );
    await page.goto('/medications/old-1/edit');
    await form(page).selectOption('inhaler');
    await expect(page.getByRole('status')).toBeVisible();

    expect(await overflows(page)).toBe(false);
    for (const control of [
      form(page),
      doseUnitSelect(page),
      page.getByRole('textbox', { name: 'Moc: liczba' }),
      page.getByRole('combobox', { name: 'Moc: jednostka' }),
      stockUnitSelect(page),
    ]) {
      const box = await control.boundingBox();
      expect(box?.height).toBeGreaterThanOrEqual(44);
      expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(360);
    }
    await expect(page.getByRole('group', { name: 'Moc leku (opcjonalnie)' })).toBeVisible();
  });

  test('the demo data shows the form and the strength on some medications and none on the others', async ({
    page,
  }) => {
    await page.goto('/dev/data');
    await page.getByRole('button', { name: 'Wczytaj dane demonstracyjne' }).click();
    await expect(page.getByText('Wczytano dane demonstracyjne.')).toBeVisible();
    await page.goto('/medications');

    const demoxal = page.getByRole('article', { name: 'Demoxal' });
    await expect(demoxal.getByText('Tabletki')).toBeVisible();
    await expect(demoxal.getByText(/^500 mg/)).toBeVisible();
    const testovit = page.getByRole('article', { name: 'Testovit' });
    await expect(testovit.getByText('Postać')).toHaveCount(0);
    await expect(testovit.getByText('Moc (informacja)')).toHaveCount(0);
  });
});
