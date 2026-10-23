import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPigoowaClient } from './client';
import { createSupabaseServices } from './createSupabaseServices';

// No server is involved: this checks only what the services refuse to do or never touch.
const client = createPigoowaClient(
  { supabaseUrl: 'http://127.0.0.1:1', supabaseAnonKey: 'not-a-real-key-for-tests' },
  { retryReads: false },
);

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the services of an account', () => {
  it('never fill or replace the account with demonstration data', async () => {
    const services = createSupabaseServices({
      client,
      timeZone: 'Europe/Warsaw',
      onSessionLost: () => undefined,
    });

    await expect(services.demoData.loadDemoData()).rejects.toMatchObject({
      code: 'demo-data-unavailable',
    });
    await expect(services.demoData.resetDemoData()).rejects.toMatchObject({
      code: 'demo-data-unavailable',
    });
  });

  it('have nothing to migrate in the browser storage', () => {
    const services = createSupabaseServices({
      client,
      timeZone: 'Europe/Warsaw',
      onSessionLost: () => undefined,
    });

    expect(services.storageMigration.run()).toEqual({ collections: [] });
    expect(services.storageMigration.current()).toEqual({ collections: [] });
  });

  it('use the time zone of the profile and a fresh id for every call', () => {
    const services = createSupabaseServices({
      client,
      timeZone: 'America/New_York',
      onSessionLost: () => undefined,
    });

    expect(services.timeZone).toBe('America/New_York');
    expect(services.createId()).not.toBe(services.createId());
  });

  it('do not read or write the browser storage of the demonstration', async () => {
    const getItem = vi.spyOn(Storage.prototype, 'getItem');
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    const removeItem = vi.spyOn(Storage.prototype, 'removeItem');

    const services = createSupabaseServices({
      client,
      timeZone: 'Europe/Warsaw',
      onSessionLost: () => undefined,
    });
    services.storageMigration.run();
    // Reading data goes to the (unreachable) server; whatever happens, the browser storage is not used for it.
    await services.repositories.medications.list().catch(() => undefined);

    const touchedPigoowaKeys = [
      ...getItem.mock.calls,
      ...setItem.mock.calls,
      ...removeItem.mock.calls,
    ].filter(([key]) => typeof key === 'string' && key.startsWith('pigoowa:'));
    expect(touchedPigoowaKeys).toEqual([]);
  });

  it('report an unreachable server as a network failure and announce nothing about the session', async () => {
    const lost = vi.fn();
    const services = createSupabaseServices({
      client,
      timeZone: 'Europe/Warsaw',
      onSessionLost: lost,
    });

    await expect(services.repositories.medications.list()).rejects.toMatchObject({
      code: 'network-error',
    });
    expect(lost).not.toHaveBeenCalled();
  });
});
