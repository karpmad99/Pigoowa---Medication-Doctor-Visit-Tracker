import { createClient } from '@supabase/supabase-js';
import { beforeAll, describe, expect, it } from 'vitest';
import { authFailureCodeOf } from '@/features/auth/authErrors';
import { createSupabaseProfileApi } from '@/features/auth/profile';
import { createSupabaseAuthApi } from '@/features/auth/supabaseAuthApi';
import type { AuthEvent, AuthUser } from '@/features/auth/types';
import { createSupabaseRepositories } from '@/services/supabase/supabaseRepositories';
import { newClient, newCredentials, requireStack, url, anonKey } from './helpers';

// ROADMAP Stage 11, "Auth error states handled (wrong password, expired session, network failure)", against
// the REAL local Auth server (GoTrue) and PostgREST: the codes the application maps are the ones the servers
// really send. Nothing is mocked; an unreachable server is a real closed port.

requireStack();

/** A server that cannot be reached: nothing listens on port 1. */
const UNREACHABLE = { supabaseUrl: 'http://127.0.0.1:1', supabaseAnonKey: anonKey };

describe('the authentication service (real Auth server)', () => {
  const credentials = newCredentials('auth');
  let signedUpUser: AuthUser;

  beforeAll(async () => {
    const api = createSupabaseAuthApi(newClient());
    const result = await api.signUp(credentials.email, credentials.password);
    if (!result.ok || result.value.user === null) {
      throw new Error(`sign up failed: ${JSON.stringify(result)}`);
    }
    signedUpUser = result.value.user;
  });

  it('signs up and reports the new user with a session (the local server needs no e-mail confirmation)', () => {
    expect(signedUpUser.email).toBe(credentials.email);
    expect(signedUpUser.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('signs in with the right password and reports the same user', async () => {
    const api = createSupabaseAuthApi(newClient());

    const result = await api.signIn(credentials.email, credentials.password);

    expect(result).toEqual({ ok: true, value: { user: signedUpUser } });
    expect(await api.getSession()).toEqual({ ok: true, value: { user: signedUpUser } });
  });

  it('refuses a wrong password with "invalid credentials"', async () => {
    const api = createSupabaseAuthApi(newClient());

    const result = await api.signIn(credentials.email, 'zupelnie-inne-haslo-123');

    expect(result).toEqual({ ok: false, code: 'invalid-credentials' });
    expect(await api.getSession()).toEqual({ ok: true, value: { user: null } });
  });

  it('answers a user who does not exist exactly like a wrong password', async () => {
    const api = createSupabaseAuthApi(newClient());

    const unknownUser = await api.signIn(newCredentials('nobody').email, 'jakies-haslo-123');
    const wrongPassword = await api.signIn(credentials.email, 'jakies-haslo-123');

    expect(unknownUser).toEqual(wrongPassword);
  });

  it('refuses a second account with the same e-mail address', async () => {
    const api = createSupabaseAuthApi(newClient());

    const result = await api.signUp(credentials.email, credentials.password);

    // With confirmations off the server says so; with them on it must not give the address away.
    expect(result.ok ? result.value.user : result.code).toSatisfy(
      (value: unknown) => value === 'email-taken' || value === null,
    );
  });

  it('refuses a password the server finds too short', async () => {
    const api = createSupabaseAuthApi(newClient());

    const result = await api.signUp(newCredentials('weak').email, 'abc');

    expect(result).toEqual({ ok: false, code: 'weak-password' });
  });

  it('refuses an address that is not one', async () => {
    const api = createSupabaseAuthApi(newClient());

    const result = await api.signUp('to-nie-jest-adres', 'dlugie-haslo-12345');

    expect(result.ok).toBe(false);
    expect(!result.ok && ['invalid-email', 'unknown']).toContain(!result.ok && result.code);
  });

  it('signs out, and the session is gone afterwards', async () => {
    const api = createSupabaseAuthApi(newClient());
    await api.signIn(credentials.email, credentials.password);

    expect(await api.signOut()).toEqual({ ok: true, value: undefined });
    expect(await api.getSession()).toEqual({ ok: true, value: { user: null } });
  });

  it('announces a sign-in and a sign-out to a listener', async () => {
    const api = createSupabaseAuthApi(newClient());
    const events: AuthEvent[] = [];
    const stop = api.onChange((event) => events.push(event));

    await api.signIn(credentials.email, credentials.password);
    await api.signOut();
    stop();

    expect(events).toContain('signed-in');
    expect(events).toContain('signed-out');
    expect(events.indexOf('signed-in')).toBeLessThan(events.lastIndexOf('signed-out'));
  });

  it('reports a server that cannot be reached as a network failure, for sign-in and for sign-up', async () => {
    const api = createSupabaseAuthApi(
      createClient(UNREACHABLE.supabaseUrl, UNREACHABLE.supabaseAnonKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      }) as never,
    );

    expect(await api.signIn(credentials.email, credentials.password)).toEqual({
      ok: false,
      code: 'network-error',
    });
    expect(await api.signUp(newCredentials('net').email, 'dlugie-haslo-12345')).toEqual({
      ok: false,
      code: 'network-error',
    });
  });

  it('ends this browser’s session even if the server cannot be reached when signing out', async () => {
    // A session obtained from the real server, then the client is pointed at nothing.
    const real = newClient();
    const signedIn = await real.auth.signInWithPassword(credentials);
    if (!signedIn.data.session) throw new Error('no session');
    const offline = createClient(UNREACHABLE.supabaseUrl, UNREACHABLE.supabaseAnonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    await offline.auth.setSession({
      access_token: signedIn.data.session.access_token,
      refresh_token: signedIn.data.session.refresh_token,
    });
    const api = createSupabaseAuthApi(offline as never);

    expect(await api.signOut()).toEqual({ ok: true, value: undefined });
    expect(await api.getSession()).toEqual({ ok: true, value: { user: null } });
  });

  it('reports a session whose refresh token was revoked elsewhere as expired', async () => {
    const first = newClient();
    await first.auth.signInWithPassword(credentials);
    const second = newClient();
    await second.auth.signInWithPassword(credentials);

    // The user signs out everywhere (for instance from another device).
    await second.auth.signOut({ scope: 'global' });
    const refreshed = await first.auth.refreshSession();

    expect(refreshed.error).not.toBeNull();
    expect(authFailureCodeOf(refreshed.error)).toBe('session-expired');
  });
});

describe('the profile (real database, Row Level Security)', () => {
  it('creates the profile of a new account once, with the browser’s time zone, and reads it back after', async () => {
    const client = newClient();
    const auth = createSupabaseAuthApi(client);
    const credentials = newCredentials('profile');
    const signedUp = await auth.signUp(credentials.email, credentials.password);
    if (!signedUp.ok || signedUp.value.user === null) throw new Error('sign up failed');
    const profiles = createSupabaseProfileApi(client);

    const first = await profiles.ensureProfile(signedUp.value.user, 'America/New_York');
    const second = await profiles.ensureProfile(signedUp.value.user, 'Asia/Tokyo');

    expect(first).toEqual({ ok: true, value: { timeZone: 'America/New_York' } });
    // The existing row wins: opening the app from another zone does not rewrite the profile.
    expect(second).toEqual({ ok: true, value: { timeZone: 'America/New_York' } });
    const rows = await client.from('profiles').select('id, time_zone');
    expect(rows.data).toEqual([{ id: signedUp.value.user.id, time_zone: 'America/New_York' }]);
  });

  it('falls back to the default zone when the database does not know the browser’s', async () => {
    const client = newClient();
    const auth = createSupabaseAuthApi(client);
    const credentials = newCredentials('zone');
    const signedUp = await auth.signUp(credentials.email, credentials.password);
    if (!signedUp.ok || signedUp.value.user === null) throw new Error('sign up failed');

    const result = await createSupabaseProfileApi(client).ensureProfile(
      signedUp.value.user,
      'Not/AZone',
    );

    expect(result).toEqual({ ok: true, value: { timeZone: 'Europe/Warsaw' } });
  });

  it('survives two tabs opening the same new account at the same moment: one row, both succeed', async () => {
    const client = newClient();
    const auth = createSupabaseAuthApi(client);
    const credentials = newCredentials('race');
    const signedUp = await auth.signUp(credentials.email, credentials.password);
    if (!signedUp.ok || signedUp.value.user === null) throw new Error('sign up failed');
    const profiles = createSupabaseProfileApi(client);
    const user = signedUp.value.user;

    const results = await Promise.all([
      profiles.ensureProfile(user, 'Europe/Warsaw'),
      profiles.ensureProfile(user, 'Europe/Warsaw'),
      profiles.ensureProfile(user, 'Europe/Warsaw'),
    ]);

    expect(results.map((result) => result.ok)).toEqual([true, true, true]);
    const rows = await client.from('profiles').select('id');
    expect(rows.data).toHaveLength(1);
  });

  it('does not create a profile for someone who is not signed in', async () => {
    const result = await createSupabaseProfileApi(newClient()).ensureProfile(
      { id: '00000000-0000-4000-8000-000000000001', email: 'x@example.com' },
      'Europe/Warsaw',
    );

    expect(result.ok).toBe(false);
  });

  it('reports an unreachable server as a network failure', async () => {
    const offline = createClient(UNREACHABLE.supabaseUrl, UNREACHABLE.supabaseAnonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      db: { retry: false },
    });

    const result = await createSupabaseProfileApi(offline as never).ensureProfile(
      { id: '00000000-0000-4000-8000-000000000001', email: 'x@example.com' },
      'Europe/Warsaw',
    );

    expect(result).toEqual({ ok: false, code: 'network-error' });
  });
});

describe('the repositories without a session, with a bad token, and without a server', () => {
  it('refuse every operation of a signed-out client with "not signed in", and announce the lost session', async () => {
    let announced = 0;
    const repositories = createSupabaseRepositories(newClient(), {
      onSessionLost: () => {
        announced += 1;
      },
    });

    await expect(repositories.medications.list()).rejects.toMatchObject({ code: 'not-signed-in' });
    await expect(repositories.appointments.list()).rejects.toMatchObject({ code: 'not-signed-in' });
    await expect(repositories.stockEvents.list()).rejects.toMatchObject({ code: 'not-signed-in' });
    await expect(
      repositories.doseLogs.listByDateRange('2026-01-01' as never, '2026-12-31' as never),
    ).rejects.toMatchObject({ code: 'not-signed-in' });
    expect(announced).toBe(4);
  });

  it('refuse a token that is not valid', async () => {
    const client = newClient();
    const credentials = newCredentials('token');
    const auth = createSupabaseAuthApi(client);
    await auth.signUp(credentials.email, credentials.password);
    const session = (await client.auth.getSession()).data.session;
    if (!session) throw new Error('no session');

    // A token whose signature no longer matches (the last characters changed) must be refused by the API.
    const broken = createClient(url, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${session.access_token}tampered` } },
    });
    const response = await broken.from('medications').select('id');

    expect(response.error).not.toBeNull();
    expect(response.status).toBe(401);
    expect(response.data).toBeNull();
  });

  it('report an unreachable server as a network failure and do not announce a lost session', async () => {
    let announced = 0;
    const offline = createSupabaseRepositories(
      createClient(UNREACHABLE.supabaseUrl, UNREACHABLE.supabaseAnonKey, {
        auth: { persistSession: false, autoRefreshToken: false },
        db: { retry: false },
      }) as never,
      {
        onSessionLost: () => {
          announced += 1;
        },
      },
    );

    await expect(offline.medications.list()).rejects.toMatchObject({ code: 'network-error' });
    await expect(
      offline.appointments.create({
        id: '00000000-0000-4000-8000-000000000002',
        doctorName: 'dr Nowak',
        specialty: null,
        scheduledAt: '2026-11-01T08:00:00.000Z' as never,
        location: null,
        notes: null,
        status: 'scheduled',
        createdAt: '2026-10-01T08:00:00.000Z' as never,
        updatedAt: '2026-10-01T08:00:00.000Z' as never,
      }),
    ).rejects.toMatchObject({ code: 'network-error' });
    expect(announced).toBe(0);
  });
});
