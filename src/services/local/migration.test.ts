import { describe, expect, it } from 'vitest';
import { createFakeStorage, createQuotaError, type FakeStorage } from '@/test/fakeStorage';
import { makeAppointment, makeDoseLog, makeMedication, scheduleTime } from '@/test/fixtures';
import {
  frozenAppointments,
  frozenCreateAppointment,
  frozenCreateMedication,
  frozenDoseLogs,
  frozenMedications,
  frozenRead,
  frozenWrite,
} from '@/test/frozenV1/reader';
import { createFixedClock } from '@/utils/clock';
import { asLocalTime, asTimestamp } from '@/utils/date';
import { sha256Hex } from '@/utils/sha256';
import { RepositoryError } from '../errors';
import {
  migrationNeedsAttention,
  type CollectionMigrationResult,
  type MigrationCollectionName,
  type MigrationReport,
} from '../migrationReport';
import { STORAGE_KEYS } from './collections';
import { createLocalRepositories } from './localRepositories';
import {
  createStorageMigration,
  MIGRATION_META_KEY,
  migrateStorage,
  migrationBackupKey,
  restoreMigrationBackup,
} from './migration';
import type { KeyValueStorage } from './storage';

// The storage migration, version 1 to version 2 (PROJECT_SPEC §10.5). Older copies of the
// application are played by the frozen version 1 reader in src/test/frozenV1.

const NOW = '2026-10-15T10:00:00Z';
const clock = createFixedClock(NOW);

const NAMES: MigrationCollectionName[] = ['medications', 'dose-logs', 'appointments'];
const DATA_KEY: Record<MigrationCollectionName, string> = {
  medications: STORAGE_KEYS.medications,
  'dose-logs': STORAGE_KEYS.doseLogs,
  appointments: STORAGE_KEYS.appointments,
};
const BACKUP_KEYS = NAMES.map((name) => migrationBackupKey(name));

/** A storage that fakes browser storage and lets a test interfere at chosen moments. */
interface Hooks {
  /** Makes the matching `setItem` throw (default error: a refused write). */
  failWhen?: (key: string, value: string, count: number) => Error | undefined;
  /** Runs after a successful `setItem`: stands for another tab acting at that very moment. */
  afterSet?: (key: string, value: string) => void;
  /** Changes what is actually stored by a `setItem` (a write that does not read back as written). */
  transform?: (key: string, value: string) => string;
}

/** Keys passed to `removeItem` through any instrumented storage: the migration must never remove anything. */
const removals: string[] = [];

function instrument(base: FakeStorage, hooks: Hooks = {}): KeyValueStorage {
  let count = 0;
  return {
    getItem: (key) => base.getItem(key),
    setItem: (key, value) => {
      count += 1;
      const error = hooks.failWhen?.(key, value, count);
      if (error !== undefined) throw error;
      base.setItem(key, hooks.transform ? hooks.transform(key, value) : value);
      hooks.afterSet?.(key, value);
    },
    removeItem: (key) => {
      removals.push(key);
      base.removeItem(key);
    },
  };
}

function seededV1(): { storage: FakeStorage; originals: Record<MigrationCollectionName, string> } {
  const storage = createFakeStorage();
  frozenWrite(storage, frozenMedications, [
    makeMedication({ id: 'm-1', name: 'Lek A', doseUnit: 'Tabletka ' }),
    makeMedication({
      id: 'm-2',
      name: 'Lek B',
      doseUnit: 'mg',
      scheduleTimes: [scheduleTime('t-2', '09:00', 2)],
      stock: { quantity: 10, unit: 'mg', asOf: asTimestamp(NOW) },
    }),
  ]);
  frozenWrite(storage, frozenDoseLogs, [
    makeDoseLog({ id: 'l-1', medicationId: 'm-1', doseUnit: 'Tabletka ' }),
    makeDoseLog({
      id: 'l-2',
      medicationId: 'm-2',
      scheduledTime: asLocalTime('09:00'),
      doseAmount: 2,
      doseUnit: 'mg',
    }),
  ]);
  frozenWrite(storage, frozenAppointments, [makeAppointment()]);
  // The seeding is not part of what a test measures.
  storage.writes.length = 0;
  return { storage, originals: readOriginals(storage) };
}

function readOriginals(storage: FakeStorage): Record<MigrationCollectionName, string> {
  return {
    medications: storage.data.get(DATA_KEY.medications) ?? '',
    'dose-logs': storage.data.get(DATA_KEY['dose-logs']) ?? '',
    appointments: storage.data.get(DATA_KEY.appointments) ?? '',
  };
}

function resultOf(
  report: MigrationReport,
  name: MigrationCollectionName,
): CollectionMigrationResult {
  const found = report.collections.find((entry) => entry.collection === name);
  if (found === undefined) throw new Error(`no result for ${name}`);
  return found.result;
}

const VERIFIED = { state: 'verified' } as const;

function notVerified(reason: string) {
  return { state: 'not-verified', reason };
}

function backupWrites(storage: FakeStorage): string[] {
  return storage.writes.filter((key) => BACKUP_KEYS.includes(key));
}

interface StoredEntry {
  backedUpAt: string;
  characters: number;
  items: number;
  unknownFieldRecords: number;
  sha256?: string;
  verifiedAt?: string;
}
function readEntries(storage: FakeStorage): Record<string, StoredEntry> {
  const raw = storage.data.get(MIGRATION_META_KEY);
  if (raw === undefined) return {};
  try {
    const parsed = JSON.parse(raw) as { version?: unknown; entries?: Record<string, StoredEntry> };
    return parsed.version === 1 && parsed.entries !== undefined ? parsed.entries : {};
  } catch {
    return {};
  }
}

/** Whether `meta` is stored in a form the migration can use. */
function metaIsUsable(storage: FakeStorage): boolean {
  const raw = storage.data.get(MIGRATION_META_KEY);
  if (raw === undefined) return true;
  try {
    const parsed = JSON.parse(raw) as { version?: unknown; entries?: unknown };
    return parsed.version === 1 && typeof parsed.entries === 'object' && parsed.entries !== null;
  } catch {
    return false;
  }
}

function entryOf(storage: FakeStorage, name: MigrationCollectionName): StoredEntry {
  const entry = readEntries(storage)[name];
  if (entry === undefined) throw new Error(`no entry for ${name}`);
  return entry;
}

function errorCodeOf(action: () => unknown): string {
  try {
    action();
  } catch (error) {
    if (error instanceof RepositoryError) return error.code;
    throw error;
  }
  throw new Error('Expected a RepositoryError');
}

/** Migrates every collection but never manages to record `verifiedAt` (as if the app stopped before step 7). */
function migrateWithoutVerification(base: FakeStorage): MigrationReport {
  return migrateStorage(
    instrument(base, {
      failWhen: (key, value) =>
        key === MIGRATION_META_KEY && value.includes('"verifiedAt"')
          ? new Error('stopped before step 7')
          : undefined,
    }),
    clock,
  );
}

describe('migrating version 1 to version 2', () => {
  it('rewrites every collection as version 2 with the same items, backs it up verbatim and verifies it', () => {
    const { storage, originals } = seededV1();

    const report = migrateStorage(storage, clock);

    for (const name of NAMES) {
      expect(resultOf(report, name)).toEqual({ status: 'migrated', verification: VERIFIED });
      const migrated = JSON.parse(storage.data.get(DATA_KEY[name]) ?? '') as {
        version: number;
        items: unknown[];
      };
      const original = JSON.parse(originals[name]) as { items: unknown[] };
      expect(migrated.version).toBe(2);
      expect(migrated.items).toEqual(original.items);
      // The backup is the exact original text, nothing else.
      expect(storage.data.get(migrationBackupKey(name))).toBe(originals[name]);
    }
    expect(migrationNeedsAttention(report)).toBe(false);
  });

  it('records, for each backup, when it was made, how long it is, how many records it has and its fingerprint, and verifies it', () => {
    const { storage, originals } = seededV1();

    migrateStorage(storage, clock);

    const entries = readEntries(storage);
    expect(entries.medications).toEqual({
      backedUpAt: '2026-10-15T10:00:00.000Z',
      characters: originals.medications.length,
      items: 2,
      unknownFieldRecords: 0,
      sha256: sha256Hex(originals.medications),
      verifiedAt: '2026-10-15T10:00:00.000Z',
    });
    expect(entries['dose-logs']?.sha256).toBe(sha256Hex(originals['dose-logs']));
    expect(entries.appointments?.items).toBe(1);
  });

  it('keeps units exactly as stored, without trimming, changing case or replacing them', () => {
    const { storage } = seededV1();

    migrateStorage(storage, clock);

    const repositories = createLocalRepositories(storage);
    return repositories.medications.list().then((medications) => {
      expect(medications.map((m) => m.doseUnit).sort()).toEqual(['Tabletka ', 'mg']);
      expect(storage.data.get(STORAGE_KEYS.medications)).toContain('"doseUnit":"Tabletka "');
    });
  });

  it('counts records that carry unknown fields, drops those fields from the migrated text and keeps them in the backup', () => {
    const { storage } = seededV1();
    const withExtra = JSON.stringify({
      version: 1,
      items: [{ ...makeAppointment(), futureField: 'x' }, makeAppointment({ id: 'appt-2' })],
    });
    storage.data.set(STORAGE_KEYS.appointments, withExtra);

    migrateStorage(storage, clock);

    expect(readEntries(storage).appointments?.unknownFieldRecords).toBe(1);
    expect(storage.data.get(STORAGE_KEYS.appointments)).not.toContain('futureField');
    expect(storage.data.get(migrationBackupKey('appointments'))).toBe(withExtra);
  });

  it('does nothing and creates no keys when nothing is stored', () => {
    const storage = createFakeStorage();

    const report = migrateStorage(storage, clock);

    for (const name of NAMES) expect(resultOf(report, name)).toEqual({ status: 'absent' });
    expect(storage.writes).toEqual([]);
    expect(storage.data.size).toBe(0);
  });

  it('does no harm when run again: nothing is written the second time', () => {
    const { storage } = seededV1();
    migrateStorage(storage, clock);
    const writesAfterFirst = storage.writes.length;

    const second = migrateStorage(storage, clock);

    for (const name of NAMES) {
      expect(resultOf(second, name)).toEqual({
        status: 'already-migrated',
        verification: VERIFIED,
      });
    }
    expect(storage.writes).toHaveLength(writesAfterFirst);
  });

  it('processes the collections from the smallest stored text to the largest', () => {
    const { storage, originals } = seededV1();
    const sizes = NAMES.map((name) => ({ name, size: originals[name].length })).sort(
      (a, b) => a.size - b.size,
    );

    migrateStorage(storage, clock);

    expect(backupWrites(storage)).toEqual(sizes.map(({ name }) => migrationBackupKey(name)));
  });

  it('migrates collections independently: a damaged one is neither touched nor backed up, and does not stop the others', () => {
    const { storage, originals } = seededV1();
    const damaged = '{"version":1,"items":[{"id":"appt-1"}]}';
    storage.data.set(STORAGE_KEYS.appointments, damaged);

    const report = migrateStorage(storage, clock);

    expect(resultOf(report, 'appointments')).toEqual({ status: 'damaged' });
    expect(storage.data.get(STORAGE_KEYS.appointments)).toBe(damaged);
    expect(storage.data.has(migrationBackupKey('appointments'))).toBe(false);
    expect(resultOf(report, 'medications').status).toBe('migrated');
    expect(storage.data.get(migrationBackupKey('medications'))).toBe(originals.medications);
    expect(migrationNeedsAttention(report)).toBe(true);
  });
});

describe('recognising the original: only a fully recognised version 1 is migrated', () => {
  const valid = JSON.stringify(makeAppointment());
  const cases: [string, string][] = [
    ['not JSON', '{"version":1,"items":['],
    ['a version that is not exactly a number 1 or 2 (1.5)', `{"version":1.5,"items":[${valid}]}`],
    ['a version written as text ("1")', `{"version":"1","items":[${valid}]}`],
    ['a version from a newer application (3)', `{"version":3,"items":[${valid}]}`],
    ['items that are not a list', '{"version":1,"items":{}}'],
    ['one invalid record among valid ones', `{"version":1,"items":[${valid},{"id":"x"}]}`],
    ['a duplicate id', `{"version":1,"items":[${valid},${valid}]}`],
  ];

  it.each(cases)(
    '%s: not read, not written, not migrated, nothing backed up',
    async (_name, text) => {
      const storage = createFakeStorage({ [STORAGE_KEYS.appointments]: text });

      const report = migrateStorage(storage, clock);

      expect(resultOf(report, 'appointments')).toEqual({ status: 'damaged' });
      expect(storage.data.get(STORAGE_KEYS.appointments)).toBe(text);
      expect(storage.writes).toEqual([]);
      const repositories = createLocalRepositories(storage);
      await expect(repositories.appointments.list()).rejects.toBeInstanceOf(RepositoryError);
      await expect(
        repositories.appointments.create(makeAppointment({ id: 'new' })),
      ).rejects.toBeInstanceOf(RepositoryError);
      expect(storage.writes).toEqual([]);
    },
  );
});

describe('the write gate', () => {
  it('reads version 1 normally but refuses every write to it until it is migrated', async () => {
    const { storage } = seededV1();
    const repositories = createLocalRepositories(storage);
    expect(await repositories.medications.list()).toHaveLength(2);
    expect(storage.writes).toEqual([]);

    const attempts = [
      repositories.medications.create(makeMedication({ id: 'm-3' })),
      repositories.medications.update(makeMedication({ id: 'm-1', name: 'Zmieniony' })),
      repositories.medications.remove('m-1'),
      repositories.doseLogs.upsert(
        makeDoseLog({ id: 'l-3', medicationId: 'm-1', scheduledTime: asLocalTime('12:00') }),
      ),
      repositories.doseLogs.remove({
        medicationId: 'm-1',
        date: makeDoseLog().scheduledDate,
        time: makeDoseLog().scheduledTime,
      }),
      repositories.appointments.create(makeAppointment({ id: 'a-2' })),
      repositories.appointments.update(makeAppointment({ notes: 'zmiana' })),
      repositories.appointments.remove('appt-1'),
    ];
    for (const attempt of attempts) {
      await expect(attempt).rejects.toMatchObject({ code: 'migration-required' });
    }
    expect(storage.writes).toEqual([]);
  });

  it('does not leave a half-deleted medication when only the history is still version 1', async () => {
    const storage = createFakeStorage();
    const repositories = createLocalRepositories(storage);
    await repositories.medications.create(makeMedication({ id: 'm-1' }));
    // The history of that medication is still version 1.
    frozenWrite(storage, frozenDoseLogs, [makeDoseLog({ id: 'l-1', medicationId: 'm-1' })]);
    const medications = storage.data.get(STORAGE_KEYS.medications);
    const history = storage.data.get(STORAGE_KEYS.doseLogs);

    await expect(repositories.medications.remove('m-1')).rejects.toMatchObject({
      code: 'migration-required',
    });

    expect(storage.data.get(STORAGE_KEYS.medications)).toBe(medications);
    expect(storage.data.get(STORAGE_KEYS.doseLogs)).toBe(history);
  });

  it('allows writes to a collection that is absent, and writes version 2', async () => {
    const storage = createFakeStorage();
    const repositories = createLocalRepositories(storage);

    await repositories.appointments.create(makeAppointment());

    expect(JSON.parse(storage.data.get(STORAGE_KEYS.appointments) ?? '')).toMatchObject({
      version: 2,
    });
  });

  it('allows writes once the collection is migrated', async () => {
    const { storage } = seededV1();
    migrateStorage(storage, clock);
    const repositories = createLocalRepositories(storage);

    await repositories.medications.create(makeMedication({ id: 'm-3', name: 'Nowy' }));

    expect(await repositories.medications.list()).toHaveLength(3);
  });

  it('lets a no-op undo of a dose succeed even while the history is still version 1 (it writes nothing)', async () => {
    const { storage } = seededV1();
    const repositories = createLocalRepositories(storage);

    await repositories.doseLogs.remove({
      medicationId: 'm-1',
      date: makeDoseLog().scheduledDate,
      time: asLocalTime('23:00'),
    });

    expect(storage.writes).toEqual([]);
  });
});

/** A read-only view of the same stored data, so a test can use the frozen reader on it. */
function createFakeStorageWith(storage: FakeStorage): KeyValueStorage {
  return {
    getItem: (key) => storage.getItem(key),
    setItem: () => undefined,
    removeItem: () => undefined,
  };
}

describe('an older copy of the application (the frozen version 1 reader)', () => {
  it('refuses a migrated collection and writes nothing', () => {
    const { storage } = seededV1();
    migrateStorage(storage, clock);
    const writes = storage.writes.length;

    expect(errorCodeOf(() => frozenRead(storage, frozenMedications))).toBe('unsupported-version');
    expect(errorCodeOf(() => frozenRead(storage, frozenDoseLogs))).toBe('unsupported-version');
    expect(errorCodeOf(() => frozenRead(storage, frozenAppointments))).toBe('unsupported-version');
    expect(
      errorCodeOf(() => {
        frozenCreateAppointment(storage, makeAppointment({ id: 'old-copy' }));
      }),
    ).toBe('unsupported-version');
    expect(
      errorCodeOf(() => {
        frozenCreateMedication(storage, makeMedication({ id: 'old-copy' }));
      }),
    ).toBe('unsupported-version');
    expect(storage.writes).toHaveLength(writes);
  });

  it('can still write version 1 to a collection that was absent; the next start migrates it and keeps the record', () => {
    const { storage } = seededV1();
    storage.data.delete(STORAGE_KEYS.appointments);
    migrateStorage(storage, clock);
    expect(storage.data.has(STORAGE_KEYS.appointments)).toBe(false);

    frozenCreateAppointment(storage, makeAppointment({ id: 'written-by-old-copy' }));
    expect(JSON.parse(storage.data.get(STORAGE_KEYS.appointments) ?? '')).toMatchObject({
      version: 1,
    });
    const report = migrateStorage(storage, clock);

    expect(resultOf(report, 'appointments')).toEqual({
      status: 'migrated',
      verification: VERIFIED,
    });
    expect(storage.data.get(STORAGE_KEYS.appointments)).toContain('written-by-old-copy');
  });

  it('can still write to a collection whose migration stopped; the later migration includes the record', () => {
    const { storage } = seededV1();
    const noRoom = instrument(storage, {
      failWhen: (key) =>
        key === migrationBackupKey('appointments') ? createQuotaError() : undefined,
    });
    const first = migrateStorage(noRoom, clock);
    expect(resultOf(first, 'appointments')).toMatchObject({
      status: 'failed',
      reason: 'backup-failed',
      storageFull: true,
    });

    frozenCreateAppointment(storage, makeAppointment({ id: 'written-meanwhile' }));
    const second = migrateStorage(storage, clock);

    expect(resultOf(second, 'appointments').status).toBe('migrated');
    expect(storage.data.get(STORAGE_KEYS.appointments)).toContain('written-meanwhile');
    expect(storage.data.get(migrationBackupKey('appointments'))).toContain('written-meanwhile');
  });
});

describe('interruptions: a storage that fails at every step in turn', () => {
  function countWritesOfAFullRun(): number {
    const { storage } = seededV1();
    migrateStorage(storage, clock);
    return storage.writes.length;
  }

  it('leaves, after a failure at any write, data the new code can read and the next start finishes', async () => {
    const total = countWritesOfAFullRun();
    expect(total).toBe(12); // per collection: backup, entry, rewrite, verifiedAt

    for (let failAt = 1; failAt <= total; failAt += 1) {
      const { storage, originals } = seededV1();

      const report = migrateStorage(
        instrument(storage, {
          failWhen: (_k, _v, count) => (count === failAt ? new Error('crash') : undefined),
        }),
        clock,
      );
      expect(JSON.stringify(report), `failure at write ${String(failAt)}`).toBeTruthy();

      // After the interruption: every collection is either its original text or a version 2 text
      // with the same items, and a migrated collection has its backup, byte for byte.
      for (const name of NAMES) {
        const raw = storage.data.get(DATA_KEY[name]) ?? '';
        if (raw !== originals[name]) {
          const parsed = JSON.parse(raw) as { version: number; items: unknown[] };
          expect(parsed.version, `${name} at write ${String(failAt)}`).toBe(2);
          expect(parsed.items).toEqual((JSON.parse(originals[name]) as { items: unknown[] }).items);
          expect(storage.data.get(migrationBackupKey(name))).toBe(originals[name]);
        }
      }
      // New code still reads everything.
      const repositories = createLocalRepositories(storage);
      expect(await repositories.medications.list()).toHaveLength(2);
      expect(await repositories.appointments.list()).toHaveLength(1);

      // The next start finishes the work and verifies every backup.
      const next = migrateStorage(storage, clock);
      for (const name of NAMES) {
        const result = resultOf(next, name);
        expect(['migrated', 'already-migrated'], `${name} at write ${String(failAt)}`).toContain(
          result.status,
        );
        expect(result).toMatchObject({ verification: VERIFIED });
        expect(storage.data.get(migrationBackupKey(name))).toBe(originals[name]);
      }
    }
  });

  it('after the rewrite but before the verification: the next start keeps the backup byte for byte, writes nothing to it, and verifies it', () => {
    const { storage, originals } = seededV1();
    const interrupted = migrateWithoutVerification(storage);
    for (const name of NAMES) {
      expect(resultOf(interrupted, name)).toEqual({
        status: 'migrated',
        verification: notVerified('entry-not-written'),
      });
    }
    const backupsBefore = BACKUP_KEYS.map((key) => storage.data.get(key));
    const writesBefore = storage.writes.length;

    const next = migrateStorage(storage, clock);

    for (const name of NAMES) {
      expect(resultOf(next, name)).toEqual({ status: 'already-migrated', verification: VERIFIED });
      expect(storage.data.get(migrationBackupKey(name))).toBe(originals[name]);
    }
    expect(BACKUP_KEYS.map((key) => storage.data.get(key))).toEqual(backupsBefore);
    // Only the provenance entries were completed; no backup was written.
    expect(storage.writes.slice(writesBefore).every((key) => key === MIGRATION_META_KEY)).toBe(
      true,
    );
    expect(backupWrites(storage).length).toBe(3);
    expect(
      Object.values(readEntries(storage)).every((entry) => entry.verifiedAt !== undefined),
    ).toBe(true);
  });
});

describe('a collection that is already version 2: its backup is never written, replaced or deleted', () => {
  function unverified(): {
    storage: FakeStorage;
    originals: Record<MigrationCollectionName, string>;
  } {
    const seeded = seededV1();
    migrateWithoutVerification(seeded.storage);
    return seeded;
  }

  function expectNothingTouched(
    storage: FakeStorage,
    writesBefore: number,
    backupsBefore: Record<string, string | undefined>,
  ) {
    // The other collections may be verified meanwhile (only their entries are written); nothing
    // else is: no data key and, above all, no backup.
    expect(storage.writes.slice(writesBefore).every((key) => key === MIGRATION_META_KEY)).toBe(
      true,
    );
    for (const key of BACKUP_KEYS) expect(storage.data.get(key)).toBe(backupsBefore[key]);
  }

  function snapshotBackups(storage: FakeStorage): Record<string, string | undefined> {
    return Object.fromEntries(BACKUP_KEYS.map((key) => [key, storage.data.get(key)]));
  }

  it('expected copy whose records equal the migrated ones: kept, and verified', () => {
    const { storage } = unverified();
    const backups = snapshotBackups(storage);

    const report = migrateStorage(storage, clock);

    expect(resultOf(report, 'medications')).toEqual({
      status: 'already-migrated',
      verification: VERIFIED,
    });
    expect(backupWrites(storage)).toHaveLength(3); // only the three made by the migration itself
    for (const key of BACKUP_KEYS) expect(storage.data.get(key)).toBe(backups[key]);
  });

  it('expected copy but the records were edited since: kept, reported as changed since, not verified, nothing written', async () => {
    const { storage } = unverified();
    await createLocalRepositories(storage).medications.create(
      makeMedication({ id: 'm-3', name: 'Dodany' }),
    );
    const writes = storage.writes.length;
    const backups = snapshotBackups(storage);

    const report = migrateStorage(storage, clock);

    expect(resultOf(report, 'medications')).toEqual({
      status: 'already-migrated',
      verification: notVerified('changed-since'),
    });
    expectNothingTouched(storage, writes, backups);
  });

  const unusable: [string, (storage: FakeStorage) => void][] = [
    [
      'the same length and the same number of records but another text',
      (storage) => {
        const key = migrationBackupKey('medications');
        storage.data.set(key, (storage.data.get(key) ?? '').replace('Lek A', 'Lek Z'));
      },
    ],
    [
      'a different length',
      (storage) => {
        const key = migrationBackupKey('medications');
        storage.data.set(key, `${storage.data.get(key) ?? ''} `);
      },
    ],
    [
      'text that is not JSON',
      (storage) => storage.data.set(migrationBackupKey('medications'), 'garbage'),
    ],
    [
      'a version it does not know',
      (storage) => {
        const key = migrationBackupKey('medications');
        storage.data.set(key, (storage.data.get(key) ?? '').replace('"version":1', '"version":3'));
      },
    ],
    [
      'an entry whose fingerprint does not match',
      (storage) => {
        const entries = readEntries(storage);
        entries.medications = { ...entryOf(storage, 'medications'), sha256: 'f'.repeat(64) };
        storage.data.set(MIGRATION_META_KEY, JSON.stringify({ version: 1, entries }));
      },
    ],
    [
      'an entry whose record count does not match',
      (storage) => {
        const entries = readEntries(storage);
        entries.medications = { ...entryOf(storage, 'medications'), items: 99 };
        storage.data.set(MIGRATION_META_KEY, JSON.stringify({ version: 1, entries }));
      },
    ],
  ];

  it.each(unusable)(
    'a backup with %s: kept as it is, reported as unusable, never replaced',
    (_name, tamper) => {
      const { storage } = unverified();
      tamper(storage);
      const writes = storage.writes.length;
      const backups = snapshotBackups(storage);
      const meta = storage.data.get(MIGRATION_META_KEY);
      const usable = metaIsUsable(storage);
      const entryBefore = readEntries(storage).medications;

      const report = migrateStorage(storage, clock);

      expect(resultOf(report, 'medications')).toEqual({
        status: 'already-migrated',
        verification: notVerified('backup-unusable'),
      });
      expectNothingTouched(storage, writes, backups);
      // The entry of this collection is untouched; a meta that cannot be used is not rewritten.
      expect(readEntries(storage).medications).toEqual(entryBefore);
      if (!usable || meta === undefined) expect(storage.data.get(MIGRATION_META_KEY)).toBe(meta);
    },
  );

  it('a missing backup: reported, nothing recreated', () => {
    const { storage } = unverified();
    storage.data.delete(migrationBackupKey('medications'));
    const writes = storage.writes.length;

    const report = migrateStorage(storage, clock);

    expect(resultOf(report, 'medications')).toEqual({
      status: 'already-migrated',
      verification: notVerified('backup-missing'),
    });
    expect(storage.writes.slice(writes).every((key) => key === MIGRATION_META_KEY)).toBe(true);
    expect(storage.data.has(migrationBackupKey('medications'))).toBe(false);
    expect(readEntries(storage).medications?.verifiedAt).toBeUndefined();
  });

  const unknownOrigin: [string, (storage: FakeStorage) => void][] = [
    ['no meta at all', (storage) => storage.data.delete(MIGRATION_META_KEY)],
    ['meta that is not JSON', (storage) => storage.data.set(MIGRATION_META_KEY, '{broken')],
    [
      'meta of an unknown version',
      (storage) => storage.data.set(MIGRATION_META_KEY, '{"version":2,"entries":{}}'),
    ],
    [
      'an entry without a fingerprint',
      (storage) => {
        const entries = readEntries(storage);
        const withoutFingerprint = { ...entryOf(storage, 'medications') };
        delete withoutFingerprint.sha256;
        entries.medications = withoutFingerprint;
        storage.data.set(MIGRATION_META_KEY, JSON.stringify({ version: 1, entries }));
      },
    ],
  ];

  it.each(unknownOrigin)(
    '%s: the backup is kept as it is, its origin is reported as unknown, nothing is written',
    (_name, tamper) => {
      const { storage } = unverified();
      tamper(storage);
      const writes = storage.writes.length;
      const backups = snapshotBackups(storage);
      const meta = storage.data.get(MIGRATION_META_KEY);
      const usable = metaIsUsable(storage);
      const entryBefore = readEntries(storage).medications;

      const report = migrateStorage(storage, clock);

      expect(resultOf(report, 'medications')).toEqual({
        status: 'already-migrated',
        verification: notVerified('origin-unknown'),
      });
      expectNothingTouched(storage, writes, backups);
      // The entry of this collection is untouched; a meta that cannot be used is not rewritten.
      expect(readEntries(storage).medications).toEqual(entryBefore);
      if (!usable || meta === undefined) expect(storage.data.get(MIGRATION_META_KEY)).toBe(meta);
    },
  );

  it('a collection that is verified is left alone completely, whatever happens to its backup', () => {
    const { storage } = seededV1();
    migrateStorage(storage, clock);
    storage.data.delete(migrationBackupKey('medications'));
    storage.data.set(migrationBackupKey('dose-logs'), 'garbage');
    const writes = storage.writes.length;

    const report = migrateStorage(storage, clock);

    expect(resultOf(report, 'medications').status).toBe('already-migrated');
    expect(storage.writes).toHaveLength(writes);
    expect(storage.data.has(migrationBackupKey('medications'))).toBe(false);
    expect(storage.data.get(migrationBackupKey('dose-logs'))).toBe('garbage');
  });

  it('a backup left behind for an absent collection is not touched or deleted', () => {
    const storage = createFakeStorage({ [migrationBackupKey('appointments')]: 'left behind' });

    const report = migrateStorage(storage, clock);

    expect(resultOf(report, 'appointments')).toEqual({ status: 'absent' });
    expect(storage.data.get(migrationBackupKey('appointments'))).toBe('left behind');
    expect(storage.writes).toEqual([]);
  });

  it('a damaged collection never causes a write to any backup', () => {
    const { storage } = seededV1();
    storage.data.set(STORAGE_KEYS.medications, '{"version":2,"items":[{"id":1}]}');
    storage.data.set(migrationBackupKey('medications'), 'kept');

    migrateStorage(storage, clock);

    expect(storage.data.get(migrationBackupKey('medications'))).toBe('kept');
    expect(backupWrites(storage)).not.toContain(migrationBackupKey('medications'));
  });
});

describe('a collection that is still version 1: the backup is written or replaced from the text about to be rewritten', () => {
  const preparedBackups: [string, (original: string) => string | null][] = [
    ['an older valid version 1 text', () => '{"version":1,"items":[]}'],
    ['text that is not JSON', () => 'garbage'],
    ['nothing', () => null],
  ];

  it.each(preparedBackups)(
    'with %s already stored under the backup key: replaced by the original',
    (_name, make) => {
      const { storage, originals } = seededV1();
      const stale = make(originals.medications);
      if (stale !== null) storage.data.set(migrationBackupKey('medications'), stale);
      storage.data.set(
        MIGRATION_META_KEY,
        JSON.stringify({
          version: 1,
          entries: {
            medications: {
              backedUpAt: 'x',
              characters: 1,
              items: 0,
              unknownFieldRecords: 0,
              sha256: 'a'.repeat(64),
            },
          },
        }),
      );

      const report = migrateStorage(storage, clock);

      expect(resultOf(report, 'medications')).toEqual({
        status: 'migrated',
        verification: VERIFIED,
      });
      expect(storage.data.get(migrationBackupKey('medications'))).toBe(originals.medications);
      expect(readEntries(storage).medications?.sha256).toBe(sha256Hex(originals.medications));
    },
  );

  it('with a backup that already equals the original: nothing is written to the backup', () => {
    const { storage, originals } = seededV1();
    storage.data.set(migrationBackupKey('medications'), originals.medications);

    migrateStorage(storage, clock);

    expect(backupWrites(storage)).not.toContain(migrationBackupKey('medications'));
    expect(storage.data.get(migrationBackupKey('medications'))).toBe(originals.medications);
  });

  it('replaces an unreadable meta by a new one and still ends with an entry for every collection', () => {
    const { storage } = seededV1();
    storage.data.set(MIGRATION_META_KEY, '{broken');

    migrateStorage(storage, clock);

    expect(Object.keys(readEntries(storage)).sort()).toEqual([
      'appointments',
      'dose-logs',
      'medications',
    ]);
  });

  it('records a legacy-only change: any earlier verifiedAt is dropped when the entry is written again', () => {
    const { storage, originals } = seededV1();
    migrateStorage(storage, clock);
    // Restore by hand to version 1: the collection is pending again.
    storage.data.set(STORAGE_KEYS.medications, originals.medications);

    migrateStorage(storage, clock);

    const entry = readEntries(storage).medications;
    expect(entry?.verifiedAt).toBe('2026-10-15T10:00:00.000Z');
    expect(entry?.sha256).toBe(sha256Hex(originals.medications));
  });
});

describe('a backup that is present is never trusted merely because it is present', () => {
  it('equal to the original but with an entry that does not match it: the entry is written again from the original and verified', () => {
    const { storage, originals } = seededV1();
    storage.data.set(migrationBackupKey('medications'), originals.medications);
    storage.data.set(
      MIGRATION_META_KEY,
      JSON.stringify({
        version: 1,
        entries: {
          medications: {
            backedUpAt: 'x',
            characters: 1,
            items: 1,
            unknownFieldRecords: 0,
            sha256: 'c'.repeat(64),
          },
        },
      }),
    );

    const report = migrateStorage(storage, clock);

    expect(resultOf(report, 'medications')).toEqual({ status: 'migrated', verification: VERIFIED });
    expect(backupWrites(storage)).not.toContain(migrationBackupKey('medications'));
    expect(readEntries(storage).medications?.sha256).toBe(sha256Hex(originals.medications));
  });

  it('a backup that does not read back as written: that collection stops and is not rewritten', () => {
    const { storage, originals } = seededV1();
    const hooked = instrument(storage, {
      transform: (key, value) => (key === migrationBackupKey('medications') ? `${value} ` : value),
    });

    const report = migrateStorage(hooked, clock);

    expect(resultOf(report, 'medications')).toMatchObject({
      status: 'failed',
      reason: 'backup-failed',
    });
    expect(storage.data.get(STORAGE_KEYS.medications)).toBe(originals.medications);
    expect(readEntries(storage).medications).toBeUndefined();
  });
});

describe('nothing is ever deleted', () => {
  it('no migration, verification or restore removes a key', () => {
    removals.length = 0;
    const { storage } = seededV1();
    const hooked = instrument(storage);
    migrateStorage(hooked, clock);
    migrateStorage(hooked, clock);
    storage.data.set(migrationBackupKey('medications'), 'garbage');
    migrateStorage(hooked, clock);
    restoreMigrationBackup(hooked, 'dose-logs', { confirmLoseChangesSinceMigration: true });
    migrateStorage(hooked, clock);
    const failing = seededV1();
    migrateStorage(
      instrument(failing.storage, {
        failWhen: (_k, _v, count) => (count % 3 === 0 ? new Error('x') : undefined),
      }),
      clock,
    );

    expect(removals).toEqual([]);
  });
});

describe('when the migration of a collection cannot continue', () => {
  it('no room for the backup: that collection stops, stays version 1 and readable, writes to it are refused, nothing is deleted, the others migrate', async () => {
    const { storage, originals } = seededV1();
    const noRoom = instrument(storage, {
      failWhen: (key) => (key === migrationBackupKey('dose-logs') ? createQuotaError() : undefined),
    });

    const report = migrateStorage(noRoom, clock);

    expect(resultOf(report, 'dose-logs')).toEqual({
      status: 'failed',
      reason: 'backup-failed',
      storageFull: true,
    });
    expect(storage.data.get(STORAGE_KEYS.doseLogs)).toBe(originals['dose-logs']);
    expect(storage.data.has(migrationBackupKey('dose-logs'))).toBe(false);
    expect(resultOf(report, 'medications').status).toBe('migrated');
    expect(resultOf(report, 'appointments').status).toBe('migrated');
    expect(migrationNeedsAttention(report)).toBe(true);

    const repositories = createLocalRepositories(storage);
    expect(
      await repositories.doseLogs.listByDateRange(
        makeDoseLog().scheduledDate,
        makeDoseLog().scheduledDate,
      ),
    ).toHaveLength(2);
    await expect(
      repositories.doseLogs.upsert(
        makeDoseLog({ id: 'l-9', medicationId: 'm-1', scheduledTime: asLocalTime('15:00') }),
      ),
    ).rejects.toMatchObject({ code: 'migration-required' });
  });

  it('no room for the entry: the collection stops before the rewrite, and the backup written for it stays', () => {
    const { storage, originals } = seededV1();
    const noRoom = instrument(storage, {
      failWhen: (key) => (key === MIGRATION_META_KEY ? createQuotaError() : undefined),
    });

    const report = migrateStorage(noRoom, clock);

    for (const name of NAMES) {
      expect(resultOf(report, name)).toEqual({
        status: 'failed',
        reason: 'backup-failed',
        storageFull: true,
      });
      expect(storage.data.get(DATA_KEY[name])).toBe(originals[name]);
    }
  });

  it('there is no path that migrates without a backup: with every backup write refused nothing is rewritten', () => {
    const { storage, originals } = seededV1();
    const refusing = instrument(storage, {
      failWhen: (key) => (BACKUP_KEYS.includes(key) ? new Error('refused') : undefined),
    });

    const report = migrateStorage(refusing, clock);

    for (const name of NAMES) {
      expect(resultOf(report, name)).toMatchObject({
        status: 'failed',
        reason: 'backup-failed',
        storageFull: false,
      });
      expect(storage.data.get(DATA_KEY[name])).toBe(originals[name]);
    }
  });

  it('a storage that cannot be read: reported, nothing written', () => {
    const storage = createFakeStorage();
    storage.failReads();

    const report = migrateStorage(storage, clock);

    for (const name of NAMES) {
      expect(resultOf(report, name)).toMatchObject({
        status: 'failed',
        reason: 'storage-unavailable',
      });
    }
    expect(storage.writes).toEqual([]);
  });

  it('another tab changes the collection once while it is being migrated: it is read again, and the backup follows the newer text', () => {
    const { storage } = seededV1();
    let changed = false;
    const hooked = instrument(storage, {
      afterSet: (key) => {
        if (key === migrationBackupKey('medications') && !changed) {
          changed = true;
          const items = frozenRead(createFakeStorageWith(storage), frozenMedications);
          frozenWrite(storage, frozenMedications, [
            ...items,
            makeMedication({ id: 'from-other-tab', name: 'Inna karta' }),
          ]);
        }
      },
    });

    const report = migrateStorage(hooked, clock);

    expect(resultOf(report, 'medications')).toEqual({ status: 'migrated', verification: VERIFIED });
    expect(storage.data.get(STORAGE_KEYS.medications)).toContain('from-other-tab');
    // The backup was replaced, because the original was still version 1 and is what got rewritten.
    expect(storage.data.get(migrationBackupKey('medications'))).toContain('from-other-tab');
  });

  it('another tab keeps changing it: after three attempts it stops, still version 1, and says why', () => {
    const { storage } = seededV1();
    let counter = 0;
    const hooked = instrument(storage, {
      afterSet: (key) => {
        if (key === migrationBackupKey('medications')) {
          counter += 1;
          const items = frozenRead(createFakeStorageWith(storage), frozenMedications);
          frozenWrite(storage, frozenMedications, [
            ...items,
            makeMedication({ id: `other-${String(counter)}`, name: `Karta ${String(counter)}` }),
          ]);
        }
      },
    });

    const report = migrateStorage(hooked, clock);

    expect(resultOf(report, 'medications')).toMatchObject({
      status: 'failed',
      reason: 'changed-concurrently',
    });
    expect(JSON.parse(storage.data.get(STORAGE_KEYS.medications) ?? '')).toMatchObject({
      version: 1,
    });
    expect(counter).toBe(3);
  });

  it('a rewrite that does not read back as written: the old text is put back and it is reported', () => {
    const { storage, originals } = seededV1();
    const hooked = instrument(storage, {
      transform: (key, value) =>
        key === STORAGE_KEYS.medications && value.includes('"version":2')
          ? value.replace('Lek B', 'Lek X')
          : value,
    });

    const report = migrateStorage(hooked, clock);

    expect(resultOf(report, 'medications')).toMatchObject({
      status: 'failed',
      reason: 'verification-failed',
    });
    expect(storage.data.get(STORAGE_KEYS.medications)).toBe(originals.medications);
    expect(storage.data.get(migrationBackupKey('medications'))).toBe(originals.medications);
  });

  it('the backup changes between the entry and the confirmation: reported as changed, not verified, and never rewritten', () => {
    const { storage } = seededV1();
    const hooked = instrument(storage, {
      afterSet: (key, value) => {
        if (key === STORAGE_KEYS.medications && value.includes('"version":2')) {
          storage.data.set(migrationBackupKey('medications'), 'someone else wrote this');
        }
      },
    });

    const report = migrateStorage(hooked, clock);

    expect(resultOf(report, 'medications')).toEqual({
      status: 'migrated',
      verification: notVerified('backup-changed'),
    });
    expect(storage.data.get(migrationBackupKey('medications'))).toBe('someone else wrote this');
    expect(readEntries(storage).medications?.verifiedAt).toBeUndefined();
  });

  it('the entry is replaced between steps 3 and 7: not verified', () => {
    const { storage } = seededV1();
    const hooked = instrument(storage, {
      afterSet: (key, value) => {
        if (key === STORAGE_KEYS.medications && value.includes('"version":2')) {
          const entries = readEntries(storage);
          entries.medications = { ...entryOf(storage, 'medications'), sha256: 'b'.repeat(64) };
          storage.data.set(MIGRATION_META_KEY, JSON.stringify({ version: 1, entries }));
        }
      },
    });

    const report = migrateStorage(hooked, clock);

    expect(resultOf(report, 'medications')).toEqual({
      status: 'migrated',
      verification: notVerified('backup-unusable'),
    });
  });
});

describe('restoring a collection from its backup', () => {
  it('copies the backup back as version 1, leaves the backup and its entry alone, and the next start migrates it again', () => {
    const { storage, originals } = seededV1();
    migrateStorage(storage, clock);
    const backup = storage.data.get(migrationBackupKey('medications'));
    const meta = storage.data.get(MIGRATION_META_KEY);
    const usable = metaIsUsable(storage);
    const entryBefore = readEntries(storage).medications;

    const result = restoreMigrationBackup(storage, 'medications', {
      confirmLoseChangesSinceMigration: true,
    });

    expect(result).toEqual({ ok: true });
    expect(storage.data.get(STORAGE_KEYS.medications)).toBe(originals.medications);
    expect(storage.data.get(migrationBackupKey('medications'))).toBe(backup);
    // The entry of this collection is untouched; a meta that cannot be used is not rewritten.
    expect(readEntries(storage).medications).toEqual(entryBefore);
    if (!usable || meta === undefined) expect(storage.data.get(MIGRATION_META_KEY)).toBe(meta);

    const again = migrateStorage(storage, clock);
    expect(resultOf(again, 'medications')).toEqual({ status: 'migrated', verification: VERIFIED });
  });

  it('refuses without the statement that later changes will be lost, and changes nothing', () => {
    const { storage } = seededV1();
    migrateStorage(storage, clock);
    const writes = storage.writes.length;

    expect(
      restoreMigrationBackup(storage, 'medications', { confirmLoseChangesSinceMigration: false }),
    ).toEqual({
      ok: false,
      reason: 'not-confirmed',
    });
    expect(storage.writes).toHaveLength(writes);
  });

  it('refuses a missing, unrecognised or inconsistent backup', () => {
    const { storage } = seededV1();
    migrateStorage(storage, clock);
    const key = migrationBackupKey('medications');
    const good = storage.data.get(key) ?? '';

    storage.data.delete(key);
    expect(
      restoreMigrationBackup(storage, 'medications', { confirmLoseChangesSinceMigration: true }),
    ).toEqual({
      ok: false,
      reason: 'backup-missing',
    });
    storage.data.set(key, 'garbage');
    expect(
      restoreMigrationBackup(storage, 'medications', { confirmLoseChangesSinceMigration: true }),
    ).toEqual({
      ok: false,
      reason: 'backup-unusable',
    });
    storage.data.set(key, good.replace('Lek A', 'Lek Z'));
    expect(
      restoreMigrationBackup(storage, 'medications', { confirmLoseChangesSinceMigration: true }),
    ).toEqual({
      ok: false,
      reason: 'backup-unusable',
    });
    expect(JSON.parse(storage.data.get(STORAGE_KEYS.medications) ?? '')).toMatchObject({
      version: 2,
    });
  });

  it('restores a backup of unknown origin only with an extra, explicit statement', () => {
    const { storage, originals } = seededV1();
    migrateStorage(storage, clock);
    storage.data.delete(MIGRATION_META_KEY);

    expect(
      restoreMigrationBackup(storage, 'medications', { confirmLoseChangesSinceMigration: true }),
    ).toEqual({
      ok: false,
      reason: 'origin-not-accepted',
    });
    expect(
      restoreMigrationBackup(storage, 'medications', {
        confirmLoseChangesSinceMigration: true,
        acceptUnverifiedOrigin: true,
      }),
    ).toEqual({ ok: true });
    expect(storage.data.get(STORAGE_KEYS.medications)).toBe(originals.medications);
  });

  it('puts the previous text back when the restored text does not read back equal', () => {
    const { storage } = seededV1();
    migrateStorage(storage, clock);
    const migrated = storage.data.get(STORAGE_KEYS.medications);
    let first = true;
    const hooked = instrument(storage, {
      // Only the first write of the restored text is altered; putting the old text back is not.
      transform: (key, value) => {
        if (key !== STORAGE_KEYS.medications || !first) return value;
        first = false;
        return `${value} `;
      },
    });

    const result = restoreMigrationBackup(hooked, 'medications', {
      confirmLoseChangesSinceMigration: true,
    });

    expect(result).toEqual({ ok: false, reason: 'verification-failed' });
    expect(storage.data.get(STORAGE_KEYS.medications)).toBe(migrated);
  });
});

describe('the migration as the application holds it', () => {
  it('reports nothing before it has run, then the result of each run', () => {
    const { storage } = seededV1();
    const migration = createStorageMigration(storage, clock);
    expect(migration.current().collections).toEqual([]);

    const report = migration.run();

    expect(migration.current()).toBe(report);
    expect(report.collections.map((entry) => entry.collection)).toEqual(NAMES);
    expect(migrationNeedsAttention(report)).toBe(false);
  });

  it('can be run again after a failure and then succeeds', () => {
    const { storage } = seededV1();
    storage.failWrites(createQuotaError(), (key) => key === migrationBackupKey('medications'));
    const migration = createStorageMigration(storage, clock);
    expect(migrationNeedsAttention(migration.run())).toBe(true);

    storage.heal();
    const retried = migration.run();

    expect(migrationNeedsAttention(retried)).toBe(false);
    expect(resultOf(retried, 'medications').status).toBe('migrated');
  });

  it('reading never migrates and never writes', async () => {
    const { storage } = seededV1();
    const repositories = createLocalRepositories(storage);

    await repositories.medications.list();
    await repositories.appointments.list();
    await repositories.doseLogs.listByDateRange(
      makeDoseLog().scheduledDate,
      makeDoseLog().scheduledDate,
    );

    expect(storage.writes).toEqual([]);
  });
});
