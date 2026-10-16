import { RepositoryError } from '../errors';
import type { KeyValueStorage } from './storage';
import type { Validated } from './validation';

// How one list of records (all medications, all dose records, ...) is kept in storage:
// a single key holding JSON of the form { "version": 1, "items": [ ... ] }.
//
// Why a version? So that a future release which changes the format can recognise old data
// instead of misreading it. For now there is exactly one version; data with any other version
// is refused (never overwritten) rather than guessed at. No migrations exist because none are
// needed yet.

export const STORAGE_VERSION = 1;

export interface CollectionSpec<T> {
  /** The storage key, e.g. "pigoowa:v1:medications". */
  key: string;
  /** Used in error details, e.g. "medications". */
  name: string;
  validate: (input: unknown, path: string) => Validated<T>;
  idOf: (item: T) => string;
  /** For collections with a second uniqueness rule (dose records: one per slot). */
  slotOf?: (item: T) => string;
}

export interface CollectionContents<T> {
  items: T[];
  /** Exactly what was in storage (null if nothing), kept so a failed multi-step change can be undone. */
  raw: string | null;
}

function isQuotaError(error: unknown): boolean {
  // jsdom's DOMException is not an instance of Error, so look at the name rather than the class.
  if (typeof error !== 'object' || error === null || !('name' in error)) return false;
  return error.name === 'QuotaExceededError' || error.name === 'NS_ERROR_DOM_QUOTA_REACHED';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Reads and fully validates a collection. Missing data is an empty collection; anything else
 * that is not valid is an error, never "treated as empty": the next write would otherwise
 * replace the user's (possibly recoverable) data. Reading never writes anything.
 */
export function readCollection<T>(
  storage: KeyValueStorage,
  spec: CollectionSpec<T>,
): CollectionContents<T> {
  let raw: string | null;
  try {
    raw = storage.getItem(spec.key);
  } catch (cause) {
    throw new RepositoryError('storage-unavailable', { cause, detail: `reading ${spec.name}` });
  }
  if (raw === null) return { items: [], raw };

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // The parser's message can quote part of the stored text, so it is deliberately not kept.
    throw new RepositoryError('data-corrupted', { detail: `${spec.name}: not valid JSON` });
  }
  if (!isRecord(parsed) || typeof parsed.version !== 'number') {
    throw new RepositoryError('data-corrupted', { detail: `${spec.name}: unexpected structure` });
  }
  if (parsed.version !== STORAGE_VERSION) {
    throw new RepositoryError('unsupported-version', {
      detail: `${spec.name}: version ${String(parsed.version)}`,
    });
  }
  if (!Array.isArray(parsed.items)) {
    throw new RepositoryError('data-corrupted', { detail: `${spec.name}: items is not a list` });
  }

  const items: T[] = [];
  const ids = new Set<string>();
  const slots = new Set<string>();
  for (const [index, entry] of (parsed.items as unknown[]).entries()) {
    const path = `${spec.name}[${String(index)}]`;
    const result = spec.validate(entry, path);
    if (!result.ok) {
      throw new RepositoryError('data-corrupted', { detail: `invalid field: ${result.path}` });
    }
    const id = spec.idOf(result.value);
    if (ids.has(id)) {
      throw new RepositoryError('data-corrupted', { detail: `${path}: duplicate id` });
    }
    ids.add(id);
    if (spec.slotOf) {
      const slot = spec.slotOf(result.value);
      if (slots.has(slot)) {
        throw new RepositoryError('data-corrupted', { detail: `${path}: duplicate slot` });
      }
      slots.add(slot);
    }
    items.push(result.value);
  }
  return { items, raw };
}

/** Writes text under a key. If storage refuses, the error says why (full or not) and the old value stays in place. */
export function writeRaw(storage: KeyValueStorage, key: string, value: string, what: string): void {
  try {
    storage.setItem(key, value);
  } catch (cause) {
    throw new RepositoryError(isQuotaError(cause) ? 'storage-full' : 'storage-write-failed', {
      cause,
      detail: `writing ${what}`,
    });
  }
}

/** Writes the whole collection. */
export function writeCollection<T>(
  storage: KeyValueStorage,
  spec: CollectionSpec<T>,
  items: readonly T[],
): void {
  writeRaw(storage, spec.key, JSON.stringify({ version: STORAGE_VERSION, items }), spec.name);
}

/** Puts a previously read raw value back (or removes the key if there was none). Returns whether it worked. */
export function restoreRaw(storage: KeyValueStorage, key: string, raw: string | null): boolean {
  try {
    if (raw === null) storage.removeItem(key);
    else storage.setItem(key, raw);
    return true;
  } catch {
    return false;
  }
}
