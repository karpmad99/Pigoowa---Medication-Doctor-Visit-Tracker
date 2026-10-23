import { expect, test, type Page } from '@playwright/test';
import { addMedication, dateInDays, newCredentials, signUpThroughTheForm } from './support';

// ROADMAP Stage 11, "Two real users see only their own data in the UI": two real accounts, in two separate
// browser contexts (separate storage, separate sessions), against the real local database. The database-level
// proof is in supabase/tests; this is what a person looking at the screens would see.

async function addAppointment(page: Page, doctor: string) {
  await page.goto('/appointments/new');
  await page.getByRole('textbox', { name: /^Lekarz/ }).fill(doctor);
  await page.getByLabel(/^Data wizyty/).fill(dateInDays(7));
  await page.getByLabel(/^Godzina wizyty/).fill('09:00');
  await page.getByRole('button', { name: 'Dodaj wizytę', exact: true }).click();
  await expect(page.getByText(`Dodano wizytę: ${doctor}.`)).toBeVisible();
}

async function medicationIdOf(page: Page, name: string): Promise<string> {
  await page.goto('/medications');
  const link = page
    .getByRole('article', { name })
    .getByRole('link', { name: /Szczegóły|Edytuj/ })
    .first();
  const href = await link.getAttribute('href');
  const id = /\/medications\/([0-9a-f-]{36})/.exec(href ?? '')?.[1];
  if (id === undefined) throw new Error(`no medication id in ${String(href)}`);
  return id;
}

test('two accounts, two browsers: each sees only its own medications, doses and appointments', async ({
  browser,
}) => {
  const alice = newCredentials('alice');
  const bob = newCredentials('bob');
  const aliceContext = await browser.newContext();
  const bobContext = await browser.newContext();
  const alicePage = await aliceContext.newPage();
  const bobPage = await bobContext.newPage();

  // Both sign up and add their own data.
  await signUpThroughTheForm(alicePage, alice);
  await addMedication(alicePage, { name: 'Lek Alicji', stock: '10' });
  await addAppointment(alicePage, 'dr Alicji');
  await signUpThroughTheForm(bobPage, bob);
  await addMedication(bobPage, { name: 'Lek Boba' });
  await addAppointment(bobPage, 'dr Boba');

  // Each sees her own, and nothing of the other's, on every page that lists data.
  for (const [page, own, other] of [
    [alicePage, 'Lek Alicji', 'Lek Boba'],
    [bobPage, 'Lek Boba', 'Lek Alicji'],
  ] as const) {
    await page.goto('/medications');
    await expect(page.getByRole('article', { name: own })).toBeVisible();
    await expect(page.getByRole('article')).toHaveCount(1);
    await expect(page.getByText(other)).toHaveCount(0);
    await page.goto('/');
    await expect(page.getByRole('region', { name: 'Dzisiejsze dawki' })).toContainText(own);
    await expect(page.getByText(other)).toHaveCount(0);
  }
  await alicePage.goto('/appointments');
  await expect(alicePage.getByRole('listitem').filter({ hasText: 'dr Alicji' })).toBeVisible();
  await expect(alicePage.getByText('dr Boba')).toHaveCount(0);
  await bobPage.goto('/appointments');
  await expect(bobPage.getByRole('listitem').filter({ hasText: 'dr Boba' })).toBeVisible();
  await expect(bobPage.getByText('dr Alicji')).toHaveCount(0);

  // Bob records a dose; Alice's counters do not move.
  await bobPage.goto('/');
  await bobPage.getByRole('button', { name: 'Oznacz jako przyjętą: Lek Boba, 08:00' }).click();
  await expect(bobPage.getByText('Zapisano jako przyjętą: Lek Boba, 08:00.')).toBeVisible();
  await alicePage.goto('/');
  await expect(
    alicePage
      .getByRole('region', { name: 'Dzisiejsze dawki' })
      .getByText('Przyjęte: 0. Pominięte: 0. Bez zapisu: 1. Razem dziś: 1.'),
  ).toBeVisible();

  // Knowing the address of Alice's medication does not help Bob: for him it does not exist.
  const aliceMedicationId = await medicationIdOf(alicePage, 'Lek Alicji');
  await bobPage.goto(`/medications/${aliceMedicationId}`);
  await expect(bobPage.getByText('Nie znaleziono leku')).toBeVisible();
  await bobPage.goto(`/medications/${aliceMedicationId}/edit`);
  await expect(bobPage.getByText('Nie znaleziono leku')).toBeVisible();
  await expect(bobPage.getByText('Lek Alicji')).toHaveCount(0);

  // And Alice's medication is still hers, unchanged.
  await alicePage.goto('/medications');
  await expect(alicePage.getByRole('article', { name: 'Lek Alicji' })).toContainText(
    'Pozostało ok. 10 tabletek',
  );

  // The same browser, one account after the other: nothing of the first is left on the screen for the second.
  await alicePage.getByRole('button', { name: 'Wyloguj się' }).click();
  await expect(alicePage.getByRole('heading', { level: 1, name: 'Logowanie' })).toBeVisible();
  await alicePage.getByLabel(/^Adres e-mail/).fill(bob.email);
  await alicePage.getByLabel(/^Hasło/).fill(bob.password);
  await alicePage.getByRole('button', { name: 'Zaloguj się' }).click();
  await expect(alicePage.getByRole('heading', { level: 1, name: 'Leki' })).toBeVisible();
  await expect(alicePage.getByRole('article', { name: 'Lek Boba' })).toBeVisible();
  await expect(alicePage.getByText('Lek Alicji')).toHaveCount(0);

  await aliceContext.close();
  await bobContext.close();
});
