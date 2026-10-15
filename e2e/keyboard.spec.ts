import { expect, test } from '@playwright/test';

test.describe('keyboard use', () => {
  test('the skip link is the first stop, becomes visible, and moves focus to the content', async ({
    page,
  }) => {
    await page.goto('/medications');
    await expect(page.getByRole('heading', { level: 1, name: 'Leki' })).toBeVisible();

    await page.keyboard.press('Tab');
    const skipLink = page.getByRole('link', { name: 'Przejdź do treści' });
    await expect(skipLink).toBeFocused();
    await expect(skipLink).toBeInViewport();

    await page.keyboard.press('Enter');
    await expect(page.locator('#main-content')).toBeFocused();
  });

  test('navigation links can be reached and used without a mouse', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1, name: 'Pulpit' })).toBeVisible();

    await page.keyboard.press('Tab'); // skip link
    await page.keyboard.press('Tab'); // Pulpit
    await page.keyboard.press('Tab'); // Leki
    await expect(page.getByRole('link', { name: 'Leki', exact: true })).toBeFocused();
    await page.keyboard.press('Enter');

    await expect(page).toHaveURL(/\/medications$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Leki' })).toBeVisible();
  });

  test('focus is clearly visible on links and buttons', async ({ page }) => {
    await page.goto('/dev/components');
    await expect(
      page.getByRole('heading', { level: 1, name: 'Podgląd komponentów' }),
    ).toBeVisible();

    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    const link = page.getByRole('link', { name: 'Pulpit', exact: true });
    await expect(link).toBeFocused();
    const linkOutline = await link.evaluate((element) => {
      const style = getComputedStyle(element);
      return { style: style.outlineStyle, width: style.outlineWidth };
    });
    expect(linkOutline).toEqual({ style: 'solid', width: '2px' });

    const button = page.getByRole('button', { name: 'Główna akcja' });
    await button.focus();
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Tab');
    await expect(button).toBeFocused();
    const buttonOutline = await button.evaluate((element) => {
      const style = getComputedStyle(element);
      return { style: style.outlineStyle, width: style.outlineWidth };
    });
    expect(buttonOutline).toEqual({ style: 'solid', width: '2px' });
  });

  test('the tab title follows the page', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle('Pigoowa');

    await page.getByRole('link', { name: 'Wizyty', exact: true }).click();
    await expect(page).toHaveTitle('Wizyty – Pigoowa');
  });
});

test('an unknown address shows a helpful page with a working way back', async ({ page }) => {
  await page.goto('/cos/czego/nie-ma');

  await expect(
    page.getByRole('heading', { level: 1, name: 'Nie znaleziono strony' }),
  ).toBeVisible();
  await page.getByRole('link', { name: 'Wróć do pulpitu' }).click();

  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Pulpit' })).toBeVisible();
});
