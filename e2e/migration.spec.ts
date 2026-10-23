import { expect, test, type Page } from '@playwright/test';

// The storage migration in a real browser (PROJECT_SPEC §10.5): data an older version of the app
// stored (version 1) is backed up and brought up to date when the app starts, and a failure is
// shown instead of hidden. The data is fictional.

test.use({ timezoneId: 'Europe/Warsaw', locale: 'pl-PL' });

const KEYS = {
  medications: 'pigoowa:v1:medications',
  doseLogs: 'pigoowa:v1:dose-logs',
  appointments: 'pigoowa:v1:appointments',
  meta: 'pigoowa:v1:migration-backup:meta',
  medicationsBackup: 'pigoowa:v1:migration-backup:medications',
  doseLogsBackup: 'pigoowa:v1:migration-backup:dose-logs',
  appointmentsBackup: 'pigoowa:v1:migration-backup:appointments',
};

const MEDICATION = {
  id: 'migr-med-1',
  name: 'Lek Przedmigracyjny',
  doseUnit: 'Tabletka ',
  notes: null,
  startDate: '2026-01-01',
  endDate: null,
  scheduleEffectiveFrom: '2026-01-01',
  scheduleTimes: [{ id: 'migr-time-1', timeOfDay: '08:00', doseAmount: 1 }],
  stock: null,
  createdAt: '2026-01-01T08:00:00.000Z',
  updatedAt: '2026-01-01T08:00:00.000Z',
};

const VERSION_1_MEDICATIONS = JSON.stringify({ version: 1, items: [MEDICATION] });

const stored = (page: Page, key: string) =>
  page.evaluate((storageKey) => window.localStorage.getItem(storageKey), key);

/** Stores version 1 data the way an older copy of the app left it, then opens the app afresh. */
async function openWithVersion1Data(page: Page) {
  await page.clock.setFixedTime(new Date('2026-10-15T10:00:00Z'));
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1, name: 'Pulpit' })).toBeVisible();
  await page.evaluate(
    ([key, text]) => {
      window.localStorage.setItem(key, text);
    },
    [KEYS.medications, VERSION_1_MEDICATIONS] as const,
  );
  await page.goto('/medications');
  await expect(page.getByRole('heading', { level: 1, name: 'Leki' })).toBeVisible();
}

test('data stored by an older version is backed up and brought up to date when the app starts', async ({
  page,
}) => {
  await openWithVersion1Data(page);

  // The medication is there, with its unit exactly as it was stored.
  await expect(page.getByRole('article', { name: 'Lek Przedmigracyjny' })).toBeVisible();
  const migrated = JSON.parse((await stored(page, KEYS.medications)) ?? 'null') as {
    version: number;
    items: { doseUnit: string }[];
  };
  expect(migrated.version).toBe(2);
  expect(migrated.items[0]?.doseUnit).toBe('Tabletka ');
  // The backup is the exact original text, and the provenance entry is verified.
  expect(await stored(page, KEYS.medicationsBackup)).toBe(VERSION_1_MEDICATIONS);
  const meta = JSON.parse((await stored(page, KEYS.meta)) ?? 'null') as {
    entries: Record<string, { sha256: string; verifiedAt?: string }>;
  };
  expect(meta.entries.medications?.sha256).toMatch(/^[0-9a-f]{64}$/);
  expect(meta.entries.medications?.verifiedAt).toBeDefined();
  // Nothing needs the user's attention.
  await expect(
    page.getByRole('region', { name: 'Aktualizacja danych w przeglądarce' }),
  ).toHaveCount(0);
});

test('after the migration the app writes normally, and a reload changes nothing', async ({
  page,
}) => {
  await openWithVersion1Data(page);
  await page.goto('/');

  await page
    .getByRole('button', { name: 'Oznacz jako przyjętą: Lek Przedmigracyjny, 08:00' })
    .click();
  await expect(page.getByText('Zapisano jako przyjętą: Lek Przedmigracyjny, 08:00.')).toBeVisible();
  const backup = await stored(page, KEYS.medicationsBackup);

  await page.reload();

  await expect(page.getByText(/Przyjęte: 1\./)).toBeVisible();
  expect(await stored(page, KEYS.medicationsBackup)).toBe(backup);
  expect(JSON.parse((await stored(page, KEYS.doseLogs)) ?? 'null')).toMatchObject({ version: 2 });
});

test('with no room for the backup the data stays as it was, is readable, writes are refused, and a retry works', async ({
  page,
}) => {
  await page.clock.setFixedTime(new Date('2026-10-15T10:00:00Z'));
  // A browser whose storage refuses to hold the backup, until the test says there is room.
  await page.addInitScript((backupPrefix) => {
    const original = Storage.prototype.setItem.bind(window.localStorage);
    Storage.prototype.setItem = (key: string, value: string) => {
      const blocked = (window as unknown as { __noRoom?: boolean }).__noRoom !== false;
      if (blocked && key.startsWith(backupPrefix)) {
        throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
      }
      original(key, value);
    };
  }, 'pigoowa:v1:migration-backup:');
  await page.goto('/');
  await page.evaluate(
    ([key, text]) => {
      window.localStorage.setItem(key, text);
    },
    [KEYS.medications, VERSION_1_MEDICATIONS] as const,
  );

  await page.goto('/');

  const notice = page.getByRole('region', { name: 'Aktualizacja danych w przeglądarce' });
  await expect(notice).toContainText('brakuje miejsca w pamięci przeglądarki na kopię zapasową');
  expect(await stored(page, KEYS.medications)).toBe(VERSION_1_MEDICATIONS);
  expect(await stored(page, KEYS.medicationsBackup)).toBeNull();
  // The data can be read ...
  await expect(
    page.getByRole('button', { name: 'Oznacz jako przyjętą: Lek Przedmigracyjny, 08:00' }),
  ).toBeVisible();
  // ... but a write to the collection that is still in the old format is refused, with a message.
  // (Recording a dose writes a different collection, which has no old data, so it still works.)
  await page.goto('/medications/migr-med-1/edit');
  await page.getByRole('textbox', { name: /^Nazwa leku/ }).fill('Zmieniona nazwa');
  await page.getByRole('button', { name: 'Zapisz zmiany' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Nie zapisano leku' })).toContainText(
    'nie zostały jeszcze zaktualizowane do nowego formatu',
  );
  expect(await stored(page, KEYS.medications)).toBe(VERSION_1_MEDICATIONS);

  // There is room again: the retry migrates and the notice goes away.
  await page.evaluate(() => {
    (window as unknown as { __noRoom?: boolean }).__noRoom = false;
  });
  await notice.getByRole('button', { name: 'Spróbuj ponownie' }).click();

  await expect(notice).toHaveCount(0);
  expect(JSON.parse((await stored(page, KEYS.medications)) ?? 'null')).toMatchObject({
    version: 2,
  });
  expect(await stored(page, KEYS.medicationsBackup)).toBe(VERSION_1_MEDICATIONS);
});

test('damaged data is not touched and is reported', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-10-15T10:00:00Z'));
  await page.goto('/');
  const damaged = '{"version":1,"items":[{"id":"x"}]}';
  await page.evaluate(
    ([key, text]) => {
      window.localStorage.setItem(key, text);
    },
    [KEYS.appointments, damaged] as const,
  );

  await page.goto('/appointments');

  await expect(
    page.getByRole('region', { name: 'Aktualizacja danych w przeglądarce' }),
  ).toContainText('Wizyty: zapisane dane są uszkodzone');
  expect(await stored(page, KEYS.appointments)).toBe(damaged);
  expect(await stored(page, KEYS.appointmentsBackup)).toBeNull();
});
