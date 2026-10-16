/**
 * The few things repositories need from browser storage. It is the same shape as the Web Storage
 * API, which is deliberate: the real `localStorage` fits, and tests pass a controllable fake
 * instead of relying on (or mocking) the global.
 *
 * Any method may throw: storage can be disabled, blocked by privacy settings, or full.
 */
export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/**
 * The browser's `localStorage`. It is looked up on every call, not once at start-up, because
 * merely touching `window.localStorage` can throw (e.g. cookies blocked); such a failure must
 * happen inside an operation where it can be reported, not while the app is starting.
 *
 * NOTE: localStorage is plain text readable by anything running on the page and by anyone with
 * access to the browser profile. It is acceptable for fictional demo data and development, not for
 * real health information.
 */
export function createBrowserStorage(): KeyValueStorage {
  return {
    getItem: (key) => window.localStorage.getItem(key),
    setItem: (key, value) => {
      window.localStorage.setItem(key, value);
    },
    removeItem: (key) => {
      window.localStorage.removeItem(key);
    },
  };
}
