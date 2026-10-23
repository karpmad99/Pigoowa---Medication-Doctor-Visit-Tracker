import type { Clock } from '@/utils/clock';
import { sha256Hex } from '@/utils/sha256';
import { RepositoryError } from '../errors';
import {
  EMPTY_MIGRATION_REPORT,
  type BackupVerification,
  type CollectionMigration,
  type CollectionMigrationResult,
  type MigrationCollectionName,
  type MigrationFailureReason,
  type MigrationReport,
  type NotVerifiedReason,
  type StorageMigration,
} from '../migrationReport';
import {
  LEGACY_STORAGE_VERSION,
  parseCollectionText,
  restoreRaw,
  STORAGE_VERSION,
  writeRaw,
  type CollectionSpec,
  type ParsedCollection,
  type StoredVersion,
} from './collection';
import { appointmentCollection, doseLogCollection, medicationCollection } from './collections';
import type { KeyValueStorage } from './storage';

// The storage migration, version 1 to version 2 (PROJECT_SPEC §10.5, DEC-44, DEC-53).
//
// What this code does and does NOT do. It migrates ONE collection at a time. Each step is
// synchronous, so nothing in THIS tab can interleave. It is resumable (every intermediate state is
// readable by the current code and the next start repeats what is left), but it is NOT atomic:
// `localStorage` has no transaction across keys and no compare-and-swap, so another tab can still
// write in the instant between two consecutive calls. The window is narrowed, not closed.
//
// The rule that decides everything: a backup is written or replaced ONLY while the original is
// `pending` (a recognised version 1). The backup of a collection that is already `migrated` is never
// written, replaced or deleted by this code, whatever it contains, however much it differs from the
// original, and whether its fingerprint or entry is missing, damaged or does not match.

const BACKUP_PREFIX = 'pigoowa:v1:migration-backup:';
export const MIGRATION_META_KEY = `${BACKUP_PREFIX}meta`;

/** How many times one collection is attempted when another tab keeps changing it (step 4). */
const MAX_ATTEMPTS = 3;

interface Target {
  name: MigrationCollectionName;
  key: string;
  backupKey: string;
  parse(raw: string, accepted: readonly StoredVersion[]): ParsedCollection<unknown>;
}

function targetFor<T>(name: MigrationCollectionName, spec: CollectionSpec<T>): Target {
  return {
    name,
    key: spec.key,
    backupKey: `${BACKUP_PREFIX}${name}`,
    parse: (raw, accepted) => parseCollectionText(spec, raw, accepted),
  };
}

const TARGETS: readonly Target[] = [
  targetFor('medications', medicationCollection),
  targetFor('dose-logs', doseLogCollection),
  targetFor('appointments', appointmentCollection),
];

export function migrationBackupKey(name: MigrationCollectionName): string {
  return `${BACKUP_PREFIX}${name}`;
}

function targetNamed(name: MigrationCollectionName): Target {
  const found = TARGETS.find((target) => target.name === name);
  if (found === undefined) throw new Error(`unknown collection ${name}`);
  return found;
}

// ---------------------------------------------------------------------------------------------
// Storage access that reports instead of throwing a raw storage error.

class StorageProblem extends Error {
  readonly kind: 'unavailable' | 'full' | 'write-failed';
  constructor(kind: StorageProblem['kind']) {
    super(`storage problem: ${kind}`);
    this.kind = kind;
  }
}

function readKey(storage: KeyValueStorage, key: string): string | null {
  try {
    return storage.getItem(key);
  } catch {
    throw new StorageProblem('unavailable');
  }
}

function writeKey(storage: KeyValueStorage, key: string, value: string): void {
  try {
    writeRaw(storage, key, value, key);
  } catch (error) {
    if (error instanceof RepositoryError && error.code === 'storage-full') {
      throw new StorageProblem('full');
    }
    throw new StorageProblem('write-failed');
  }
}

// ---------------------------------------------------------------------------------------------
// The provenance entries (`meta`).

interface MetaEntry {
  backedUpAt: string;
  /** The length of the backup text. A quick consistency check, not an identity. */
  characters: number;
  /** The number of records in the backup. A quick consistency check, not an identity. */
  items: number;
  unknownFieldRecords: number;
  /** The SHA-256 of the exact backup text. THIS is what identifies the copy. */
  sha256?: string;
  verifiedAt?: string;
}

type Meta = { usable: true; entries: Record<string, MetaEntry> } | { usable: false };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readEntry(value: unknown): MetaEntry | null {
  if (!isRecord(value)) return null;
  const { backedUpAt, characters, items, unknownFieldRecords, sha256, verifiedAt } = value;
  if (
    typeof backedUpAt !== 'string' ||
    typeof characters !== 'number' ||
    typeof items !== 'number' ||
    typeof unknownFieldRecords !== 'number'
  ) {
    return null;
  }
  return {
    backedUpAt,
    characters,
    items,
    unknownFieldRecords,
    ...(typeof sha256 === 'string' ? { sha256 } : {}),
    ...(typeof verifiedAt === 'string' ? { verifiedAt } : {}),
  };
}

/** Reads `meta`. Missing is usable and empty; unreadable or of an unknown version is not usable. */
function readMeta(storage: KeyValueStorage): Meta {
  const raw = readKey(storage, MIGRATION_META_KEY);
  if (raw === null) return { usable: true, entries: {} };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { usable: false };
  }
  if (!isRecord(parsed) || parsed.version !== 1 || !isRecord(parsed.entries)) {
    return { usable: false };
  }
  const entries: Record<string, MetaEntry> = {};
  for (const [name, value] of Object.entries(parsed.entries)) {
    const entry = readEntry(value);
    if (entry !== null) entries[name] = entry;
  }
  return { usable: true, entries };
}

function writeMeta(storage: KeyValueStorage, entries: Record<string, MetaEntry>): void {
  writeKey(storage, MIGRATION_META_KEY, JSON.stringify({ version: 1, entries }));
}

// ---------------------------------------------------------------------------------------------
// Classifying a backup.

type BackupClass =
  /** Recognised version 1, and the entry (length, record count, fingerprint) matches the text. */
  | { kind: 'expected'; items: unknown[] }
  /** Missing, not recognised, or disagreeing with its entry. */
  | { kind: 'damaged'; missing: boolean }
  /** Recognised version 1, but nothing records that the migration made it or which text it was. */
  | { kind: 'origin-unknown' };

/** The order of PROJECT_SPEC §10.5, "Order of classification". Reads nothing from storage. */
function classifyBackup(
  target: Target,
  backupText: string | null,
  entry: MetaEntry | undefined,
  /** The fingerprint of `backupText`; passed in so a caller that needs it too computes it once. */
  fingerprintOf: () => string = () => sha256Hex(backupText ?? ''),
): BackupClass {
  if (backupText === null) return { kind: 'damaged', missing: true };
  const parsed = target.parse(backupText, [LEGACY_STORAGE_VERSION]);
  if (!parsed.ok) return { kind: 'damaged', missing: false };
  if (entry?.sha256 === undefined) return { kind: 'origin-unknown' };
  if (
    entry.characters !== backupText.length ||
    entry.items !== parsed.items.length ||
    entry.sha256 !== fingerprintOf()
  ) {
    return { kind: 'damaged', missing: false };
  }
  return { kind: 'expected', items: parsed.items };
}

/** JSON with sorted keys, so two validated copies of the same record compare equal. */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${(value as unknown[]).map(canonicalJson).join(',')}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function sameItems(a: readonly unknown[], b: readonly unknown[]): boolean {
  return a.length === b.length && canonicalJson(a) === canonicalJson(b);
}

function notVerified(reason: NotVerifiedReason): BackupVerification {
  return { state: 'not-verified', reason };
}

// ---------------------------------------------------------------------------------------------
// One collection.

function failed(reason: MigrationFailureReason, storageFull = false): CollectionMigrationResult {
  return { status: 'failed', reason, storageFull };
}

function failureFrom(error: unknown, reason: MigrationFailureReason): CollectionMigrationResult {
  if (error instanceof StorageProblem) {
    if (error.kind === 'unavailable') return failed('storage-unavailable');
    return failed(reason, error.kind === 'full');
  }
  return failed(reason);
}

/**
 * Sets `verifiedAt`, but only after the identity (the fingerprint of the backup text, read now) and
 * the agreement (the migrated items equal the items of that very text) have been checked. Never
 * writes to the backup.
 */
function verifyMigrated(
  storage: KeyValueStorage,
  target: Target,
  migratedItems: readonly unknown[],
  expectedFingerprint: string | null,
  clock: Clock,
): BackupVerification {
  const backupText = readKey(storage, target.backupKey);
  const meta = readMeta(storage);
  const entry = meta.usable ? meta.entries[target.name] : undefined;
  let fingerprint: string | undefined;
  const fingerprintOf = () => (fingerprint ??= sha256Hex(backupText ?? ''));

  // In the run that made the backup, the text must still have the fingerprint recorded in step 3.
  if (
    expectedFingerprint !== null &&
    backupText !== null &&
    fingerprintOf() !== expectedFingerprint
  ) {
    return notVerified('backup-changed');
  }
  const backupClass = classifyBackup(target, backupText, entry, fingerprintOf);

  if (backupClass.kind === 'damaged') {
    return notVerified(backupClass.missing ? 'backup-missing' : 'backup-unusable');
  }
  if (backupClass.kind === 'origin-unknown') return notVerified('origin-unknown');

  // Identity. `classifyBackup` has just shown that the stored text has the fingerprint in the
  // entry. When the caller knows the fingerprint it recorded in step 3, the entry must still be
  // that one: otherwise something replaced the entry since.
  if (expectedFingerprint !== null && entry?.sha256 !== expectedFingerprint) {
    return notVerified('backup-changed');
  }
  // Agreement: the migrated records equal the records of the backup.
  if (!sameItems(migratedItems, backupClass.items)) return notVerified('changed-since');

  if (!meta.usable || entry === undefined) return notVerified('entry-not-written');
  try {
    writeMeta(storage, {
      ...meta.entries,
      [target.name]: { ...entry, verifiedAt: clock.now() },
    });
  } catch {
    return notVerified('entry-not-written');
  }
  return { state: 'verified' };
}

function migrateCollection(
  storage: KeyValueStorage,
  target: Target,
  clock: Clock,
): CollectionMigrationResult {
  try {
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      // Step 1: read the original and determine its state.
      const original = readKey(storage, target.key);
      if (original === null) return { status: 'absent' };
      const parsed = target.parse(original, [LEGACY_STORAGE_VERSION, STORAGE_VERSION]);
      if (!parsed.ok) return { status: 'damaged' };

      if (parsed.version === STORAGE_VERSION) {
        // `migrated`: the backup is NEVER written, replaced or deleted from here on.
        const meta = readMeta(storage);
        const entry = meta.usable ? meta.entries[target.name] : undefined;
        if (entry?.verifiedAt !== undefined) {
          return { status: 'already-migrated', verification: { state: 'verified' } };
        }
        return {
          status: 'already-migrated',
          verification: verifyMigrated(storage, target, parsed.items, null, clock),
        };
      }

      // `pending`. Step 2: the backup, verbatim. This is the only place a backup is written.
      if (readKey(storage, target.backupKey) !== original) {
        writeKey(storage, target.backupKey, original);
      }
      // Step 3: read it back, then record the provenance entry BEFORE the rewrite.
      if (readKey(storage, target.backupKey) !== original) return failed('backup-failed');
      const fingerprint = sha256Hex(original);
      const meta = readMeta(storage);
      writeMeta(storage, {
        ...(meta.usable ? meta.entries : {}),
        [target.name]: {
          backedUpAt: clock.now(),
          characters: original.length,
          items: parsed.items.length,
          unknownFieldRecords: parsed.unknownFieldRecords,
          sha256: fingerprint,
        },
      });

      // Step 4: compare. If another tab changed the text meanwhile, start again.
      if (readKey(storage, target.key) !== original) continue;

      // Step 5: rewrite as version 2, with the same items.
      try {
        writeKey(
          storage,
          target.key,
          JSON.stringify({ version: STORAGE_VERSION, items: parsed.items }),
        );
      } catch (error) {
        return failureFrom(error, 'write-failed');
      }

      // Step 6: read it back; the items must equal what was written.
      const writtenBack = readKey(storage, target.key);
      const reread = writtenBack === null ? null : target.parse(writtenBack, [STORAGE_VERSION]);
      if (reread === null || !reread.ok || !sameItems(reread.items, parsed.items)) {
        restoreRaw(storage, target.key, original);
        return failed('verification-failed');
      }

      // Step 7: confirm identity and agreement, then complete the entry.
      return {
        status: 'migrated',
        verification: verifyMigrated(storage, target, reread.items, fingerprint, clock),
      };
    }
    return failed('changed-concurrently');
  } catch (error) {
    // A failure in step 2 or 3 is a backup failure; in the others the reason is already specific.
    return failureFrom(error, 'backup-failed');
  }
}

// ---------------------------------------------------------------------------------------------
// The start-up run.

/**
 * Migrates every collection that is still version 1 and reports, for each collection, what
 * happened. Never throws. Collections are processed from the smallest stored text to the largest,
 * so that a lack of space blocks as little as possible. Running it again is harmless.
 */
export function migrateStorage(storage: KeyValueStorage, clock: Clock): MigrationReport {
  const sizes = TARGETS.map((target) => {
    try {
      return { target, size: readKey(storage, target.key)?.length ?? 0 };
    } catch {
      return { target, size: 0 };
    }
  });
  sizes.sort((a, b) => a.size - b.size);

  const results = new Map<MigrationCollectionName, CollectionMigrationResult>();
  for (const { target } of sizes) {
    results.set(target.name, migrateCollection(storage, target, clock));
  }
  // Reported in the fixed order of the collections.
  const collections: CollectionMigration[] = TARGETS.map((target) => ({
    collection: target.name,
    result: results.get(target.name) ?? failed('storage-unavailable'),
  }));
  return { collections };
}

/** The migration as the application holds it: the latest report, and a way to run it again. */
export function createStorageMigration(storage: KeyValueStorage, clock: Clock): StorageMigration {
  let latest: MigrationReport = EMPTY_MIGRATION_REPORT;
  return {
    current: () => latest,
    run: () => {
      latest = migrateStorage(storage, clock);
      return latest;
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Restoring a collection from its backup (explicit; no screen in F1).

export type RestoreRefusal =
  /** The caller did not state that the changes made since the migration will be lost. */
  | 'not-confirmed'
  | 'backup-missing'
  /** Not a recognised version 1 collection, or it disagrees with its entry (fingerprint, length, record count). */
  | 'backup-unusable'
  /** Nothing records where the backup came from, and the caller did not accept that. */
  | 'origin-not-accepted'
  | 'storage-unavailable'
  | 'write-failed'
  | 'verification-failed';

export type RestoreResult = { ok: true } | { ok: false; reason: RestoreRefusal };

export interface RestoreOptions {
  /** Must be true: the collection's current data is replaced and everything entered since the migration in it is lost. */
  confirmLoseChangesSinceMigration: boolean;
  /** Must be true to restore a backup whose origin cannot be established. */
  acceptUnverifiedOrigin?: boolean;
}

/**
 * Copies the backup text of one collection back to its data key as version 1, reads it back and
 * compares it with the backup, so the collection returns to `pending` and the next start migrates
 * it again. The backup and its entry are not touched. A backup that is missing, unrecognised or
 * inconsistent with its entry is refused; one of unknown origin only with an explicit statement.
 */
export function restoreMigrationBackup(
  storage: KeyValueStorage,
  name: MigrationCollectionName,
  options: RestoreOptions,
): RestoreResult {
  if (!options.confirmLoseChangesSinceMigration) return { ok: false, reason: 'not-confirmed' };
  const target = targetNamed(name);
  try {
    const backupText = readKey(storage, target.backupKey);
    const meta = readMeta(storage);
    const backupClass = classifyBackup(
      target,
      backupText,
      meta.usable ? meta.entries[name] : undefined,
    );
    if (backupClass.kind === 'damaged') {
      return { ok: false, reason: backupClass.missing ? 'backup-missing' : 'backup-unusable' };
    }
    if (backupClass.kind === 'origin-unknown' && options.acceptUnverifiedOrigin !== true) {
      return { ok: false, reason: 'origin-not-accepted' };
    }
    if (backupText === null) return { ok: false, reason: 'backup-missing' };

    const previous = readKey(storage, target.key);
    try {
      writeKey(storage, target.key, backupText);
    } catch {
      return { ok: false, reason: 'write-failed' };
    }
    if (readKey(storage, target.key) !== backupText) {
      restoreRaw(storage, target.key, previous);
      return { ok: false, reason: 'verification-failed' };
    }
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      reason:
        error instanceof StorageProblem && error.kind === 'unavailable'
          ? 'storage-unavailable'
          : 'write-failed',
    };
  }
}
