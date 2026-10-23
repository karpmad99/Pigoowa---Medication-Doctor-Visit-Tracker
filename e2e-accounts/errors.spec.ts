import { expect, test } from '@playwright/test';
import {
  newCredentials,
  otherDeviceClient,
  signInThroughTheForm,
  signUpThroughTheForm,
} from './support';

// ROADMAP Stage 11, "Auth error states handled (wrong password, expired session, network failure)", in the
// browser, against the real local Auth server. The only simulated thing is the network failure itself (the
// browser is told to abort the request, as offline would); the wrong password, the revoked session and the
// refusal of an anonymous request are answers of the real servers.

test('a signed-out visitor is sent to the sign-in page, whatever the address, and sees no data', async ({
  page,
}) => {
  for (const path of ['/', '/medications', '/medications/new', '/appointments', '/doses/history']) {
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1, name: 'Logowanie' })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Główna nawigacja' })).toHaveCount(0);
  }
});

test('a wrong password is refused in words that do not say whether the e-mail exists', async ({
  page,
}) => {
  const credentials = newCredentials('wrong');
  await signUpThroughTheForm(page, credentials);
  await page.getByRole('button', { name: 'Wyloguj się' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Logowanie' })).toBeVisible();

  await signInThroughTheForm(page, { ...credentials, password: 'zupelnie-inne-haslo-1' });
  await expect(page.getByRole('alert')).toContainText('Nieprawidłowy adres e-mail lub hasło.');
  const sameAnswerForUnknownUser = page.getByRole('alert').textContent();

  await signInThroughTheForm(page, {
    email: 'nikt-taki@example.com',
    password: 'zupelnie-inne-haslo-1',
  });
  await expect(page.getByRole('alert')).toContainText('Nieprawidłowy adres e-mail lub hasło.');
  expect(await page.getByRole('alert').textContent()).toBe(await sameAnswerForUnknownUser);
  // Still signed out, the e-mail typed stays in the form.
  await expect(page.getByLabel(/^Adres e-mail/)).toHaveValue('nikt-taki@example.com');
  await expect(page.getByRole('navigation', { name: 'Główna nawigacja' })).toHaveCount(0);
});

test('a network failure on sign-in is reported as such, and the same form works once the network is back', async ({
  page,
}) => {
  const credentials = newCredentials('network');
  await signUpThroughTheForm(page, credentials);
  await page.getByRole('button', { name: 'Wyloguj się' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Logowanie' })).toBeVisible();

  await page.route('**/auth/v1/token**', (route) => route.abort('connectionfailed'));
  await signInThroughTheForm(page, credentials);
  await expect(page.getByRole('alert')).toContainText('Nie można połączyć się z serwerem');
  await expect(page.getByRole('heading', { level: 1, name: 'Logowanie' })).toBeVisible();

  await page.unroute('**/auth/v1/token**');
  await page.getByRole('button', { name: 'Zaloguj się' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Pulpit' })).toBeVisible();
});

test('a network failure while reading data is shown as an error with a retry, never as an empty list', async ({
  page,
}) => {
  await signUpThroughTheForm(page, newCredentials('offline'));

  await page.route('**/rest/v1/medications**', (route) => route.abort('connectionfailed'));
  await page.getByRole('link', { name: 'Leki', exact: true }).click();
  await expect(page.getByText('Nie udało się wczytać leków')).toBeVisible();
  await expect(page.getByText('Nie dodano jeszcze żadnego leku')).toHaveCount(0);

  await page.unroute('**/rest/v1/medications**');
  await page.getByRole('button', { name: 'Spróbuj ponownie' }).click();
  await expect(page.getByText('Nie dodano jeszcze żadnego leku')).toBeVisible();
});

test('when the account cannot be opened (the profile cannot be read), the data pages are not shown, with a retry', async ({
  page,
}) => {
  const credentials = newCredentials('profile');
  await signUpThroughTheForm(page, credentials);

  await page.route('**/rest/v1/profiles**', (route) => route.abort('connectionfailed'));
  await page.reload();
  await expect(page.getByText('Nie udało się otworzyć konta')).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Główna nawigacja' })).toHaveCount(0);

  await page.unroute('**/rest/v1/profiles**');
  await page.getByRole('button', { name: 'Spróbuj ponownie' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Pulpit' })).toBeVisible();
});

test('a network failure while saving keeps what was typed and says nothing was saved', async ({
  page,
}) => {
  await signUpThroughTheForm(page, newCredentials('save'));
  await page.goto('/medications/new');
  await page.getByRole('textbox', { name: /^Nazwa leku/ }).fill('Lek offline');
  await page.getByRole('textbox', { name: /^Jednostka dawki/ }).fill('tabletka');
  await page.getByLabel(/^Godzina 1/).fill('08:00');
  await page.getByRole('textbox', { name: /^Dawka 1/ }).fill('1');

  await page.route('**/rest/v1/medications**', (route) => route.abort('connectionfailed'));
  await page.getByRole('button', { name: 'Dodaj lek', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Zmiany nie zostały zapisane');
  await expect(page.getByRole('textbox', { name: /^Nazwa leku/ })).toHaveValue('Lek offline');

  await page.unroute('**/rest/v1/medications**');
  await page.getByRole('button', { name: 'Dodaj lek', exact: true }).click();
  await expect(page.getByText('Dodano lek „Lek offline”.')).toBeVisible();
  await expect(page.getByRole('article', { name: 'Lek offline' })).toHaveCount(1);
});

test('a session that the server ended (signed out everywhere) is reported as expired, not as an empty account', async ({
  page,
}) => {
  await page.clock.install();
  await page.clock.resume();
  const credentials = newCredentials('expired');
  await signUpThroughTheForm(page, credentials);

  // The same user signs out of ALL her sessions from another device: the server revokes every refresh token.
  const otherDevice = otherDeviceClient();
  const signedIn = await otherDevice.auth.signInWithPassword(credentials);
  expect(signedIn.error).toBeNull();
  const signedOutEverywhere = await otherDevice.auth.signOut({ scope: 'global' });
  expect(signedOutEverywhere.error).toBeNull();

  // An hour and five minutes later the browser's access token has run out and the automatic refresh fails.
  await page.clock.fastForward('01:05:00');

  await expect(page.getByRole('heading', { level: 1, name: 'Logowanie' })).toBeVisible();
  await expect(page.getByRole('alert')).toContainText('Sesja wygasła');
  await expect(page.getByRole('navigation', { name: 'Główna nawigacja' })).toHaveCount(0);
});

test('a request the server refuses because the session is not valid sends the user to sign in again', async ({
  page,
}) => {
  await signUpThroughTheForm(page, newCredentials('refused'));
  await page.getByRole('link', { name: 'Leki', exact: true }).click();
  await expect(page.getByText('Nie dodano jeszcze żadnego leku')).toBeVisible();

  // The answer of PostgREST to a token it does not accept (the real wording and status).
  await page.route('**/rest/v1/medications**', (route) =>
    route.fulfill({
      status: 401,
      contentType: 'application/json',
      body: JSON.stringify({ code: 'PGRST301', details: null, hint: null, message: 'JWT expired' }),
    }),
  );
  await page.reload();

  await expect(page.getByRole('heading', { level: 1, name: 'Logowanie' })).toBeVisible();
  await expect(page.getByRole('alert')).toContainText('Sesja wygasła');
});
