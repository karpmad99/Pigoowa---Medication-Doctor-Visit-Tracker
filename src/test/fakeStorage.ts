import type { KeyValueStorage } from '@/services/local/storage';

export interface FakeStorage extends KeyValueStorage {
  /** What is stored right now, key to text. Tests may read it, and write it to set up corrupt data. */
  readonly data: Map<string, string>;
  /** Keys passed to every successful `setItem`, in order. */
  readonly writes: string[];
  /** Makes every `getItem` throw (e.g. storage blocked by browser settings). */
  failReads(error?: Error): void;
  /** Makes `setItem` throw for keys matching the filter (default: all keys). */
  failWrites(error?: Error, forKey?: (key: string) => boolean): void;
  /** Makes `removeItem` throw. */
  failRemovals(error?: Error): void;
  /** Stops all simulated failures. */
  heal(): void;
}

/** What browsers throw when storage is full. */
export function createQuotaError(): DOMException {
  return new DOMException('The quota has been exceeded.', 'QuotaExceededError');
}

/**
 * A controllable stand-in for browser storage. Tests pass it into the repositories, so they do
 * not depend on (or mock) the global `localStorage`, and can simulate failures on demand.
 */
export function createFakeStorage(initial: Record<string, string> = {}): FakeStorage {
  const data = new Map(Object.entries(initial));
  const writes: string[] = [];
  let readError: Error | undefined;
  let writeError: Error | undefined;
  let writeFilter: (key: string) => boolean = () => true;
  let removalError: Error | undefined;

  return {
    data,
    writes,
    getItem(key) {
      if (readError !== undefined) throw readError;
      return data.get(key) ?? null;
    },
    setItem(key, value) {
      if (writeError !== undefined && writeFilter(key)) throw writeError;
      data.set(key, value);
      writes.push(key);
    },
    removeItem(key) {
      if (removalError !== undefined) throw removalError;
      data.delete(key);
    },
    failReads(error = new Error('storage is not available')) {
      readError = error;
    },
    failWrites(error = new Error('write refused'), forKey = () => true) {
      writeError = error;
      writeFilter = forKey;
    },
    failRemovals(error = new Error('removal refused')) {
      removalError = error;
    },
    heal() {
      readError = undefined;
      writeError = undefined;
      removalError = undefined;
      writeFilter = () => true;
    },
  };
}
