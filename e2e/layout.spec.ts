import { expect, test, type Page } from '@playwright/test';

const pages = [
  '/',
  '/medications',
  '/appointments',
  '/dev/components',
  '/dev/data',
  '/nie-ma-takiej-strony',
];

async function hasHorizontalScroll(page: Page): Promise<boolean> {
  return page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
}

async function boxOf(page: Page, role: 'navigation' | 'main' | 'contentinfo' | 'banner') {
  const box = await page.getByRole(role).boundingBox();
  if (!box) throw new Error(`The ${role} landmark has no box (is it hidden?)`);
  return box;
}

for (const [name, viewport] of [
  ['small phone (360 px)', { width: 360, height: 740 }],
  ['phone (390 px)', { width: 390, height: 844 }],
  ['tablet (768 px)', { width: 768, height: 1024 }],
  ['desktop (1280 px)', { width: 1280, height: 800 }],
] as const) {
  test.describe(`no horizontal scrolling on ${name}`, () => {
    test.use({ viewport });

    for (const path of pages) {
      test(path, async ({ page }) => {
        await page.goto(path);
        await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

        expect(await hasHorizontalScroll(page)).toBe(false);
      });
    }
  });
}

test.describe('phone layout: navigation along the bottom edge', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('the navigation is a bar fixed to the bottom with large touch targets', async ({ page }) => {
    await page.goto('/medications');

    const nav = await boxOf(page, 'navigation');
    expect(nav.x).toBe(0);
    expect(nav.width).toBe(390);
    expect(nav.y + nav.height).toBeCloseTo(844, 0);

    for (const name of ['Pulpit', 'Leki', 'Wizyty']) {
      const link = await page.getByRole('link', { name, exact: true }).boundingBox();
      expect(link?.height).toBeGreaterThanOrEqual(44);
      expect(link?.width).toBeGreaterThanOrEqual(44);
    }
  });

  test('the bar stays in place while the page scrolls, and does not cover the end of the page', async ({
    page,
  }) => {
    await page.goto('/dev/components');
    await expect(
      page.getByRole('heading', { level: 1, name: 'Podgląd komponentów' }),
    ).toBeVisible();
    await page.evaluate(() => {
      window.scrollTo(0, document.documentElement.scrollHeight);
    });

    const nav = await boxOf(page, 'navigation');
    // The footer reserves space under its text for the bar, so measure the text, not the footer box.
    const note = await page.getByRole('contentinfo').locator('p').boundingBox();
    expect(nav.y + nav.height).toBeCloseTo(844, 0);
    expect(note).not.toBeNull();
    expect((note?.y ?? 0) + (note?.height ?? 0)).toBeLessThanOrEqual(nav.y);
    await expect(page.getByRole('contentinfo').locator('p')).toBeInViewport();
  });

  test('a short page neither scrolls needlessly nor hides its footer behind the bar', async ({
    page,
  }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1, name: 'Pulpit' })).toBeVisible();

    const scrolls = await page.evaluate(
      () => document.documentElement.scrollHeight > document.documentElement.clientHeight,
    );
    const nav = await boxOf(page, 'navigation');
    const note = await page.getByRole('contentinfo').locator('p').boundingBox();
    expect(scrolls).toBe(false);
    expect((note?.y ?? 0) + (note?.height ?? 0)).toBeLessThanOrEqual(nav.y);
  });

  test('the current page is marked, and the mark is not colour alone', async ({ page }) => {
    await page.goto('/appointments');

    const current = page.getByRole('link', { name: 'Wizyty', exact: true });
    await expect(current).toHaveAttribute('aria-current', 'page');
    const [currentWeight, otherWeight] = await Promise.all([
      current.evaluate((element) => getComputedStyle(element).fontWeight),
      page
        .getByRole('link', { name: 'Leki', exact: true })
        .evaluate((element) => getComputedStyle(element).fontWeight),
    ]);
    expect(Number(currentWeight)).toBeGreaterThan(Number(otherWeight));
  });
});

test.describe('desktop layout: sidebar', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test('the navigation is a vertical list in a sidebar next to the content', async ({ page }) => {
    await page.goto('/');

    const nav = await boxOf(page, 'navigation');
    const main = await boxOf(page, 'main');
    expect(nav.x).toBe(0);
    expect(nav.width).toBeLessThanOrEqual(256);
    expect(nav.y).toBeLessThan(400);
    expect(main.x).toBeGreaterThanOrEqual(nav.x + nav.width);

    const tops = await Promise.all(
      ['Pulpit', 'Leki', 'Wizyty'].map(async (name) => {
        const box = await page.getByRole('link', { name, exact: true }).boundingBox();
        return box?.y ?? -1;
      }),
    );
    expect(tops[0]).toBeLessThan(tops[1] ?? 0);
    expect(tops[1]).toBeLessThan(tops[2] ?? 0);
  });

  test('the content column does not grow unreadably wide', async ({ page }) => {
    await page.goto('/');

    expect((await boxOf(page, 'main')).width).toBeLessThanOrEqual(900);
  });
});

test.describe('breakpoint between phone and sidebar layouts', () => {
  test('767 px still uses the bottom bar, 768 px switches to the sidebar', async ({ page }) => {
    await page.setViewportSize({ width: 767, height: 900 });
    await page.goto('/');
    const phoneNav = await boxOf(page, 'navigation');
    expect(phoneNav.y + phoneNav.height).toBeCloseTo(900, 0);

    await page.setViewportSize({ width: 768, height: 900 });
    const sidebarNav = await boxOf(page, 'navigation');
    expect(sidebarNav.x).toBe(0);
    expect(sidebarNav.y).toBeLessThan(450);
  });
});
