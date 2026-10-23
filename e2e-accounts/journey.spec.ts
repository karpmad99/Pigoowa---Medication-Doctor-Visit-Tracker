import { expect, test, type Page } from '@playwright/test';
import {
  addMedication,
  dateInDays,
  demonstrationKeys,
  newCredentials,
  signInThroughTheForm,
  signUpThroughTheForm,
} from './support';

// The main journey with AUTHENTICATION (ROADMAP Stage 11): sign up, add a medication, record a dose, add and
// change an appointment, sign out, sign in again and find everything where it was — against the real local
// Auth server and database. Every step checks what is shown; the ones about storage check that nothing of the
// account is kept in the demonstration's localStorage keys.

const region = (page: Page, name: string) => page.getByRole('region', { name });

test('the main journey with an account: nothing is lost by signing out and in', async ({
  page,
}) => {
  const credentials = newCredentials('journey');

  // 1. Sign up: the application opens on an empty dashboard that belongs to the account.
  await signUpThroughTheForm(page, credentials);
  await expect(region(page, 'Konto')).toContainText(credentials.email);
  await expect(region(page, 'Konto')).toContainText('Nie wpisuj prawdziwych danych');
  await expect(
    page.getByRole('region', { name: 'Informacja o wersji demonstracyjnej' }),
  ).toHaveCount(0);
  await expect(
    region(page, 'Dzisiejsze dawki').getByText('Nie dodano jeszcze żadnego leku'),
  ).toBeVisible();

  // 2. A medication with two doses a day and a stock; it is on the list after a reload (kept on the server).
  await addMedication(page, { name: 'Lek konta', times: ['08:00', '20:00'], stock: '10' });
  const card = page.getByRole('article', { name: 'Lek konta' });
  await expect(card).toContainText('08:00 — 1 tabletka');
  await expect(card).toContainText('20:00 — 1 tabletka');
  await expect(card).toContainText('Pozostało ok. 10 tabletek');
  await page.reload();
  await expect(page.getByRole('article', { name: 'Lek konta' })).toBeVisible();
  // Nothing of the account is in the demonstration's browser storage.
  expect(await demonstrationKeys(page)).toEqual([]);

  // 3. Record the morning dose: the counts and the stock follow, and it survives a reload.
  await page.getByRole('link', { name: 'Pulpit', exact: true }).click();
  const doses = region(page, 'Dzisiejsze dawki');
  await expect(
    doses.getByText('Przyjęte: 0. Pominięte: 0. Bez zapisu: 2. Razem dziś: 2.'),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Oznacz jako przyjętą: Lek konta, 08:00' }).click();
  await expect(doses.getByText('Zapisano jako przyjętą: Lek konta, 08:00.')).toBeVisible();
  await expect(
    doses.getByText('Przyjęte: 1. Pominięte: 0. Bez zapisu: 1. Razem dziś: 2.'),
  ).toBeVisible();
  await expect(
    region(page, 'Zapasy leków').getByText('Pozostało ok. 9 tabletek, wystarczy na ok. 4 dni.'),
  ).toBeVisible();
  await page.reload();
  await expect(
    region(page, 'Dzisiejsze dawki').getByText(
      'Przyjęte: 1. Pominięte: 0. Bez zapisu: 1. Razem dziś: 2.',
    ),
  ).toBeVisible();

  // 4. The history shows it, with the dose as it was recorded.
  await page.getByRole('link', { name: 'Dawki', exact: true }).click();
  await page.getByRole('link', { name: 'Historia przyjmowania' }).click();
  await expect(page.getByRole('heading', { name: 'Znaleziono 1 zapis' })).toBeVisible();
  await expect(page.getByText('Zapisana dawka: 1 tabletka')).toBeVisible();

  // 5. A refill goes into the stock ledger (a second table, with its own rules in the database).
  await page.getByRole('link', { name: 'Leki', exact: true }).click();
  await page
    .getByRole('link', { name: /Lek konta/ })
    .first()
    .click();
  await page
    .getByRole('button', { name: /Uzupełnij zapas/ })
    .first()
    .click();
  await page.getByRole('dialog').getByRole('textbox').first().fill('20');
  await page
    .getByRole('dialog')
    .getByRole('button', { name: /Zapisz|Uzupełnij/ })
    .last()
    .click();
  await expect(page.getByText(/Pozostało ok. 29 tabletek/).first()).toBeVisible();

  // 6. An appointment: added, changed, cancelled and restored.
  await page.goto('/appointments/new');
  await page.getByRole('textbox', { name: /^Lekarz/ }).fill('dr Kontowa');
  await page.getByLabel(/^Data wizyty/).fill(dateInDays(10));
  await page.getByLabel(/^Godzina wizyty/).fill('10:00');
  await page.getByRole('button', { name: 'Dodaj wizytę', exact: true }).click();
  await expect(page.getByText('Dodano wizytę: dr Kontowa.')).toBeVisible();
  await page.getByRole('link', { name: /^Edytuj wizytę: dr Kontowa/ }).click();
  await page.getByLabel(/^Godzina wizyty/).fill('11:30');
  await page.getByRole('textbox', { name: /^Miejsce/ }).fill('Gabinet 5');
  await page.getByRole('button', { name: 'Zapisz zmiany' }).click();
  await expect(page.getByText('Zapisano zmiany w wizycie: dr Kontowa.')).toBeVisible();
  await page.reload();
  await expect(page.getByRole('listitem').filter({ hasText: 'dr Kontowa' })).toContainText('11:30');
  await page.getByRole('button', { name: /^Oznacz jako odwołaną: dr Kontowa/ }).click();
  await expect(page.getByRole('tab', { name: 'Minione (1)' })).toBeVisible();
  await page.getByRole('tab', { name: 'Minione (1)' }).click();
  await page.getByRole('button', { name: /^Przywróć jako zaplanowaną: dr Kontowa/ }).click();
  await expect(page.getByRole('tab', { name: 'Nadchodzące (1)' })).toBeVisible();

  // 7. Sign out: the account's pages are gone, and a deep link leads to the sign-in page, not to data.
  await page.getByRole('button', { name: 'Wyloguj się' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Logowanie' })).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0); // signing out is not an "expired session"
  await page.goto('/medications');
  await expect(page.getByRole('heading', { level: 1, name: 'Logowanie' })).toBeVisible();
  await expect(page.getByText('Lek konta')).toHaveCount(0);

  // 8. Sign in again: the address asked for is opened, and everything is where it was left.
  await signInThroughTheForm(page, credentials);
  await expect(page.getByRole('heading', { level: 1, name: 'Leki' })).toBeVisible();
  await expect(page.getByRole('article', { name: 'Lek konta' })).toBeVisible();
  await page.getByRole('link', { name: 'Pulpit', exact: true }).click();
  await expect(
    region(page, 'Dzisiejsze dawki').getByText(
      'Przyjęte: 1. Pominięte: 0. Bez zapisu: 1. Razem dziś: 2.',
    ),
  ).toBeVisible();
  await page.getByRole('link', { name: 'Wizyty', exact: true }).click();
  await expect(page.getByRole('listitem').filter({ hasText: 'dr Kontowa' })).toContainText('11:30');
  expect(await demonstrationKeys(page)).toEqual([]);
});
