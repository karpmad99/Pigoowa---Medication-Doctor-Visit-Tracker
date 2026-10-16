import { afterEach, describe, expect, it, vi } from 'vitest';
import { RepositoryError } from '../errors';
import { createLocalRepositories } from './localRepositories';
import { createBrowserStorage } from './storage';

// The only tests that touch the real browser storage: they check the thin adapter itself.
// Everything else in the suite uses the controllable fake.

afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
});

describe('createBrowserStorage', () => {
  it('reads, writes and removes values in localStorage', () => {
    const storage = createBrowserStorage();

    expect(storage.getItem('pigoowa:test')).toBeNull();
    storage.setItem('pigoowa:test', 'value');
    expect(window.localStorage.getItem('pigoowa:test')).toBe('value');
    expect(storage.getItem('pigoowa:test')).toBe('value');
    storage.removeItem('pigoowa:test');
    expect(storage.getItem('pigoowa:test')).toBeNull();
  });

  it('looks localStorage up on every call, so a blocked storage fails inside the operation', async () => {
    const storage = createBrowserStorage(); // creating it must not touch localStorage
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('Access is denied for this document.', 'SecurityError');
    });

    expect(() => storage.getItem('anything')).toThrow(DOMException);
    const error = await createLocalRepositories(storage)
      .medications.list()
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(RepositoryError);
    expect((error as RepositoryError).code).toBe('storage-unavailable');
  });
});
