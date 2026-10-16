import { expect, test, type Page } from '@playwright/test';

// Generates the README images from the invented demo data. Nothing here is real: the data comes
// from src/services/demo/demoData.ts and the clock is fixed.

test.use({ timezoneId: 'Europe/Warsaw', locale: 'pl-PL' });

const OUTPUT = 'docs/screenshots';

async function loadDemoData(page: Page) {
  await page.clock.setFixedTime(new Date('2026-10-15T10:00:00Z'));
  await page.goto('/dev/data');
  await page.getByRole('button', { name: 'Wczytaj dane demonstracyjne' }).click();
  await expect(page.getByText('Wczytano dane demonstracyjne.')).toBeVisible();
}

const shots = [
  { file: 'dashboard-desktop', path: '/', heading: 'Pulpit', size: { width: 1280, height: 900 } },
  { file: 'dashboard-phone', path: '/', heading: 'Pulpit', size: { width: 390, height: 844 } },
  {
    file: 'medications',
    path: '/medications',
    heading: 'Leki',
    size: { width: 1280, height: 900 },
  },
  {
    file: 'appointments',
    path: '/appointments',
    heading: 'Wizyty',
    size: { width: 1280, height: 900 },
  },
];

for (const { file, path, heading, size } of shots) {
  test(`screenshot: ${file}`, async ({ page }) => {
    await page.setViewportSize(size);
    await loadDemoData(page);
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible();
    await expect(page.getByText('Ładowanie')).toHaveCount(0);
    await page.screenshot({ path: `${OUTPUT}/${file}.png` });
  });
}
