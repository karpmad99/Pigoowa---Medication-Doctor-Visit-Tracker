import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

// Automated accessibility scan (axe-core: WCAG 2.0/2.1 A and AA rules plus axe's best-practice
// rules for headings and landmarks) of every main screen, in
// the states a user meets: with data, empty, with validation errors, with a dialog open, and
// after a read failure. It runs in a real browser, so rules that need rendering (colour contrast,
// computed names, landmarks) are checked too. It does NOT replace the keyboard tests or a human
// judgement of clarity. The clock is fixed so the demo data and the screens do not depend on today.

const NOW = new Date('2026-10-15T10:00:00Z');
const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'];

test.use({ timezoneId: 'Europe/Warsaw', locale: 'pl-PL' });

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(NOW);
});

async function loadDemoData(page: Page) {
  await page.goto('/dev/data');
  await page.getByRole('button', { name: 'Wczytaj dane demonstracyjne' }).click();
  await expect(page.getByText('Wczytano dane demonstracyjne.')).toBeVisible();
}

/** Scans the current page and fails with a readable list of every violation found. */
async function expectNoViolations(page: Page, what: string) {
  const { violations } = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  const report = violations.map(
    (violation) =>
      `${violation.impact ?? 'unknown'}: ${violation.id} (${violation.help}) on ` +
      violation.nodes.map((node) => node.target.join(' ')).join(' | '),
  );
  expect(report, `Accessibility violations on ${what}`).toEqual([]);
}

test('the scan itself works: it reports problems that are injected into a page', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1, name: 'Pulpit' })).toBeVisible();
  await page.evaluate(() => {
    const broken = document.createElement('div');
    broken.innerHTML =
      '<img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=">' + // no alternative text
      '<button></button>' + // no accessible name
      '<p style="color:#ccc;background:#fff">Za mały kontrast</p>'; // contrast far below 4.5:1
    document.body.append(broken);
  });

  const { violations } = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();

  const ids = violations.map((violation) => violation.id);
  expect(ids).toEqual(expect.arrayContaining(['image-alt', 'button-name', 'color-contrast']));
});

const screens: { name: string; path: string; ready: (page: Page) => Promise<void> }[] = [
  {
    name: 'dashboard',
    path: '/',
    ready: (page) =>
      expect(
        page.getByRole('button', { name: /^Oznacz jako przyjętą: Demoxal, 08:00/ }),
      ).toBeVisible(),
  },
  {
    name: 'medications list',
    path: '/medications',
    ready: (page) => expect(page.getByRole('article', { name: 'Demoxal' })).toBeVisible(),
  },
  {
    name: 'add medication',
    path: '/medications/new',
    ready: (page) =>
      expect(page.getByRole('heading', { level: 1, name: 'Dodaj lek' })).toBeVisible(),
  },
  {
    name: 'day view',
    path: '/doses',
    ready: (page) =>
      expect(
        page.getByRole('button', { name: /^Oznacz jako przyjętą: Demoxal, 08:00/ }),
      ).toBeVisible(),
  },
  {
    name: 'history',
    path: '/doses/history',
    ready: (page) => expect(page.getByRole('heading', { name: /^Znaleziono/ })).toBeVisible(),
  },
  {
    name: 'appointments (upcoming)',
    path: '/appointments',
    ready: (page) => expect(page.getByRole('tab', { name: /^Nadchodzące/ })).toBeVisible(),
  },
  {
    name: 'appointments (past)',
    path: '/appointments?tab=past',
    ready: (page) => expect(page.getByRole('heading', { name: 'Minione wizyty' })).toBeVisible(),
  },
  {
    name: 'add appointment',
    path: '/appointments/new',
    ready: (page) =>
      expect(page.getByRole('heading', { level: 1, name: 'Dodaj wizytę' })).toBeVisible(),
  },
];

for (const [widthName, viewport] of [
  ['phone (390 px)', { width: 390, height: 844 }],
  ['desktop (1280 px)', { width: 1280, height: 800 }],
] as const) {
  test.describe(`axe scan at ${widthName}`, () => {
    test.use({ viewport });

    for (const screen of screens) {
      test(`${screen.name} with data`, async ({ page }) => {
        await loadDemoData(page);
        await page.goto(screen.path);
        await screen.ready(page);

        await expectNoViolations(page, screen.name);
      });
    }

    test('empty dashboard, medications and appointments (a new user)', async ({ page }) => {
      for (const path of ['/', '/medications', '/appointments', '/doses', '/doses/history']) {
        await page.goto(path);
        await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
        await expect(page.getByText(/^Wczytywanie/)).toHaveCount(0);
        await expectNoViolations(page, `${path} (empty)`);
      }
    });

    test('forms showing validation errors', async ({ page }) => {
      await page.goto('/medications/new');
      await page.getByRole('button', { name: 'Dodaj lek', exact: true }).click();
      await expect(page.getByText('Wpisz nazwę leku.')).toBeVisible();
      await expectNoViolations(page, 'medication form with errors');

      await page.goto('/appointments/new');
      await page.getByRole('button', { name: 'Dodaj wizytę', exact: true }).click();
      await expect(page.getByText('Wybierz poprawną datę wizyty.')).toBeVisible();
      await expectNoViolations(page, 'appointment form with errors');
    });

    test('open dialogs', async ({ page }) => {
      await loadDemoData(page);

      await page.goto('/medications');
      await page.getByRole('button', { name: /^Usuń trwale… lek Demoxal/ }).click();
      await expect(page.getByRole('dialog')).toBeVisible();
      await expectNoViolations(page, 'delete medication dialog');

      await page.goto('/appointments');
      await page.getByRole('button', { name: /^Usuń trwale…: Okulista/ }).click();
      await expect(page.getByRole('dialog')).toBeVisible();
      await expectNoViolations(page, 'delete appointment dialog');

      await page.goto('/doses/history');
      await page.getByRole('button', { name: /^Usuń zapis…: Demoxal/ }).click();
      await expect(page.getByRole('dialog')).toBeVisible();
      await expectNoViolations(page, 'delete record dialog');
    });

    test('read failures and status messages', async ({ page }) => {
      await loadDemoData(page);
      await page.evaluate(() => {
        window.localStorage.setItem('pigoowa:v1:appointments', '{broken');
      });
      await page.goto('/');
      await expect(page.getByRole('alert').first()).toBeVisible();
      await expectNoViolations(page, 'dashboard with a failing panel');

      await page.goto('/doses');
      await page.getByRole('button', { name: /^Oznacz jako przyjętą: Demoxal, 08:00/ }).click();
      await expect(page.getByText('Zapisano jako przyjętą: Demoxal, 08:00.')).toBeVisible();
      await expectNoViolations(page, 'day view with a success message');
    });
  });
}

// Touch targets: every control a finger has to hit is at least 44 px tall at phone widths. axe's own
// target-size rule is only 24 px (WCAG 2.2), so this is checked separately. Inline links inside a
// sentence are exempt (they cannot be larger without breaking the text), and so is the skip link,
// which is off-screen until it gets focus.
async function undersizedControls(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const controls = document.querySelectorAll<HTMLElement>(
      'a[href], button, input:not([type="hidden"]), select, textarea, summary, [role="tab"]',
    );
    const problems: string[] = [];
    for (const control of controls) {
      const style = getComputedStyle(control);
      const box = control.getBoundingClientRect();
      const hidden = box.width === 0 || box.height === 0 || style.visibility === 'hidden';
      const inlineLink = control.tagName === 'A' && style.display === 'inline';
      const skipLink = control.getAttribute('href') === '#main-content';
      if (hidden || inlineLink || skipLink) continue;
      if (box.height < 44) {
        const name = control.getAttribute('aria-label') ?? control.textContent.trim().slice(0, 30);
        problems.push(
          `${control.tagName.toLowerCase()} "${name}" is ${String(Math.round(box.height))} px tall`,
        );
      }
    }
    return problems;
  });
}

for (const [widthName, viewport] of [
  ['small phone (360 px)', { width: 360, height: 740 }],
  ['phone (390 px)', { width: 390, height: 844 }],
] as const) {
  test.describe(`touch targets at ${widthName}`, () => {
    test.use({ viewport });

    test('every control on every main screen is at least 44 px tall', async ({ page }) => {
      await loadDemoData(page);
      for (const path of [
        '/',
        '/medications',
        '/medications/new',
        '/medications/demo-medication-demoxal/edit',
        '/doses',
        '/doses/history',
        '/appointments',
        '/appointments?tab=past',
        '/appointments/new',
      ]) {
        await page.goto(path);
        await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
        await expect(page.getByText(/^Wczytywanie/)).toHaveCount(0);
        expect(await undersizedControls(page), `Small controls on ${path}`).toEqual([]);
      }
    });

    test('also with a status message showing and a note about appointments to confirm', async ({
      page,
    }) => {
      await loadDemoData(page);
      await page.goto('/');
      await page.getByRole('button', { name: /^Oznacz jako przyjętą: Demoxal, 08:00/ }).click();
      await expect(page.getByText('Zapisano jako przyjętą: Demoxal, 08:00.')).toBeVisible();
      await expect(page.getByText(/Do potwierdzenia: 1 wizyta/)).toBeVisible();

      expect(await undersizedControls(page), 'Small controls on the dashboard').toEqual([]);
    });
  });
}
