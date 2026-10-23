import { expect, test, type Page } from '@playwright/test';

// The time field (PROJECT_SPEC DEC-49) in a real browser emulating a phone: a touch screen, a
// narrow viewport and the fixed clock/time zone the other specs use. Chromium cannot show the
// iOS or Android pickers, so what these tests prove is the field's own behaviour (typing,
// normalising, messages, quick picks, sizes); the real-device checklist is in docs/ROADMAP.md.

const NOW = new Date('2026-10-15T10:00:00Z');
const MEDICATIONS_KEY = 'pigoowa:v1:medications';
const APPOINTMENTS_KEY = 'pigoowa:v1:appointments';

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

async function storedItems<T>(page: Page, key: string): Promise<T[]> {
  const raw = await page.evaluate((storageKey) => window.localStorage.getItem(storageKey), key);
  // JSON.parse returns `any`; the storage envelope `{ version, items }` is the app's own format.
  return raw === null ? [] : (JSON.parse(raw) as { items: T[] }).items;
}

const overflows = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);

async function openNewMedication(page: Page) {
  await page.goto('/medications/new');
  await expect(page.getByRole('heading', { level: 1, name: 'Dodaj lek' })).toBeVisible();
  await page.getByRole('textbox', { name: /^Nazwa leku/ }).fill('Moj lek');
  await page.getByRole('textbox', { name: /^Jednostka dawki/ }).fill('tabletka');
  await page.getByRole('textbox', { name: /^Dawka 1/ }).fill('1');
}

const timeBox = (page: Page) => page.getByRole('textbox', { name: /^Godzina 1/ });

test.describe('typing a time on a phone', () => {
  test('is a text field with the digit keypad, not the system time control', async ({ page }) => {
    await openNewMedication(page);

    await expect(timeBox(page)).toHaveAttribute('type', 'text');
    await expect(timeBox(page)).toHaveAttribute('inputmode', 'numeric');
    await expect(timeBox(page)).toHaveAttribute('autocomplete', 'off');
  });

  for (const [typed, shown] of [
    ['0730', '07:30'],
    ['730', '07:30'],
    ['7:30', '07:30'],
    ['7.30', '07:30'],
    ['07:30', '07:30'],
    ['2359', '23:59'],
    ['0000', '00:00'],
  ] as const) {
    test(`"${typed}" becomes ${shown} when the person leaves the field, and is saved as ${shown}`, async ({
      page,
    }) => {
      await openNewMedication(page);

      await timeBox(page).pressSequentially(typed);
      // While typing, only what was typed is there.
      await expect(timeBox(page)).toHaveValue(typed);
      await page.getByRole('textbox', { name: /^Dawka 1/ }).tap();
      await expect(timeBox(page)).toHaveValue(shown);
      await expect(page.getByRole('alert')).toHaveCount(0);

      await page.getByRole('button', { name: 'Dodaj lek' }).tap();
      await expect(page).toHaveURL(/\/medications$/);
      const saved = await storedItems<{ scheduleTimes: { timeOfDay: string }[] }>(
        page,
        MEDICATIONS_KEY,
      );
      expect(saved[0]?.scheduleTimes.map((entry) => entry.timeOfDay)).toEqual([shown]);
    });
  }

  test('an unfinished entry is neither erased nor reported while typing, and is explained after leaving', async ({
    page,
  }) => {
    await openNewMedication(page);

    await timeBox(page).pressSequentially('07:');
    await expect(timeBox(page)).toHaveValue('07:');
    await expect(page.getByRole('alert')).toHaveCount(0);
    await expect(timeBox(page)).not.toHaveAttribute('aria-invalid', 'true');

    await page.getByRole('textbox', { name: /^Dawka 1/ }).tap();
    await expect(timeBox(page)).toHaveValue('07:');
    await expect(page.getByRole('alert')).toHaveText(
      'Wpisz godzinę w formacie GG:MM, na przykład 07:30.',
    );
    await expect(timeBox(page)).toHaveAttribute('aria-invalid', 'true');

    // Going back to finish it removes the message as soon as the time is complete.
    await timeBox(page).tap();
    await timeBox(page).pressSequentially('30');
    await expect(timeBox(page)).toHaveValue('07:30');
    await expect(page.getByRole('alert')).toHaveCount(0);
  });

  test('a time that does not exist is named as such, kept as typed and refused on save', async ({
    page,
  }) => {
    await openNewMedication(page);

    await timeBox(page).pressSequentially('2560');
    await page.getByRole('textbox', { name: /^Dawka 1/ }).tap();
    await expect(timeBox(page)).toHaveValue('2560');
    await expect(page.getByRole('alert')).toHaveText(
      'Taka godzina nie istnieje. Wpisz godzinę od 00:00 do 23:59.',
    );

    await page.getByRole('button', { name: 'Dodaj lek' }).tap();
    await expect(page).toHaveURL(/\/medications\/new$/);
    await expect(timeBox(page)).toBeFocused();
    await expect(timeBox(page)).toHaveValue('2560');
    expect(await storedItems(page, MEDICATIONS_KEY)).toHaveLength(0);
    // One message for the field, not the form's and the field's together.
    await expect(page.getByText(/Wpisz godzinę w formacie|Taka godzina nie istnieje/)).toHaveCount(
      1,
    );
  });

  test('leaving the field empty is the form’s "required" message, not a second one', async ({
    page,
  }) => {
    await openNewMedication(page);

    await page.getByRole('button', { name: 'Dodaj lek' }).tap();
    await expect(page).toHaveURL(/\/medications\/new$/);
    await expect(timeBox(page)).toBeFocused();
    await expect(timeBox(page)).toHaveAttribute('aria-invalid', 'true');
    expect(await storedItems(page, MEDICATIONS_KEY)).toHaveLength(0);
  });
});

test.describe('quick picks and the clock', () => {
  test('tapping a popular time fills the field and marks the choice', async ({ page }) => {
    await openNewMedication(page);

    const group = page.getByRole('group', { name: 'Popularne godziny dla pozycji 1' });
    await group.getByRole('button', { name: 'Ustaw 20:00' }).tap();

    await expect(timeBox(page)).toHaveValue('20:00');
    await expect(group.getByRole('button', { name: 'Ustaw 20:00' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(group.getByRole('button', { name: 'Ustaw 08:00' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );

    await page.getByRole('button', { name: 'Dodaj lek' }).tap();
    await expect(page).toHaveURL(/\/medications$/);
    const saved = await storedItems<{ scheduleTimes: { timeOfDay: string }[] }>(
      page,
      MEDICATIONS_KEY,
    );
    expect(saved[0]?.scheduleTimes[0]?.timeOfDay).toBe('20:00');
  });

  test('typing a time that is also a quick pick marks that pick', async ({ page }) => {
    await openNewMedication(page);

    await timeBox(page).pressSequentially('1200');

    await expect(page.getByRole('button', { name: 'Ustaw 12:00' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  test('the clock is a real time control over a visible button, and its choice lands in the field', async ({
    page,
  }) => {
    await openNewMedication(page);

    const clock = page.getByLabel('Wybierz z zegara godzinę 1');
    await expect(clock).toHaveAttribute('type', 'time');
    await expect(page.getByText('Zegar', { exact: true })).toBeVisible();
    // It covers the whole visible button, so a tap on the button reaches the platform control.
    const button = await page.getByText('Zegar', { exact: true }).locator('..').boundingBox();
    const control = await clock.boundingBox();
    expect(button).not.toBeNull();
    expect(control).not.toBeNull();
    expect(control?.width).toBeGreaterThanOrEqual(button?.width ?? Infinity);
    expect(control?.height).toBeGreaterThanOrEqual(button?.height ?? Infinity);

    await clock.fill('09:15');

    await expect(timeBox(page)).toHaveValue('09:15');
    await page.getByRole('button', { name: 'Dodaj lek' }).tap();
    await expect(page).toHaveURL(/\/medications$/);
    const saved = await storedItems<{ scheduleTimes: { timeOfDay: string }[] }>(
      page,
      MEDICATIONS_KEY,
    );
    expect(saved[0]?.scheduleTimes[0]?.timeOfDay).toBe('09:15');
  });

  test('every row has its own field, picks and clock, and a duplicate time is still refused', async ({
    page,
  }) => {
    await openNewMedication(page);
    await page.getByRole('button', { name: 'Dodaj godzinę' }).tap();
    await page.getByRole('textbox', { name: /^Dawka 2/ }).fill('1');

    await timeBox(page).pressSequentially('0800');
    await page
      .getByRole('group', { name: 'Popularne godziny dla pozycji 2' })
      .getByRole('button', { name: 'Ustaw 08:00' })
      .tap();
    await expect(page.getByRole('textbox', { name: /^Godzina 2/ })).toHaveValue('08:00');

    await page.getByRole('button', { name: 'Dodaj lek' }).tap();
    await expect(page).toHaveURL(/\/medications\/new$/);
    expect(await storedItems(page, MEDICATIONS_KEY)).toHaveLength(0);
  });
});

test.describe('size and reach on a small phone', () => {
  test('the box, the clock and every quick pick are at least 44 px tall and nothing overflows', async ({
    page,
  }) => {
    await openNewMedication(page);
    await page.getByRole('button', { name: 'Dodaj godzinę' }).tap();
    // The message shown after leaving a bad entry must fit too.
    await timeBox(page).pressSequentially('2560');
    await page.getByRole('textbox', { name: /^Dawka 1/ }).tap();
    await expect(page.getByRole('alert')).toBeVisible();

    expect(await overflows(page)).toBe(false);
    const controls = [
      timeBox(page),
      page.getByLabel('Wybierz z zegara godzinę 1'),
      ...(await page
        .getByRole('group', { name: 'Popularne godziny dla pozycji 1' })
        .getByRole('button')
        .all()),
    ];
    for (const control of controls) {
      const box = await control.boundingBox();
      expect(box?.height, await control.evaluate((node) => node.outerHTML)).toBeGreaterThanOrEqual(
        44,
      );
      expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(360);
    }
    const quick = await page
      .getByRole('group', { name: 'Popularne godziny dla pozycji 1' })
      .getByRole('button')
      .all();
    for (const button of quick) {
      expect((await button.boundingBox())?.width).toBeGreaterThanOrEqual(44);
    }
  });

  test('at 200 % text size the field still fits the screen', async ({ page }) => {
    await openNewMedication(page);
    await page.addStyleTag({ content: 'html { font-size: 200% !important; }' });

    expect(await overflows(page)).toBe(false);
    await expect(page.getByRole('button', { name: 'Ustaw 22:00' })).toBeVisible();
  });
});

test.describe('the same field for appointments', () => {
  test('1030 is saved as 10:30 local time and shown that way', async ({ page }) => {
    await page.goto('/appointments/new');
    await expect(page.getByRole('heading', { level: 1, name: 'Dodaj wizytę' })).toBeVisible();
    await page.getByRole('textbox', { name: /^Lekarz/ }).fill('dr Testowy');
    await page.getByLabel(/^Data wizyty/).fill('2026-10-20');

    const box = page.getByRole('textbox', { name: /^Godzina wizyty/ });
    await expect(box).toHaveAttribute('inputmode', 'numeric');
    await box.pressSequentially('1030');
    await page.getByRole('textbox', { name: /^Lekarz/ }).tap();
    await expect(box).toHaveValue('10:30');

    await page.getByRole('button', { name: 'Dodaj wizytę' }).tap();
    await expect(page).toHaveURL(/\/appointments$/);
    await expect(page.getByText('10:30').first()).toBeVisible();
    const saved = await storedItems<{ scheduledAt: string }>(page, APPOINTMENTS_KEY);
    // 10:30 in Warsaw on 20 October 2026 (UTC+2) is 08:30 UTC.
    expect(saved[0]?.scheduledAt).toBe('2026-10-20T08:30:00.000Z');
  });

  test('a quick pick for visits sets the time', async ({ page }) => {
    await page.goto('/appointments/new');
    await page.getByRole('button', { name: 'Ustaw 14:00' }).tap();

    await expect(page.getByRole('textbox', { name: /^Godzina wizyty/ })).toHaveValue('14:00');
  });
});

test.describe('existing records', () => {
  test('a stored time is shown as it was and saving without touching it keeps it', async ({
    page,
  }) => {
    await page.goto('/dev/data');
    await page.getByRole('button', { name: 'Wczytaj dane demonstracyjne' }).click();
    await expect(page.getByText('Wczytano dane demonstracyjne.')).toBeVisible();
    const before = await page.evaluate((key) => window.localStorage.getItem(key), MEDICATIONS_KEY);

    await page.goto('/medications/demo-medication-demoxal/edit');
    await expect(timeBox(page)).toHaveValue('08:00');
    await page.getByRole('textbox', { name: /^Nazwa leku/ }).tap();
    await page.getByRole('button', { name: 'Zapisz zmiany' }).tap();
    await expect(page.getByText(/Zapisano zmiany/)).toBeVisible();

    const after = await storedItems<{ id: string; scheduleTimes: { timeOfDay: string }[] }>(
      page,
      MEDICATIONS_KEY,
    );
    const demoxal = after.find((medication) => medication.id === 'demo-medication-demoxal');
    expect(demoxal?.scheduleTimes.map((entry) => entry.timeOfDay)).toContain('08:00');
    expect(before).not.toBeNull();
  });
});
