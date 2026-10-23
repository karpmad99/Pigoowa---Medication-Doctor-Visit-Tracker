import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { expect, type Page } from '@playwright/test';

export interface Credentials {
  email: string;
  password: string;
}

export function newCredentials(label: string): Credentials {
  return {
    email: `e2e-${label}-${randomUUID()}@example.com`,
    password: `${randomUUID()}-Aa1`,
  };
}

export async function signUpThroughTheForm(page: Page, credentials: Credentials): Promise<void> {
  await page.goto('/register');
  await page.getByLabel(/^Adres e-mail/).fill(credentials.email);
  await page.getByLabel(/^Hasło/).fill(credentials.password);
  await page.getByLabel(/^Powtórz hasło/).fill(credentials.password);
  await page.getByRole('button', { name: 'Załóż konto' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Pulpit' })).toBeVisible();
}

export async function signInThroughTheForm(page: Page, credentials: Credentials): Promise<void> {
  await page.getByLabel(/^Adres e-mail/).fill(credentials.email);
  await page.getByLabel(/^Hasło/).fill(credentials.password);
  await page.getByRole('button', { name: 'Zaloguj się' }).click();
}

/** A client the test itself uses to act as the same user from "another device". Public key only. */
export function otherDeviceClient() {
  const url = process.env.VITE_SUPABASE_URL;
  const key = process.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error('the public Supabase variables are missing');
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

export async function addMedication(
  page: Page,
  options: { name: string; times?: [string, string?]; stock?: string },
): Promise<void> {
  await page.goto('/medications/new');
  await expect(page.getByRole('heading', { level: 1, name: 'Dodaj lek' })).toBeVisible();
  await page.getByRole('textbox', { name: /^Nazwa leku/ }).fill(options.name);
  await page.getByRole('textbox', { name: /^Jednostka dawki/ }).fill('tabletka');
  const [first, second] = options.times ?? ['08:00'];
  await page.getByLabel(/^Godzina 1/).fill(first);
  await page.getByRole('textbox', { name: /^Dawka 1/ }).fill('1');
  if (second !== undefined) {
    await page.getByRole('button', { name: 'Dodaj godzinę' }).click();
    await page.getByLabel(/^Godzina 2/).fill(second);
    await page.getByRole('textbox', { name: /^Dawka 2/ }).fill('1');
  }
  if (options.stock !== undefined) {
    await page.getByRole('textbox', { name: /^Aktualny zapas/ }).fill(options.stock);
  }
  await page.getByRole('button', { name: 'Dodaj lek', exact: true }).click();
  await expect(page.getByText(`Dodano lek „${options.name}”.`)).toBeVisible();
}

/** The keys of this browser's localStorage that belong to the demonstration. */
export async function demonstrationKeys(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    Object.keys(window.localStorage).filter((key) => key.startsWith('pigoowa:')),
  );
}

/** YYYY-MM-DD, `days` from today in Warsaw. */
export function dateInDays(days: number): string {
  const moved = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Warsaw' }).format(moved);
}
