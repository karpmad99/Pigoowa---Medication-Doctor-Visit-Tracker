import { expect, test, type Page } from '@playwright/test';

// These cover what jsdom cannot: the real behaviour of the native <dialog> in a browser.

async function openDeleteDialog(page: Page) {
  await page.goto('/dev/components');
  await expect(page.getByRole('heading', { level: 1, name: 'Podgląd komponentów' })).toBeVisible();
  await page.getByRole('button', { name: 'Okno usuwania' }).click();
  const dialog = page.getByRole('dialog', { name: 'Usunąć przykładowy element?' });
  await expect(dialog).toBeVisible();
  return dialog;
}

test.describe('confirmation dialog in a real browser', () => {
  test('opens with focus on Cancel, so a stray Enter cannot confirm a destructive action', async ({
    page,
  }) => {
    const dialog = await openDeleteDialog(page);

    await expect(dialog.getByRole('button', { name: 'Anuluj' })).toBeFocused();
  });

  test('keeps keyboard focus away from the page behind while open', async ({ page }) => {
    const dialog = await openDeleteDialog(page);
    const visited = new Set<string>();

    // A native modal dialog cycles focus through its own controls. After the last one the
    // browser may make one stop outside the page (its own interface, seen by the page as
    // <body>) before re-entering the dialog. What must never happen is landing on the page behind.
    for (let step = 0; step < 9; step += 1) {
      await page.keyboard.press('Tab');
      const where = await dialog.evaluate((element) => {
        const active = document.activeElement;
        if (active === document.body) return 'browser';
        if (active !== null && element.contains(active)) {
          return active.getAttribute('aria-label') ?? active.textContent.trim();
        }
        return `PAGE BEHIND: ${active?.tagName ?? 'nothing'} ${active?.textContent.trim() ?? ''}`;
      });
      expect(where).not.toMatch(/^PAGE BEHIND/);
      visited.add(where);
    }

    expect([...visited].sort()).toEqual(
      ['Anuluj', 'Usuń na stałe', 'Zamknij okno', 'browser'].sort(),
    );
  });

  test('also keeps Shift+Tab away from the page behind', async ({ page }) => {
    const dialog = await openDeleteDialog(page);

    for (let step = 0; step < 6; step += 1) {
      await page.keyboard.press('Shift+Tab');
      const isBehind = await dialog.evaluate((element) => {
        const active = document.activeElement;
        return active !== document.body && active !== null && !element.contains(active);
      });
      expect(isBehind).toBe(false);
    }
  });

  test('Escape closes it, reports a cancel, and returns focus to the button that opened it', async ({
    page,
  }) => {
    const dialog = await openDeleteDialog(page);

    await page.keyboard.press('Escape');

    await expect(dialog).toBeHidden();
    await expect(page.getByRole('button', { name: 'Okno usuwania' })).toBeFocused();
    await expect(page.getByText('Wynik: Anulowano usuwanie.')).toBeVisible();
  });

  test('can be confirmed with the keyboard', async ({ page }) => {
    const dialog = await openDeleteDialog(page);

    await page.keyboard.press('Tab'); // from Cancel to the confirm button
    await expect(dialog.getByRole('button', { name: 'Usuń na stałe' })).toBeFocused();
    await page.keyboard.press('Enter');

    await expect(dialog).toBeHidden();
    await expect(page.getByText('Wynik: Potwierdzono usunięcie.')).toBeVisible();
  });

  test('closes when the dark backdrop is clicked, but not when the panel is clicked', async ({
    page,
  }) => {
    const dialog = await openDeleteDialog(page);

    await dialog.getByRole('heading', { name: 'Usunąć przykładowy element?' }).click();
    await expect(dialog).toBeVisible();

    await page.mouse.click(4, 4); // the corner of the page is backdrop
    await expect(dialog).toBeHidden();
    await expect(page.getByText('Wynik: Anulowano usuwanie.')).toBeVisible();
  });

  test('the page behind cannot be clicked while it is open', async ({ page }) => {
    await openDeleteDialog(page);

    await expect(
      page.getByRole('link', { name: 'Leki', exact: true }).click({ trial: true, timeout: 1000 }),
    ).rejects.toThrow();
  });

  test('works at phone width too', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const dialog = await openDeleteDialog(page);

    const box = await dialog.boundingBox();
    expect(box?.x).toBeGreaterThanOrEqual(0);
    expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(390);
    await page.getByRole('button', { name: 'Anuluj' }).click();
    await expect(dialog).toBeHidden();
  });
});
