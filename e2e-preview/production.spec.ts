import { expect, test, type Page } from '@playwright/test';

// The production build, served as a static site. These are the things the dev-server tests cannot
// show: a deep link and a reload work, the development pages are gone, nothing is fetched from
// another host, and the demo notice is there.

test.use({ timezoneId: 'Europe/Warsaw', locale: 'pl-PL' });

const ORIGIN = 'http://localhost:4173';

function watchProblems(page: Page) {
  const problems: string[] = [];
  page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error' || message.type() === 'warning') {
      problems.push(`console ${message.type()}: ${message.text()}`);
    }
  });
  page.on('request', (request) => {
    if (!request.url().startsWith(ORIGIN) && !request.url().startsWith('data:')) {
      problems.push(`request to another host: ${request.url()}`);
    }
  });
  return problems;
}

const entries: { path: string; heading: string }[] = [
  { path: '/', heading: 'Pulpit' },
  { path: '/doses', heading: 'Dawki' },
  { path: '/doses/history', heading: 'Historia przyjmowania' },
  { path: '/medications', heading: 'Leki' },
  { path: '/medications/new', heading: 'Dodaj lek' },
  { path: '/appointments', heading: 'Wizyty' },
  { path: '/appointments/new', heading: 'Dodaj wizytę' },
];

for (const { path, heading } of entries) {
  test(`opening ${path} directly shows "${heading}", and a reload keeps it`, async ({ page }) => {
    const problems = watchProblems(page);

    const response = await page.goto(path);
    expect(response?.status()).toBe(200);
    await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible();
    await expect(
      page.getByRole('region', { name: 'Informacja o wersji demonstracyjnej' }),
    ).toContainText('dane fikcyjne');

    await page.reload();
    await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible();
    expect(problems).toEqual([]);
  });
}

test('an unknown address shows the not-found page inside the app', async ({ page }) => {
  await page.goto('/nie-ma-takiej-strony');

  await expect(
    page.getByRole('heading', { level: 1, name: /Nie znaleziono strony/ }),
  ).toBeVisible();
  await expect(page.getByRole('link', { name: 'Pulpit', exact: true }).first()).toBeVisible();
});

test('the development pages are not in the production build', async ({ page }) => {
  for (const path of ['/dev/data', '/dev/components']) {
    await page.goto(path);
    await expect(
      page.getByRole('heading', { level: 1, name: /Nie znaleziono strony/ }),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Wczytaj dane demonstracyjne' })).toHaveCount(0);
  }
});

test('the demo starts empty: no sample data is shipped or loaded', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByRole('heading', { level: 1, name: 'Pulpit' })).toBeVisible();
  expect(await page.evaluate(() => window.localStorage.length)).toBe(0);
});

test('a medication added in the production build is still there after a reload', async ({
  page,
}) => {
  const problems = watchProblems(page);
  await page.goto('/medications/new');
  await page.getByRole('textbox', { name: /^Nazwa leku/ }).fill('Lek przykładowy');
  await page.getByRole('textbox', { name: /^Jednostka dawki/ }).fill('tabletka');
  await page.getByLabel(/^Godzina 1/).fill('08:00');
  await page.getByRole('textbox', { name: /^Dawka 1/ }).fill('1');
  await page.getByRole('button', { name: 'Dodaj lek', exact: true }).click();
  await expect(page.getByText('Dodano lek „Lek przykładowy”.')).toBeVisible();

  await page.reload();
  await expect(page.getByRole('article', { name: 'Lek przykładowy' })).toBeVisible();
  expect(problems).toEqual([]);
});
