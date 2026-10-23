import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { newCredentials, signUpThroughTheForm } from './support';

// The new screens of Stage 11 — sign-in, sign-up, the account bar and the failure states — scanned by axe-core
// with the same rules as e2e/accessibility.spec.ts, at a phone width and a desktop width. Automated checks do
// not replace a manual review with a screen reader.

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'];
const WIDTHS = [
  { name: 'phone', width: 390, height: 844 },
  { name: 'desktop', width: 1280, height: 800 },
];

async function expectNoViolations(page: Page, what: string) {
  const { violations } = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  const report = violations.map(
    (violation) =>
      `${violation.impact ?? 'unknown'}: ${violation.id} (${violation.help}) on ` +
      violation.nodes.map((node) => node.target.join(' ')).join(' | '),
  );
  expect(report, `Accessibility violations on ${what}`).toEqual([]);
}

for (const { name, width, height } of WIDTHS) {
  test.describe(`at ${name} width (${String(width)} px)`, () => {
    test.use({ viewport: { width, height } });

    test('the sign-in page, empty, with validation errors and with a failed attempt', async ({
      page,
    }) => {
      await page.goto('/login');
      await expect(page.getByRole('heading', { level: 1, name: 'Logowanie' })).toBeVisible();
      await expectNoViolations(page, 'the sign-in page');

      await page.getByRole('button', { name: 'Zaloguj się' }).click();
      await expect(page.getByText('Wpisz adres e-mail.')).toBeVisible();
      await expectNoViolations(page, 'the sign-in page with validation errors');

      await page.getByLabel(/^Adres e-mail/).fill('nikt@example.com');
      await page.getByLabel(/^Hasło/).fill('zle-haslo-123');
      await page.getByRole('button', { name: 'Zaloguj się' }).click();
      await expect(page.getByRole('alert')).toContainText('Nieprawidłowy adres e-mail lub hasło.');
      await expectNoViolations(page, 'the sign-in page after a wrong password');
    });

    test('the sign-up page, empty and with validation errors', async ({ page }) => {
      await page.goto('/register');
      await expect(page.getByRole('heading', { level: 1, name: 'Załóż konto' })).toBeVisible();
      await expectNoViolations(page, 'the sign-up page');

      await page.getByRole('button', { name: 'Załóż konto' }).click();
      await expect(page.getByText('Wpisz adres e-mail.')).toBeVisible();
      await expectNoViolations(page, 'the sign-up page with validation errors');
    });

    test('the dashboard of a signed-in account, with the account bar', async ({ page }) => {
      await signUpThroughTheForm(page, newCredentials('a11y'));
      await expect(page.getByRole('region', { name: 'Konto' })).toBeVisible();
      await expectNoViolations(page, 'the dashboard with the account bar');
    });

    test('the demonstration inside the build with accounts, with its way back to sign-in', async ({
      page,
    }) => {
      await page.goto('/login');
      await page.getByRole('button', { name: 'Wypróbuj wersję demonstracyjną' }).click();
      await expect(page.getByRole('heading', { level: 1, name: 'Pulpit' })).toBeVisible();
      await expectNoViolations(page, 'the demonstration banner with the sign-in button');
    });
  });
}
