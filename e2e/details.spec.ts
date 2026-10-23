import { expect, test, type Page } from '@playwright/test';

// F5 in a real browser on a small phone: the medication details page and the own low-stock
// threshold. Real localStorage; the clock and the time zone are fixed like in the other specs.

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
  stock: { quantity: number; unit: string; asOf: string } | null;
  lowStockThreshold?: { quantity: number; unit: string } | null;
  scheduleTimes: { timeOfDay: string; doseAmount: number }[];
}

async function stored(page: Page): Promise<StoredMedication[]> {
  const raw = await page.evaluate((key) => window.localStorage.getItem(key), MEDICATIONS_KEY);
  // JSON.parse returns `any`; the storage envelope `{ version, items }` is the app's own format.
  return raw === null ? [] : (JSON.parse(raw) as { items: StoredMedication[] }).items;
}

function medication(overrides: Partial<StoredMedication> = {}): StoredMedication {
  return {
    id: 'm-1',
    name: 'Demoxal',
    doseUnit: 'tabletka',
    stock: { quantity: 28, unit: 'tabletka', asOf: '2026-10-15T08:00:00.000Z' },
    scheduleTimes: [{ timeOfDay: '08:00', doseAmount: 1 }],
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
        notes: null,
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

const part = (page: Page, name: string) => page.getByRole('region', { name, exact: true });

test.describe('navigation', () => {
  test('from the list to the details and back, and from the details to the edit form', async ({
    page,
  }) => {
    await seed(page, medication());
    await page.goto('/medications');

    await page.getByRole('link', { name: 'Szczegóły leku Demoxal' }).tap();

    await expect(page).toHaveURL(/\/medications\/m-1$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Demoxal' })).toBeVisible();
    await page.getByRole('link', { name: /Wróć do listy leków/ }).tap();
    await expect(page).toHaveURL(/\/medications$/);

    await page.goBack();
    await expect(page.getByRole('heading', { level: 1, name: 'Demoxal' })).toBeVisible();
    await page.getByRole('link', { name: 'Edytuj lek' }).tap();
    await expect(page).toHaveURL(/\/medications\/m-1\/edit$/);
  });

  test('a medication that does not exist says so and leads back', async ({ page }) => {
    await page.goto('/medications/nie-ma');

    await expect(page.getByText('Nie znaleziono leku')).toBeVisible();
    await page.getByRole('link', { name: 'Wróć do listy leków' }).last().tap();
    await expect(page).toHaveURL(/\/medications$/);
  });
});

test.describe('the details of the demo data', () => {
  test('show the form, the strength, the schedule, the units, the stock and the own threshold', async ({
    page,
  }) => {
    await page.goto('/dev/data');
    await page.getByRole('button', { name: 'Wczytaj dane demonstracyjne' }).click();
    await expect(page.getByText('Wczytano dane demonstracyjne.')).toBeVisible();

    await page.goto('/medications/demo-medication-przykladyna');

    await expect(page.getByRole('heading', { level: 1, name: 'Przykładyna' })).toBeVisible();
    await expect(part(page, 'Informacje').getByText('Płyn (syrop, roztwór)')).toBeVisible();
    await expect(part(page, 'Informacje').getByText(/^50 mg\/ml/)).toBeVisible();
    await expect(part(page, 'Dawkowanie').getByText('07:30 — 5 ml')).toBeVisible();
    await expect(part(page, 'Jednostki').getByText('Jednostka zapasu')).toBeVisible();
    await expect(
      part(page, 'Zapas').getByText(/Pozostało ok\. 120 ml, wystarczy na ok\. 24 dni/),
    ).toBeVisible();
    await expect(part(page, 'Zapas').getByText(/Własny próg: 20 ml/)).toBeVisible();
    await expect(page.getByText('Niski zapas')).toHaveCount(0);
    expect(await overflows(page)).toBe(false);
  });

  test('a medication without a form, a strength or a threshold says what is missing', async ({
    page,
  }) => {
    await page.goto('/dev/data');
    await page.getByRole('button', { name: 'Wczytaj dane demonstracyjne' }).click();
    await expect(page.getByText('Wczytano dane demonstracyjne.')).toBeVisible();

    await page.goto('/medications/demo-medication-testovit');

    await expect(part(page, 'Informacje').getByText('Nie wybrano')).toBeVisible();
    await expect(part(page, 'Informacje').getByText('Nie podano')).toBeVisible();
    await expect(part(page, 'Zapas').getByText(/Szacunek niedostępny/)).toBeVisible();
    await expect(part(page, 'Zapas').getByText(/Nie ustawiono własnego progu/)).toBeVisible();
  });
});

test.describe('the own threshold', () => {
  test('is set in the edit form, kept after a reload, and the warning appears at the threshold on the details and on the dashboard', async ({
    page,
  }) => {
    await seed(page, medication());
    await page.goto('/medications/m-1/edit');

    const field = page.getByRole('textbox', { name: /^Własny próg niskiego zapasu/ });
    await expect(field).toHaveValue('');
    await field.fill('27,999');
    await page.getByRole('button', { name: 'Zapisz zmiany' }).tap();
    await expect(page.getByText(/Zapisano zmiany/)).toBeVisible();
    expect((await stored(page))[0]?.lowStockThreshold).toEqual({
      quantity: 27.999,
      unit: 'tabletka',
    });

    // 28 tablets are left, just above 27.999: no warning (the 7-day rule would not warn either).
    await page.goto('/medications/m-1');
    await expect(part(page, 'Zapas').getByText(/Pozostało ok\. 28 tabletek/)).toBeVisible();
    await expect(page.getByText('Niski zapas')).toHaveCount(0);

    await page.goto('/medications/m-1/edit');
    await field.fill('28');
    await page.getByRole('button', { name: 'Zapisz zmiany' }).tap();
    await expect(page.getByText(/Zapisano zmiany/)).toBeVisible();
    await page.reload();

    await page.goto('/medications/m-1');
    await expect(part(page, 'Zapas').getByText('Niski zapas')).toBeVisible();
    await expect(
      part(page, 'Zapas').getByText(/Zapas jest na poziomie Twojego progu \(28 tabletek\)/),
    ).toBeVisible();
    await page.goto('/');
    const stock = page.getByRole('region', { name: 'Zapasy leków' });
    await expect(stock.getByText(/^Niski zapas: 1 lek\./)).toBeVisible();
    await expect(
      stock
        .getByRole('listitem')
        .filter({ hasText: 'Demoxal' })
        .getByText('Niski zapas', { exact: true }),
    ).toBeVisible();
    expect(await overflows(page)).toBe(false);
  });

  test('is refused without a stock, and removed again by emptying the field', async ({ page }) => {
    await seed(page, medication({ stock: null }));
    await page.goto('/medications/m-1/edit');
    const field = page.getByRole('textbox', { name: /^Własny próg niskiego zapasu/ });

    await field.fill('5');
    await page.getByRole('button', { name: 'Zapisz zmiany' }).tap();

    await expect(page.getByText(/Próg dotyczy zapasu/)).toBeVisible();
    expect((await stored(page))[0]?.lowStockThreshold).toBeUndefined();
    await page.getByRole('textbox', { name: /^Aktualny zapas/ }).fill('20');
    await page.getByRole('button', { name: 'Zapisz zmiany' }).tap();
    await expect(page.getByText(/Zapisano zmiany/)).toBeVisible();
    expect((await stored(page))[0]?.lowStockThreshold).toEqual({ quantity: 5, unit: 'tabletka' });

    await page.goto('/medications/m-1/edit');
    await field.fill('');
    await page.getByRole('button', { name: 'Zapisz zmiany' }).tap();
    await expect(page.getByText(/Zapisano zmiany/)).toBeVisible();
    expect('lowStockThreshold' in ((await stored(page))[0] ?? {})).toBe(false);
  });

  test('in another unit than the stock it is not applied, and the details and the form both say so', async ({
    page,
  }) => {
    await seed(
      page,
      medication({
        stock: { quantity: 40, unit: 'tabletka', asOf: '2026-10-15T08:00:00.000Z' },
        lowStockThreshold: { quantity: 100, unit: 'ml' },
      }),
    );

    await page.goto('/medications/m-1');
    await expect(
      part(page, 'Zapas').getByText(
        /Własny próg \(100 ml\) jest w innej jednostce niż zapas \(tabletka\), więc nie jest stosowany/,
      ),
    ).toBeVisible();
    await expect(page.getByText('Niski zapas')).toHaveCount(0);

    await page.goto('/medications/m-1/edit');
    await expect(page.getByRole('status')).toContainText('Próg jest zapisany w jednostce „ml”');
    await expect(page.getByRole('status')).toContainText('obowiązuje reguła 7 dni');
    expect(await overflows(page)).toBe(false);
    await page.getByRole('button', { name: /Licz ten próg w jednostce zapasu: tabletka/ }).tap();
    await expect(page.getByRole('status')).toHaveCount(0);
    await page.getByRole('button', { name: 'Zapisz zmiany' }).tap();
    await expect(page.getByText(/Zapisano zmiany/)).toBeVisible();
    expect((await stored(page))[0]?.lowStockThreshold).toEqual({ quantity: 100, unit: 'tabletka' });
  });
});

test.describe('on a small phone', () => {
  test('the details page fits, its buttons are at least 44 px tall, and the parts are labelled regions', async ({
    page,
  }) => {
    await seed(page, medication({ name: 'Bardzo-długa-nazwa-leku-bez-spacji-'.repeat(3) }));
    await page.goto('/medications/m-1');
    await expect(part(page, 'Zapas')).toBeVisible();

    expect(await overflows(page)).toBe(false);
    for (const link of [
      page.getByRole('link', { name: 'Edytuj lek' }),
      page.getByRole('link', { name: 'Edytuj zapas i próg' }),
      page.getByRole('link', { name: /Wróć do listy leków/ }),
    ]) {
      const box = await link.boundingBox();
      expect(box?.height).toBeGreaterThanOrEqual(44);
      expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(360);
    }
    for (const name of [
      'Informacje',
      'Dawkowanie',
      'Jednostki',
      'Zapas',
      'Historia zdarzeń zapasu',
    ]) {
      await expect(page.getByRole('region', { name, exact: true })).toBeVisible();
    }
  });

  test('the threshold field is at least 44 px tall and has a label and a description', async ({
    page,
  }) => {
    await seed(page, medication());
    await page.goto('/medications/m-1/edit');

    const field = page.getByRole('textbox', { name: /^Własny próg niskiego zapasu/ });

    expect((await field.boundingBox())?.height).toBeGreaterThanOrEqual(44);
    await expect(field).toHaveAccessibleDescription(/równy progowi lub mniejszy/);
    await expect(field).toHaveAttribute('inputmode', 'decimal');
  });
});
