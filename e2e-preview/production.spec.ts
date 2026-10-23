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

// ROADMAP Stage 11: the build with accounts differs from the demonstration only by two PUBLIC variables, and no
// secret may ever be in what visitors download. The scripts are fetched exactly as a browser would get them.

test('the demonstration build never loads the account code', async ({ page }) => {
  const requested: string[] = [];
  page.on('request', (request) => requested.push(request.url()));

  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1, name: 'Pulpit' })).toBeVisible();
  await page.getByRole('link', { name: 'Leki', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Leki' })).toBeVisible();

  expect(requested.filter((url) => url.includes('accountMain'))).toEqual([]);
  expect(requested.filter((url) => !url.startsWith(ORIGIN) && !url.startsWith('data:'))).toEqual(
    [],
  );
  // No sign-in page, no account bar: it is the demonstration.
  await page.goto('/login');
  await expect(
    page.getByRole('heading', { level: 1, name: 'Nie znaleziono strony' }),
  ).toBeVisible();
});

test('no key, token or secret is in any script of the build, including the account chunk', async ({
  request,
}) => {
  const html = await (await request.get('/')).text();
  const entry = /src="(\/assets\/[^"]+\.js)"/.exec(html)?.[1];
  expect(entry).toBeDefined();
  const entryText = await (await request.get(entry ?? '')).text();
  const chunkPaths = [...entryText.matchAll(/(?:assets\/|\.\/)([A-Za-z0-9_-]+\.js)/g)].map(
    (match) => `/assets/${match[1] ?? ''}`,
  );
  const accountChunk = chunkPaths.find((path) => path.includes('accountMain'));
  expect(accountChunk, 'the account chunk exists and is referenced from the entry').toBeDefined();

  const scripts = [entry ?? '', ...new Set(chunkPaths)];
  for (const path of scripts) {
    const text = path === entry ? entryText : await (await request.get(path)).text();
    // A real key is a JWT (three base64url parts) or a long token after one of the key prefixes. The words
    // "service_role" and the prefix "sb_secret_" appear only in code that REFUSES such a key, so what is
    // searched for is a value, not a word.
    expect(text, path).not.toMatch(/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/);
    expect(text, path).not.toMatch(/sb_(secret|publishable)_[A-Za-z0-9_-]{10,}/);
    expect(text, path).not.toMatch(/service_role/);
    expect(text, path).not.toMatch(/postgres(ql)?:\/\/\w+:\w+@/);
    // No project address is baked in (the library itself names supabase.co hosts in its own code).
    expect(text, path).not.toMatch(/:54321/);
  }
});
