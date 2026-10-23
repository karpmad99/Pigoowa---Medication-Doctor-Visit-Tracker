// What the start-up storage migration reports (PROJECT_SPEC §10.5). These types are the contract
// between the migration (`./local/migration.ts`) and the screens that show its result. They hold
// no stored values, only names of collections and reasons.

export type MigrationCollectionName = 'medications' | 'dose-logs' | 'appointments';

/** Why the migration of one collection stopped. The collection is left exactly as it was. */
export type MigrationFailureReason =
  /** The backup (or its provenance entry) could not be written or read back, for example because there is no room. */
  | 'backup-failed'
  /** Another tab kept changing the collection while it was being migrated. */
  | 'changed-concurrently'
  /** The rewrite of the collection was refused by the storage. */
  | 'write-failed'
  /** The collection read back after the rewrite did not equal what was written. The old text was put back. */
  | 'verification-failed'
  /** The storage could not be read. */
  | 'storage-unavailable';

/** Why a migrated collection's backup is not marked verified. The backup itself is never touched. */
export type NotVerifiedReason =
  /** The backup is the expected copy, but the migrated records differ from it (edited since). */
  | 'changed-since'
  /** The backup is missing, not a recognised version 1 collection, or disagrees with its entry. */
  | 'backup-unusable'
  /** The backup is missing. */
  | 'backup-missing'
  /** Nothing records that the migration made this backup (no entry, or an entry without a fingerprint). */
  | 'origin-unknown'
  /** The backup text changed between the entry being written and the confirmation. */
  | 'backup-changed'
  /** Everything matched, but the entry could not be completed with `verifiedAt`. */
  | 'entry-not-written';

export type BackupVerification =
  { state: 'verified' } | { state: 'not-verified'; reason: NotVerifiedReason };

export type CollectionMigrationResult =
  /** Nothing is stored under the key: nothing to migrate. */
  | { status: 'absent' }
  /** The stored text is not recognised: not read, not written, not migrated (the screens show their own error). */
  | { status: 'damaged' }
  /** Migrated in this run. */
  | { status: 'migrated'; verification: BackupVerification }
  /** Was already version 2 when the run started. */
  | { status: 'already-migrated'; verification: BackupVerification }
  /** Stopped. A collection that was version 1 is still version 1: readable, and writes to it are refused. */
  | { status: 'failed'; reason: MigrationFailureReason; storageFull: boolean };

export interface CollectionMigration {
  collection: MigrationCollectionName;
  result: CollectionMigrationResult;
}

export interface MigrationReport {
  collections: CollectionMigration[];
}

export const EMPTY_MIGRATION_REPORT: MigrationReport = { collections: [] };

/** True when a collection needs the user's attention: its migration failed, or its data is damaged. */
export function migrationNeedsAttention(report: MigrationReport): boolean {
  return report.collections.some(
    ({ result }) => result.status === 'failed' || result.status === 'damaged',
  );
}

/**
 * The start-up migration, as the application sees it. `run` is called once before anything is read
 * and again on an explicit retry; `current` is the result of the latest run.
 */
export interface StorageMigration {
  current(): MigrationReport;
  run(): MigrationReport;
}
