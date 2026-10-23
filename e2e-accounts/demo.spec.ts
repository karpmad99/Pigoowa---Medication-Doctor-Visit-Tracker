import { expect, test } from '@playwright/test';
import {
  addMedication,
  demonstrationKeys,
  newCredentials,
  signInThroughTheForm,
  signUpThroughTheForm,
} from './support';

// ROADMAP Stage 11, "demo mode remains available": in the build with accounts the demonstration is one click
// away, keeps its fictional data in the browser, and never mixes with an account's data in either direction.

test('the demonstration works from the sign-in page and stays apart from the account', async ({
  page,
}) => {
  await page.goto('/login');
  await page.getByRole('button', { name: 'Wypróbuj wersję demonstracyjną' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Pulpit' })).toBeVisible();
  await expect(
    page.getByRole('region', { name: 'Informacja o wersji demonstracyjnej' }),
  ).toContainText('dane fikcyjne');
  await expect(page.getByRole('region', { name: 'Konto' })).toHaveCount(0);

  // A demonstration medication is kept in this browser, and is still there after a reload.
  await addMedication(page, { name: 'Lek demonstracyjny' });
  await page.reload();
  await expect(page.getByRole('article', { name: 'Lek demonstracyjny' })).toBeVisible();
  expect(await demonstrationKeys(page)).toContain('pigoowa:v1:medications');

  // Leaving the demonstration and creating an account: the account starts empty.
  await page.getByRole('button', { name: 'Wyjdź z wersji demonstracyjnej i zaloguj się' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Logowanie' })).toBeVisible();
  await page.getByRole('link', { name: 'Załóż konto' }).click();
  const credentials = newCredentials('demo');
  await page.getByLabel(/^Adres e-mail/).fill(credentials.email);
  await page.getByLabel(/^Hasło/).fill(credentials.password);
  await page.getByLabel(/^Powtórz hasło/).fill(credentials.password);
  await page.getByRole('button', { name: 'Załóż konto' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Pulpit' })).toBeVisible();
  await page.getByRole('link', { name: 'Leki', exact: true }).click();
  await expect(page.getByText('Nie dodano jeszcze żadnego leku')).toBeVisible();
  await expect(page.getByText('Lek demonstracyjny')).toHaveCount(0);

  // The demonstration's data was not touched, copied or removed by any of this.
  expect(await demonstrationKeys(page)).toContain('pigoowa:v1:medications');
  const stored = await page.evaluate(() => window.localStorage.getItem('pigoowa:v1:medications'));
  expect(stored).toContain('Lek demonstracyjny');

  // And the account's medication does not go into the demonstration's storage.
  await addMedication(page, { name: 'Lek konta' });
  const after = await page.evaluate(() => window.localStorage.getItem('pigoowa:v1:medications'));
  expect(after).not.toContain('Lek konta');
  await page.getByRole('button', { name: 'Wyloguj się' }).click();
  await signInThroughTheForm(page, credentials);
  await expect(page.getByRole('article', { name: 'Lek konta' })).toBeVisible();
  await expect(page.getByText('Lek demonstracyjny')).toHaveCount(0);
});

test('a new account never receives the sample data', async ({ page }) => {
  await signUpThroughTheForm(page, newCredentials('empty'));
  await page.goto('/medications');
  await expect(page.getByText('Nie dodano jeszcze żadnego leku')).toBeVisible();
  await page.goto('/appointments');
  await expect(page.getByText('Nie dodano jeszcze żadnej wizyty')).toBeVisible();
});

test('the sample-data page cannot fill an account (the page exists only in development builds)', async ({
  page,
}) => {
  await signUpThroughTheForm(page, newCredentials('sample'));
  await page.goto('/dev/data');
  await page.getByRole('button', { name: 'Wczytaj dane demonstracyjne' }).click();

  await expect(page.getByText(/dostępne tylko w trybie demo/)).toBeVisible();
  await page.goto('/medications');
  await expect(page.getByText('Nie dodano jeszcze żadnego leku')).toBeVisible();
});
