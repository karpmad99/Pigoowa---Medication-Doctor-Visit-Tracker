import { expect, test, type Page } from '@playwright/test';

// These use the browser's real localStorage; every Playwright test starts with an empty one.

const MEDICATIONS_KEY = 'pigoowa:v1:medications';
const BACKUP_KEY = 'pigoowa:v1:backup';

async function openDataPage(page: Page) {
  await page.goto('/dev/data');
  await expect(page.getByRole('heading', { level: 1, name: 'Dane demonstracyjne' })).toBeVisible();
}

const stored = (page: Page, key: string) =>
  page.evaluate((storageKey) => window.localStorage.getItem(storageKey), key);

test.describe('data layer in a real browser', () => {
  test('visiting pages never writes anything to storage', async ({ page }) => {
    for (const path of ['/', '/medications', '/appointments']) {
      await page.goto(path);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    }
    await openDataPage(page);
    await expect(page.getByText('Brak zapisanych leków.')).toBeVisible();

    expect(await page.evaluate(() => window.localStorage.length)).toBe(0);
  });

  test('starts empty, loads demo data on request, and keeps it after a reload', async ({
    page,
  }) => {
    await openDataPage(page);
    await expect(page.getByText('Brak zapisanych leków.')).toBeVisible();
    await expect(page.getByText('Brak zapisanych wizyt.')).toBeVisible();

    await page.getByRole('button', { name: 'Wczytaj dane demonstracyjne' }).click();
    await expect(page.getByText('Wczytano dane demonstracyjne.')).toBeVisible();
    const medications = page.getByRole('region', { name: 'Leki' });
    await expect(medications.getByRole('heading', { name: 'Leki (4)' })).toBeVisible();
    await expect(medications.getByText('Demoxal')).toBeVisible();

    await page.reload();

    await expect(page.getByRole('region', { name: 'Leki' }).getByText('Demoxal')).toBeVisible();
    await expect(
      page.getByRole('region', { name: 'Wizyty' }).getByRole('heading', { name: 'Wizyty (5)' }),
    ).toBeVisible();
    // Version 2 is what is written since the storage migration (PROJECT_SPEC §10.5).
    expect(JSON.parse((await stored(page, MEDICATIONS_KEY)) ?? 'null')).toMatchObject({
      version: 2,
    });
  });

  test('marks demo entries as examples', async ({ page }) => {
    await openDataPage(page);
    await page.getByRole('button', { name: 'Wczytaj dane demonstracyjne' }).click();

    const medications = page.getByRole('region', { name: 'Leki' });
    await expect(medications.getByText('Przykład', { exact: true })).toHaveCount(4);
  });

  test('refuses to load demo data a second time instead of overwriting', async ({ page }) => {
    await openDataPage(page);
    await page.getByRole('button', { name: 'Wczytaj dane demonstracyjne' }).click();
    await expect(page.getByText('Wczytano dane demonstracyjne.')).toBeVisible();
    const before = await stored(page, MEDICATIONS_KEY);

    await page.getByRole('button', { name: 'Wczytaj dane demonstracyjne' }).click();

    await expect(page.getByText(/można wczytać tylko do pustej pamięci/)).toBeVisible();
    expect(await stored(page, MEDICATIONS_KEY)).toBe(before);
  });

  test('shows corrupted data as an error, never overwrites it, and recovers through a confirmed reset', async ({
    page,
  }) => {
    await openDataPage(page);
    await page.evaluate((key) => {
      window.localStorage.setItem(key, '{"version":1,"items":[{"id":');
    }, MEDICATIONS_KEY);

    await page.reload();

    const medications = page.getByRole('region', { name: 'Leki' });
    await expect(medications.getByRole('alert')).toContainText('Zapisane dane są uszkodzone');
    expect(await stored(page, MEDICATIONS_KEY)).toBe('{"version":1,"items":[{"id":');

    await page.getByRole('button', { name: 'Przywróć dane demonstracyjne…' }).click();
    const dialog = page.getByRole('dialog', { name: 'Przywrócić dane demonstracyjne?' });
    await expect(dialog.getByRole('button', { name: 'Anuluj' })).toBeFocused();
    await dialog.getByRole('button', { name: 'Przywróć dane demonstracyjne' }).click();

    await expect(page.getByText('Przywrócono dane demonstracyjne.')).toBeVisible();
    await expect(medications.getByText('Demoxal')).toBeVisible();
    const backup = JSON.parse((await stored(page, BACKUP_KEY)) ?? 'null') as {
      entries: Record<string, string | null>;
    };
    expect(backup.entries[MEDICATIONS_KEY]).toBe('{"version":1,"items":[{"id":');
  });

  test('cancelling the reset leaves everything untouched', async ({ page }) => {
    await openDataPage(page);
    await page.getByRole('button', { name: 'Wczytaj dane demonstracyjne' }).click();
    await expect(page.getByText('Wczytano dane demonstracyjne.')).toBeVisible();
    const before = await stored(page, MEDICATIONS_KEY);

    await page.getByRole('button', { name: 'Przywróć dane demonstracyjne…' }).click();
    await page.keyboard.press('Escape');

    await expect(page.getByRole('dialog')).toBeHidden();
    expect(await stored(page, MEDICATIONS_KEY)).toBe(before);
    expect(await stored(page, BACKUP_KEY)).toBeNull();
  });

  test('reports storage that refuses to read, and recovers with a retry', async ({ page }) => {
    // Browsers with blocked site data throw when `window.localStorage` is touched at all.
    await page.addInitScript(() => {
      const realStorage = window.localStorage;
      const state = { blocked: true };
      Object.defineProperty(window, '__storageState', { value: state });
      Object.defineProperty(window, 'localStorage', {
        configurable: true,
        get() {
          if (state.blocked) throw new DOMException('blocked', 'SecurityError');
          return realStorage;
        },
      });
    });
    await openDataPage(page);

    const appointments = page.getByRole('region', { name: 'Wizyty' });
    await expect(appointments.getByRole('alert')).toContainText(
      'Nie można uzyskać dostępu do pamięci przeglądarki',
    );

    await page.evaluate(() => {
      (window as unknown as { __storageState: { blocked: boolean } }).__storageState.blocked =
        false;
    });
    await appointments.getByRole('button', { name: 'Spróbuj ponownie' }).click();

    await expect(appointments.getByText('Brak zapisanych wizyt.')).toBeVisible();
  });
});
