import { expect, test, type Page } from '@playwright/test';

// Real browser, real localStorage. The clock is fixed (Thursday 15 October 2026, 12:00 in Warsaw)
// and so is the time zone, so nothing depends on the real date. With the demo data loaded: Demoxal
// (08:00, 20:00; 28 tablets), Przykładyna (07:30; 120 ml) and Testovit (13:00; no stock) have doses
// today; Sunday 18 October 09:30 and Tuesday 27 October 14:15 are upcoming appointments; the one of
// the 14th at 11:00 was never confirmed.

const NOW = new Date('2026-10-15T10:00:00Z');
const LOGS_KEY = 'pigoowa:v1:dose-logs';
const APPOINTMENTS_KEY = 'pigoowa:v1:appointments';

test.use({ timezoneId: 'Europe/Warsaw', locale: 'pl-PL' });

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(NOW);
});

async function loadDemoData(page: Page) {
  await page.goto('/dev/data');
  await page.getByRole('button', { name: 'Wczytaj dane demonstracyjne' }).click();
  await expect(page.getByText('Wczytano dane demonstracyjne.')).toBeVisible();
}

async function openDashboard(page: Page) {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1, name: 'Pulpit' })).toBeVisible();
}

const region = (page: Page, name: string) => page.getByRole('region', { name });

async function storedLogCount(page: Page): Promise<number> {
  const raw = await page.evaluate((key) => window.localStorage.getItem(key), LOGS_KEY);
  // JSON.parse returns `any`; the storage envelope `{ version, items }` is the app's own format
  // (see README), and the test only counts its items.
  return raw === null ? 0 : (JSON.parse(raw) as { items: unknown[] }).items.length;
}

test.describe('with data', () => {
  test('shows today’s doses, the next appointments and the stock estimates', async ({ page }) => {
    await loadDemoData(page);
    await openDashboard(page);

    const doses = region(page, 'Dzisiejsze dawki');
    await expect(doses.getByText('czwartek, 15 października 2026')).toBeVisible();
    await expect(
      doses.getByText('Przyjęte: 0. Pominięte: 0. Bez zapisu: 4. Razem dziś: 4.'),
    ).toBeVisible();
    await expect(doses.getByText('Nie zapisano')).toHaveCount(4);

    const appointments = region(page, 'Najbliższe wizyty');
    const items = appointments.getByRole('listitem');
    await expect(items).toHaveCount(2);
    await expect(items.nth(0)).toContainText('niedziela, 18 października 2026, 09:30');
    await expect(items.nth(0)).toContainText('dr Anna Przykładowska');
    await expect(items.nth(1)).toContainText('wtorek, 27 października 2026, 14:15');
    await expect(items.nth(1)).toContainText('Okulista');
    await expect(appointments.getByText(/Do potwierdzenia: 1 wizyta\./)).toBeVisible();

    const stock = region(page, 'Zapasy leków');
    await expect(
      stock.getByText('Pozostało ok. 28 tabletek, wystarczy na ok. 14 dni.'),
    ).toBeVisible();
    await expect(stock.getByText('Pozostało ok. 120 ml, wystarczy na ok. 24 dni.')).toBeVisible();
    await expect(stock.getByText('Testovit')).toHaveCount(0); // no stock entered: not listed
    await expect(stock.getByText(/Dla 1 leku nie można policzyć szacunku/)).toBeVisible();
    await expect(stock.getByText(/a nie gwarancja, że lek jest dostępny/)).toBeVisible();
    expect(await page.locator('body').textContent()).not.toMatch(/%/);
  });

  test('marking a dose taken updates the counts and the stock, and survives a reload', async ({
    page,
  }) => {
    await loadDemoData(page);
    await openDashboard(page);
    const logsBefore = await storedLogCount(page);

    await page.getByRole('button', { name: 'Oznacz jako przyjętą: Demoxal, 08:00' }).click();

    const doses = region(page, 'Dzisiejsze dawki');
    await expect(doses.getByText('Zapisano jako przyjętą: Demoxal, 08:00.')).toBeVisible();
    await expect(
      doses.getByText('Przyjęte: 1. Pominięte: 0. Bez zapisu: 3. Razem dziś: 4.'),
    ).toBeVisible();
    await expect(
      region(page, 'Zapasy leków').getByText('Pozostało ok. 27 tabletek, wystarczy na ok. 13 dni.'),
    ).toBeVisible();
    expect(await storedLogCount(page)).toBe(logsBefore + 1);

    await page.reload();
    await expect(
      region(page, 'Dzisiejsze dawki').getByText(
        'Przyjęte: 1. Pominięte: 0. Bez zapisu: 3. Razem dziś: 4.',
      ),
    ).toBeVisible();
    await expect(
      region(page, 'Zapasy leków').getByText(/Pozostało ok\. 27 tabletek/),
    ).toBeVisible();
  });

  test('points at the first dose without a record, in words, and the pointer moves as doses are recorded', async ({
    page,
  }) => {
    await loadDemoData(page);
    await openDashboard(page);
    const doses = region(page, 'Dzisiejsze dawki');
    const label = doses.getByText('Następna dawka bez zapisu');

    // 07:30, 08:00, 13:00 and 20:00 are all unrecorded; the clock says 12:00 and it does not matter.
    await expect(label).toHaveCount(1);
    await expect(
      doses.getByRole('listitem').filter({ hasText: 'Następna dawka bez zapisu' }),
    ).toContainText('07:30');

    await page.getByRole('button', { name: 'Oznacz jako pominiętą: Przykładyna, 07:30' }).click();
    await expect(page.getByText('Zapisano jako pominiętą: Przykładyna, 07:30.')).toBeVisible();
    await expect(label).toHaveCount(1);
    await expect(
      doses.getByRole('listitem').filter({ hasText: 'Następna dawka bez zapisu' }),
    ).toContainText('08:00');

    await page.getByRole('button', { name: 'Oznacz jako przyjętą: Demoxal, 08:00' }).click();
    await expect(
      doses.getByRole('listitem').filter({ hasText: 'Następna dawka bez zapisu' }),
    ).toContainText('13:00');

    // Neutral wording: it is not a status and never says late or missed.
    expect(await doses.textContent()).not.toMatch(/spóźnion|zaległ|%/i);
    await expect(doses.getByText('Nie zapisano')).toHaveCount(2);
  });

  test('says in words, above the list, that a stock is low, and frames that medication', async ({
    page,
  }) => {
    await page.goto('/medications/new');
    await page.getByRole('textbox', { name: /^Nazwa leku/ }).fill('Malowit');
    await page.getByRole('textbox', { name: /^Jednostka dawki/ }).fill('tabletka');
    await page.getByLabel(/^Godzina 1/).fill('09:00');
    await page.getByRole('textbox', { name: /^Dawka 1/ }).fill('1');
    await page.getByRole('textbox', { name: /^Aktualny zapas/ }).fill('3');
    await page.getByRole('button', { name: 'Dodaj lek' }).click();
    await expect(page.getByText('Dodano lek „Malowit”.')).toBeVisible();

    await openDashboard(page);
    const stock = region(page, 'Zapasy leków');

    await expect(
      stock.getByText('Niski zapas: 1 lek. Szacunek wystarczy na mniej niż 7 dni.'),
    ).toBeVisible();
    const row = stock.getByRole('listitem').filter({ hasText: 'Malowit' });
    await expect(row.getByText('Niski zapas', { exact: true })).toBeVisible();
    await expect(row).toContainText('wystarczy na ok. 3 dni');
  });

  test('works with the keyboard, and keeps focus on the dose that changed', async ({ page }) => {
    await loadDemoData(page);
    await openDashboard(page);

    await page.getByRole('button', { name: 'Oznacz jako pominiętą: Testovit, 13:00' }).focus();
    await page.keyboard.press('Enter');

    await expect(
      region(page, 'Dzisiejsze dawki').getByText('Zapisano jako pominiętą: Testovit, 13:00.'),
    ).toBeVisible();
    await expect(
      region(page, 'Dzisiejsze dawki')
        .locator('p[tabindex="-1"]')
        .filter({ hasText: 'Testovit, 13:00:' }),
    ).toBeFocused();
  });

  test('a failed write shows an error in the panel and changes nothing', async ({ page }) => {
    await loadDemoData(page);
    await openDashboard(page);
    const logsBefore = await storedLogCount(page);
    await page.evaluate(() => {
      Storage.prototype.setItem = () => {
        throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
      };
    });

    await page.getByRole('button', { name: 'Oznacz jako przyjętą: Demoxal, 08:00' }).click();

    await expect(region(page, 'Dzisiejsze dawki').getByRole('alert')).toContainText(
      'Nie zapisano zmiany',
    );
    await expect(page.getByText(/Zapisano jako/)).toHaveCount(0);
    expect(await storedLogCount(page)).toBe(logsBefore);
    await expect(
      region(page, 'Zapasy leków').getByText(/Pozostało ok\. 28 tabletek/),
    ).toBeVisible();
  });

  test('leads to the day view, the appointments, the medications and the appointments to confirm', async ({
    page,
  }) => {
    await loadDemoData(page);

    await openDashboard(page);
    await region(page, 'Dzisiejsze dawki').getByRole('link', { name: 'Wszystkie dawki' }).click();
    await expect(page).toHaveURL(/\/doses$/);

    await openDashboard(page);
    await region(page, 'Najbliższe wizyty').getByRole('link', { name: 'Wszystkie wizyty' }).click();
    await expect(page).toHaveURL(/\/appointments$/);

    await openDashboard(page);
    await region(page, 'Najbliższe wizyty').getByRole('link', { name: 'Potwierdź' }).click();
    await expect(page).toHaveURL(/\/appointments\?tab=past$/);
    await expect(page.getByRole('tab', { name: /^Minione/ })).toHaveAttribute(
      'aria-selected',
      'true',
    );

    await openDashboard(page);
    await region(page, 'Zapasy leków').getByRole('link', { name: 'Zarządzaj lekami' }).click();
    await expect(page).toHaveURL(/\/medications$/);
  });
});

test.describe('without data', () => {
  test('shows a friendly empty state with a call to action in every panel', async ({ page }) => {
    await openDashboard(page);

    const doses = region(page, 'Dzisiejsze dawki');
    await expect(doses.getByText('Nie dodano jeszcze żadnego leku')).toBeVisible();
    const appointments = region(page, 'Najbliższe wizyty');
    await expect(appointments.getByText('Nie dodano jeszcze żadnej wizyty')).toBeVisible();
    await expect(region(page, 'Zapasy leków').getByText('Brak leków')).toBeVisible();

    await doses.getByRole('link', { name: 'Dodaj pierwszy lek' }).click();
    await expect(page).toHaveURL(/\/medications\/new$/);
    await openDashboard(page);
    await appointments.getByRole('link', { name: 'Dodaj pierwszą wizytę' }).click();
    await expect(page).toHaveURL(/\/appointments\/new$/);
  });

  test('a new medication appears on the dashboard right away', async ({ page }) => {
    await page.goto('/medications/new');
    await page.getByRole('textbox', { name: /^Nazwa leku/ }).fill('Lek testowy');
    await page.getByRole('textbox', { name: /^Jednostka dawki/ }).fill('tabletka');
    await page.getByLabel(/^Godzina 1/).fill('18:00');
    await page.getByRole('textbox', { name: /^Dawka 1/ }).fill('1');
    await page.getByRole('textbox', { name: /^Aktualny zapas/ }).fill('10');
    await page.getByRole('button', { name: 'Dodaj lek', exact: true }).click();
    await expect(page.getByText(/Dodano lek/)).toBeVisible();

    await page.getByRole('link', { name: 'Pulpit', exact: true }).click();

    await expect(
      region(page, 'Dzisiejsze dawki').getByRole('button', {
        name: 'Oznacz jako przyjętą: Lek testowy, 18:00',
      }),
    ).toBeVisible();
    await expect(
      region(page, 'Zapasy leków').getByText('Pozostało ok. 10 tabletek, wystarczy na ok. 10 dni.'),
    ).toBeVisible();
  });
});

test.describe('independent panels', () => {
  test('a failure to read appointments leaves the doses and the stock, and retry recovers', async ({
    page,
  }) => {
    await loadDemoData(page);
    const healthy = await page.evaluate(
      (key) => window.localStorage.getItem(key),
      APPOINTMENTS_KEY,
    );
    await page.evaluate((key) => {
      window.localStorage.setItem(key, '{broken');
    }, APPOINTMENTS_KEY);
    await openDashboard(page);

    const appointments = region(page, 'Najbliższe wizyty');
    await expect(appointments.getByRole('alert')).toContainText('Nie udało się wczytać wizyt');
    await expect(appointments.getByText('Nie dodano jeszcze żadnej wizyty')).toHaveCount(0);
    await expect(
      region(page, 'Dzisiejsze dawki').getByRole('button', {
        name: 'Oznacz jako przyjętą: Demoxal, 08:00',
      }),
    ).toBeVisible();
    await expect(
      region(page, 'Zapasy leków').getByText(/Pozostało ok\. 28 tabletek/),
    ).toBeVisible();
    expect(await page.evaluate((key) => window.localStorage.getItem(key), APPOINTMENTS_KEY)).toBe(
      '{broken',
    );

    if (healthy === null) throw new Error('The demo data left no appointments in storage');
    await page.evaluate(
      ({ key, value }) => {
        window.localStorage.setItem(key, value);
      },
      { key: APPOINTMENTS_KEY, value: healthy },
    );
    await appointments.getByRole('button', { name: 'Spróbuj ponownie' }).click();
    await expect(appointments.getByText('dr Anna Przykładowska')).toBeVisible();
  });

  test('a failure to read the intake records leaves the appointments', async ({ page }) => {
    await loadDemoData(page);
    await page.evaluate((key) => {
      window.localStorage.setItem(key, '{broken');
    }, LOGS_KEY);
    await openDashboard(page);

    await expect(region(page, 'Dzisiejsze dawki').getByRole('alert')).toContainText(
      'Nie udało się wczytać dzisiejszych dawek',
    );
    await expect(region(page, 'Zapasy leków').getByRole('alert')).toContainText(
      'Nie udało się wczytać zapasów',
    );
    await expect(
      region(page, 'Najbliższe wizyty').getByText('dr Anna Przykładowska'),
    ).toBeVisible();
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

    test('the dashboard with data fits, its actions are comfortable to touch, and the panels are arranged for the width', async ({
      page,
    }) => {
      await loadDemoData(page);
      await openDashboard(page);
      expect(await overflows(page)).toBe(false);

      for (const button of [
        page.getByRole('button', { name: 'Oznacz jako przyjętą: Demoxal, 08:00' }),
        page.getByRole('link', { name: 'Wszystkie dawki' }),
        page.getByRole('link', { name: 'Zarządzaj lekami' }),
      ]) {
        const box = await button.boundingBox();
        expect(box?.height).toBeGreaterThanOrEqual(44);
        expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(viewport.width);
      }
      const appointments = await region(page, 'Najbliższe wizyty').boundingBox();
      const stock = await region(page, 'Zapasy leków').boundingBox();
      if (viewport.width >= 768) {
        // Side by side from the tablet width up.
        expect(Math.abs((appointments?.y ?? 0) - (stock?.y ?? 1))).toBeLessThan(2);
        expect(stock?.x ?? 0).toBeGreaterThan(appointments?.x ?? 0);
      } else {
        // One under the other on a phone.
        expect(stock?.y ?? 0).toBeGreaterThan(
          (appointments?.y ?? 0) + (appointments?.height ?? 0) - 1,
        );
      }
      await page.getByRole('button', { name: 'Oznacz jako przyjętą: Demoxal, 08:00' }).click();
      await expect(page.getByText('Zapisano jako przyjętą: Demoxal, 08:00.')).toBeVisible();
      expect(await overflows(page)).toBe(false);
    });

    test('the empty dashboard and long names fit', async ({ page }) => {
      await openDashboard(page);
      expect(await overflows(page)).toBe(false);

      const long = 'Bardzo-długa-nazwa-bez-spacji-'.repeat(4);
      await page.goto('/medications/new');
      await page.getByRole('textbox', { name: /^Nazwa leku/ }).fill(long);
      await page.getByRole('textbox', { name: /^Jednostka dawki/ }).fill('tabletka');
      await page.getByLabel(/^Godzina 1/).fill('18:00');
      await page.getByRole('textbox', { name: /^Dawka 1/ }).fill('1');
      await page.getByRole('textbox', { name: /^Aktualny zapas/ }).fill('10');
      await page.getByRole('button', { name: 'Dodaj lek', exact: true }).click();
      await expect(page.getByRole('heading', { level: 1, name: 'Leki' })).toBeVisible();

      await openDashboard(page);
      await expect(region(page, 'Zapasy leków').getByText(long, { exact: true })).toBeVisible();
      expect(await overflows(page)).toBe(false);
    });
  });
}
