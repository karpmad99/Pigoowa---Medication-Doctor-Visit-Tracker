import { expect, test } from '@playwright/test';

test('opens the dashboard and navigates between the main sections', async ({ page }) => {
  await page.goto('/');

  await expect(page).toHaveTitle('Pigoowa');
  await expect(page.getByRole('heading', { level: 1, name: 'Pulpit' })).toBeVisible();

  await page.getByRole('link', { name: 'Leki' }).click();
  await expect(page).toHaveURL(/\/medications$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Leki' })).toBeVisible();

  await page.getByRole('link', { name: 'Wizyty' }).click();
  await expect(page).toHaveURL(/\/appointments$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Wizyty' })).toBeVisible();
});

test('a section can be opened directly by its address', async ({ page }) => {
  await page.goto('/medications');

  await expect(page.getByRole('heading', { level: 1, name: 'Leki' })).toBeVisible();
});
