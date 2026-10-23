import { RepositoryError } from '../errors';
import type { KeyValueStorage } from './storage';
import type { Validated } from './validation';

// How one list of records (all medications, all dose records, ...) is kept in storage:
// a single key holding JSON of the form { "version": 2, "items": [ ... ] }.
//
// Why a version? So that a release which changes the format can recognise old data instead of
// misreading it. Version 1 is the format of every release before the storage migration of
// PROJECT_SPEC §10.5; version 2 is what is written now. A collection is read in either version,
// but NEVER WRITTEN while it is still version 1: the migration (./migration.ts) must first back it
// up and rewrite it, so no version 2 write can come before that collection's backup. Data with any
// other version is refused (never overwritten) rather than guessed at.

/** The version this code writes. */
export const STORAGE_VERSION = 2;
/** The version written by releases before the migration. It is read, never written. */
export const LEGACY_STORAGE_VERSION = 1;

export type StoredVersion = typeof LEGACY_STORAGE_VERSION | typeof STORAGE_VERSION;

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
  /** The envelope version that was read; `null` when nothing was stored. */
  version: StoredVersion | null;
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
 * True when the stored form has keys that the validated copy does not: the validators rebuild a
 * record from the fields they know, so such fields would be dropped by any rewrite. Compared
 * through nested objects and lists.
 */
function hasUnknownFields(stored: unknown, validated: unknown): boolean {
  if (Array.isArray(stored) && Array.isArray(validated)) {
    return (stored as unknown[]).some((entry, index) => hasUnknownFields(entry, validated[index]));
  }
  if (isRecord(stored) && isRecord(validated)) {
    return Object.entries(stored).some(([key, value]) =>
      key in validated ? hasUnknownFields(value, validated[key]) : true,
    );
  }
  return false;
}

export type ParsedCollection<T> =
  | {
      ok: true;
      version: StoredVersion;
      items: T[];
      /** How many stored records carry fields the validators do not know (they are dropped on rewrite). */
      unknownFieldRecords: number;
    }
  | { ok: false; error: RepositoryError };

/**
 * Recognises a stored text as a collection of one of the `accepted` versions: valid JSON, an
 * object whose `version` is exactly one of them, a list of items, EVERY item valid, unique ids and
 * unique slots. There is no partial or best-effort reading: one unrecognised record makes the
 * whole text unrecognised. Pure: reads and writes no storage.
 */
export function parseCollectionText<T>(
  spec: CollectionSpec<T>,
  raw: string,
  accepted: readonly StoredVersion[] = [LEGACY_STORAGE_VERSION, STORAGE_VERSION],
): ParsedCollection<T> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // The parser's message can quote part of the stored text, so it is deliberately not kept.
    return {
      ok: false,
      error: new RepositoryError('data-corrupted', { detail: `${spec.name}: not valid JSON` }),
    };
  }
  if (!isRecord(parsed) || typeof parsed.version !== 'number') {
    return {
      ok: false,
      error: new RepositoryError('data-corrupted', {
        detail: `${spec.name}: unexpected structure`,
      }),
    };
  }
  const version = accepted.find((candidate) => candidate === parsed.version);
  if (version === undefined) {
    return {
      ok: false,
      error: new RepositoryError('unsupported-version', {
        detail: `${spec.name}: version ${String(parsed.version)}`,
      }),
    };
  }
  if (!Array.isArray(parsed.items)) {
    return {
      ok: false,
      error: new RepositoryError('data-corrupted', {
        detail: `${spec.name}: items is not a list`,
      }),
    };
  }

  const items: T[] = [];
  const ids = new Set<string>();
  const slots = new Set<string>();
  let unknownFieldRecords = 0;
  for (const [index, entry] of (parsed.items as unknown[]).entries()) {
    const path = `${spec.name}[${String(index)}]`;
    const result = spec.validate(entry, path);
    if (!result.ok) {
      return {
        ok: false,
        error: new RepositoryError('data-corrupted', { detail: `invalid field: ${result.path}` }),
      };
    }
    const id = spec.idOf(result.value);
    if (ids.has(id)) {
      return {
        ok: false,
        error: new RepositoryError('data-corrupted', { detail: `${path}: duplicate id` }),
      };
    }
    ids.add(id);
    if (spec.slotOf) {
      const slot = spec.slotOf(result.value);
      if (slots.has(slot)) {
        return {
          ok: false,
          error: new RepositoryError('data-corrupted', { detail: `${path}: duplicate slot` }),
        };
      }
      slots.add(slot);
    }
    if (hasUnknownFields(entry, result.value)) unknownFieldRecords += 1;
    items.push(result.value);
  }
  return { ok: true, version, items, unknownFieldRecords };
}

/**
 * Reads and fully validates a collection (version 1 or 2). Missing data is an empty collection;
 * anything else that is not valid is an error, never "treated as empty": the next write would
 * otherwise replace the user's (possibly recoverable) data. Reading never writes anything.
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
  if (raw === null) return { items: [], raw, version: null };

  const result = parseCollectionText(spec, raw);
  if (!result.ok) throw result.error;
  return { items: result.items, raw, version: result.version };
}

/**
 * The write gate: a collection that is still version 1 is never written by this code, so that no
 * version 2 write can come before that collection's backup (PROJECT_SPEC §10.5, DEC-53). It is
 * derived from the version that was just read, so it holds in every tab that runs this code.
 */
export function assertWritable(contents: { version: StoredVersion | null }, name: string): void {
  if (contents.version === LEGACY_STORAGE_VERSION) {
    throw new RepositoryError('migration-required', { detail: `${name}: still version 1` });
  }
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

/**
 * Writes the whole collection as version 2. `current` is what the caller read just before; a
 * collection that is still version 1 is refused (`migration-required`), see `assertWritable`.
 */
export function writeCollection<T>(
  storage: KeyValueStorage,
  spec: CollectionSpec<T>,
  items: readonly T[],
  current: CollectionContents<T>,
): void {
  assertWritable(current, spec.name);
  replaceCollection(storage, spec, items);
}

/**
 * Writes the whole collection as version 2 WITHOUT looking at what is stored. Only for the
 * explicit demo-data controls, which replace everything on purpose (after a backup of their own)
 * and for the migration itself. Ordinary operations use `writeCollection`.
 */
export function replaceCollection<T>(
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
