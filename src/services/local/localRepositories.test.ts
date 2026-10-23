import { describe, expect, it } from 'vitest';
import { asLocalDate, asTimestamp } from '@/utils/date';
import { createFakeStorage, createQuotaError } from '@/test/fakeStorage';
import {
  makeAppointment,
  makeDoseLog,
  makeMedication,
  makeStockEvent,
  scheduleTime,
} from '@/test/fixtures';
import { describeRepositoryContract } from '../contract/repositoryContract';
import { RepositoryError } from '../errors';
import { STORAGE_KEYS } from './collections';
import { createLocalRepositories } from './localRepositories';

const TODAY = asLocalDate('2026-10-15');
const wholeRange = [asLocalDate('2000-01-01'), asLocalDate('2999-12-31')] as const;

// 1. Everything every repository implementation must do (the shared contract).
describeRepositoryContract('localStorage implementation', () => {
  const storage = createFakeStorage();
  const open = () => createLocalRepositories(storage);
  return { repositories: open(), reopen: open };
});

// 2. What is specific to keeping data in browser storage.

function envelope(items: unknown[], version = 1): string {
  return JSON.stringify({ version, items });
}

async function failureOf(promise: Promise<unknown>): Promise<RepositoryError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof RepositoryError) return error;
    throw error;
  }
  throw new Error('Expected the operation to fail, but it succeeded');
}

describe('local storage layout', () => {
  it('reading from empty storage returns empty lists and writes nothing', async () => {
    const storage = createFakeStorage();
    const repositories = createLocalRepositories(storage);

    expect(await repositories.medications.list()).toEqual([]);
    expect(await repositories.appointments.list()).toEqual([]);
    expect(await repositories.doseLogs.listByDateRange(...wholeRange)).toEqual([]);

    expect(storage.writes).toEqual([]);
    expect(storage.data.size).toBe(0);
  });

  it('keeps each kind of record under its own versioned key', async () => {
    const storage = createFakeStorage();
    const repositories = createLocalRepositories(storage);

    await repositories.medications.create(makeMedication({ id: 'm-1' }));
    expect([...storage.data.keys()]).toEqual([STORAGE_KEYS.medications]);
    // Version 2 is what is written since the storage migration (PROJECT_SPEC §10.5).
    expect(JSON.parse(storage.data.get(STORAGE_KEYS.medications) ?? '')).toMatchObject({
      version: 2,
    });

    await repositories.appointments.create(makeAppointment({ id: 'a-1' }));
    expect([...storage.data.keys()].sort()).toEqual(
      [STORAGE_KEYS.appointments, STORAGE_KEYS.medications].sort(),
    );
  });

  it('does not rewrite a collection that an operation did not change', async () => {
    const storage = createFakeStorage();
    const repositories = createLocalRepositories(storage);
    await repositories.medications.create(makeMedication({ id: 'm-1' }));
    const writesBefore = storage.writes.length;

    await repositories.appointments.create(makeAppointment({ id: 'a-1' }));
    await repositories.doseLogs.remove({
      medicationId: 'm-1',
      date: TODAY,
      time: makeDoseLog().scheduledTime,
    });

    expect(storage.writes.slice(writesBefore)).toEqual([STORAGE_KEYS.appointments]);
  });
});

describe('corrupted or foreign stored data', () => {
  const valid = makeMedication({ id: 'm-1' });
  const validLog = makeDoseLog({ id: 'l-1' });
  const validAppointment = makeAppointment({ id: 'a-1' });

  // [description, stored text, key, part of the problem path expected in the error detail]
  const cases: [string, string, string, string][] = [
    ['text that is not JSON', '{this is not json', STORAGE_KEYS.medications, 'not valid JSON'],
    ['JSON that is not an object', '[1, 2, 3]', STORAGE_KEYS.medications, 'unexpected structure'],
    [
      'a document without a version',
      '{"items": []}',
      STORAGE_KEYS.medications,
      'unexpected structure',
    ],
    [
      'items that are not a list',
      '{"version": 1, "items": "x"}',
      STORAGE_KEYS.medications,
      'not a list',
    ],
    ['an item that is not an object', envelope(['x']), STORAGE_KEYS.medications, 'medications[0]'],
    [
      'an unknown dosage form',
      envelope([{ ...valid, dosageForm: 'powder' }]),
      STORAGE_KEYS.medications,
      'medications[0].dosageForm',
    ],
    [
      'a strength that is half given',
      envelope([{ ...valid, strength: { value: 5 } }]),
      STORAGE_KEYS.medications,
      'medications[0].strength.unit',
    ],
    [
      'a strength of zero',
      envelope([{ ...valid, strength: { value: 0, unit: 'mg' } }]),
      STORAGE_KEYS.medications,
      'medications[0].strength.value',
    ],
    [
      'a low-stock threshold with no stock to be about',
      envelope([{ ...valid, stock: null, lowStockThreshold: { quantity: 1, unit: 'tabletka' } }]),
      STORAGE_KEYS.medications,
      'medications[0].lowStockThreshold',
    ],
    [
      'a negative low-stock threshold',
      envelope([
        {
          ...valid,
          stock: { quantity: 5, unit: 'tabletka', asOf: '2026-10-01T08:00:00.000Z' },
          lowStockThreshold: { quantity: -1, unit: 'tabletka' },
        },
      ]),
      STORAGE_KEYS.medications,
      'medications[0].lowStockThreshold.quantity',
    ],
    [
      'a missing required field',
      envelope([{ ...valid, doseUnit: undefined }]),
      STORAGE_KEYS.medications,
      'medications[0].doseUnit',
    ],
    [
      'a field of the wrong type',
      envelope([{ ...valid, name: 42 }]),
      STORAGE_KEYS.medications,
      'medications[0].name',
    ],
    [
      'an impossible date',
      envelope([{ ...valid, startDate: '2026-02-30' }]),
      STORAGE_KEYS.medications,
      'startDate',
    ],
    [
      'an invalid schedule time',
      envelope([{ ...valid, scheduleTimes: [{ id: 't', timeOfDay: '24:00', doseAmount: 1 }] }]),
      STORAGE_KEYS.medications,
      'scheduleTimes[0].timeOfDay',
    ],
    [
      'a negative stock',
      envelope([{ ...valid, stock: { quantity: -5, unit: 'tabletka', asOf: valid.createdAt } }]),
      STORAGE_KEYS.medications,
      'stock.quantity',
    ],
    [
      'two medications with the same id',
      envelope([valid, valid]),
      STORAGE_KEYS.medications,
      'medications[1]: duplicate id',
    ],
    [
      'an unknown intake status',
      envelope([{ ...validLog, status: 'forgotten' }]),
      STORAGE_KEYS.doseLogs,
      'doseLogs[0].status',
    ],
    [
      'two records in one slot',
      envelope([validLog, { ...validLog, id: 'l-2' }]),
      STORAGE_KEYS.doseLogs,
      'duplicate slot',
    ],
    [
      'an appointment with neither doctor nor specialty',
      envelope([{ ...validAppointment, doctorName: null, specialty: null }]),
      STORAGE_KEYS.appointments,
      'appointments[0]',
    ],
    [
      'an appointment with an unknown status',
      envelope([{ ...validAppointment, status: 'maybe' }]),
      STORAGE_KEYS.appointments,
      'appointments[0].status',
    ],
  ];

  it.each(cases)(
    'reports %s as corrupted and leaves it untouched',
    async (_label, stored, key, expectedPath) => {
      const storage = createFakeStorage({ [key]: stored });
      const repositories = createLocalRepositories(storage);
      const attempts: Promise<unknown>[] =
        key === STORAGE_KEYS.medications
          ? [
              repositories.medications.list(),
              repositories.medications.get('m-1'),
              repositories.medications.create(makeMedication({ id: 'new' })),
              repositories.medications.update(valid),
              repositories.medications.remove('m-1'),
            ]
          : key === STORAGE_KEYS.doseLogs
            ? [
                repositories.doseLogs.listByDateRange(...wholeRange),
                repositories.doseLogs.remove({
                  medicationId: 'm-1',
                  date: TODAY,
                  time: validLog.scheduledTime,
                }),
              ]
            : [
                repositories.appointments.list(),
                repositories.appointments.create(makeAppointment({ id: 'new' })),
                repositories.appointments.remove('a-1'),
              ];

      for (const attempt of attempts) {
        const error = await failureOf(attempt);
        expect(error.code).toBe('data-corrupted');
        expect(error.detail).toContain(expectedPath);
      }
      // Never treated as empty, never overwritten: the damaged text is exactly as it was.
      expect(storage.data.get(key)).toBe(stored);
      expect(storage.writes).toEqual([]);
    },
  );

  it('refuses data written by an unknown version and leaves it untouched', async () => {
    const stored = envelope([], 3);
    const storage = createFakeStorage({ [STORAGE_KEYS.medications]: stored });
    const repositories = createLocalRepositories(storage);

    expect((await failureOf(repositories.medications.list())).code).toBe('unsupported-version');
    expect((await failureOf(repositories.medications.create(makeMedication()))).code).toBe(
      'unsupported-version',
    );
    expect(storage.data.get(STORAGE_KEYS.medications)).toBe(stored);
  });

  it('does not let a problem in one collection break the others', async () => {
    const storage = createFakeStorage({ [STORAGE_KEYS.appointments]: '{broken' });
    const repositories = createLocalRepositories(storage);

    await repositories.medications.create(makeMedication({ id: 'm-1' }));

    expect(await repositories.medications.list()).toHaveLength(1);
    expect((await failureOf(repositories.appointments.list())).code).toBe('data-corrupted');
  });

  it('refuses to record an intake when the medications cannot be read to check the reference', async () => {
    const storage = createFakeStorage({ [STORAGE_KEYS.medications]: '{broken' });
    const repositories = createLocalRepositories(storage);

    const error = await failureOf(repositories.doseLogs.upsert(makeDoseLog({ id: 'l-1' })));

    expect(error.code).toBe('data-corrupted');
    expect(storage.writes).toEqual([]);
  });

  it('never puts stored values into error messages or details (they could be health data)', async () => {
    const secret = 'SEKRETNA-NAZWA-LEKU';
    const storage = createFakeStorage({
      [STORAGE_KEYS.medications]: envelope([
        { ...makeMedication({ id: 'm-1', name: secret }), doseUnit: 7 },
      ]),
    });
    const repositories = createLocalRepositories(storage);

    const error = await failureOf(repositories.medications.list());

    expect(error.message).not.toContain(secret);
    expect(error.detail).not.toContain(secret);
    expect(JSON.stringify(error)).not.toContain(secret);

    // Invalid JSON: the parser's own message may quote the text, so it must not be kept as the cause.
    const broken = createFakeStorage({ [STORAGE_KEYS.medications]: `{"name": "${secret}" oops` });
    const brokenError = await failureOf(createLocalRepositories(broken).medications.list());
    expect(brokenError.cause).toBeUndefined();
    expect(brokenError.message).not.toContain(secret);
  });

  it('counts leftover intake records of a medication that no longer exists', async () => {
    const storage = createFakeStorage({
      [STORAGE_KEYS.doseLogs]: envelope([makeDoseLog({ id: 'l-1', medicationId: 'gone' })]),
    });

    expect(await createLocalRepositories(storage).doseLogs.countForMedication('gone')).toBe(1);
  });

  it('reports counting on damaged or unreachable data as an error, never as 0', async () => {
    const damaged = createFakeStorage({ [STORAGE_KEYS.doseLogs]: '{broken' });
    expect(
      (await failureOf(createLocalRepositories(damaged).doseLogs.countForMedication('m-1'))).code,
    ).toBe('data-corrupted');

    const unreachable = createFakeStorage();
    unreachable.failReads();
    expect(
      (await failureOf(createLocalRepositories(unreachable).doseLogs.countForMedication('m-1')))
        .code,
    ).toBe('storage-unavailable');
  });

  it('accepts a stored intake record whose medication no longer exists (leftover history is shown, not an error)', async () => {
    const storage = createFakeStorage({
      [STORAGE_KEYS.doseLogs]: envelope([makeDoseLog({ id: 'l-1', medicationId: 'gone' })]),
    });
    const repositories = createLocalRepositories(storage);

    expect(await repositories.doseLogs.listByDateRange(...wholeRange)).toHaveLength(1);
  });

  it('normalises stored timestamps and returns clean copies', async () => {
    const storage = createFakeStorage({
      [STORAGE_KEYS.appointments]: envelope([
        { ...makeAppointment({ id: 'a-1' }), scheduledAt: '2026-10-20T10:00:00+02:00' },
      ]),
    });
    const repositories = createLocalRepositories(storage);

    expect((await repositories.appointments.get('a-1')).scheduledAt).toBe(
      '2026-10-20T08:00:00.000Z',
    );
  });
});

describe('storage failures', () => {
  it('reports storage that cannot be read as unavailable, for every kind of record', async () => {
    const storage = createFakeStorage();
    storage.failReads();
    const repositories = createLocalRepositories(storage);

    for (const attempt of [
      repositories.medications.list(),
      repositories.appointments.list(),
      repositories.doseLogs.listByDateRange(...wholeRange),
    ]) {
      expect((await failureOf(attempt)).code).toBe('storage-unavailable');
    }
  });

  it('reports a full storage and keeps the previous data', async () => {
    const storage = createFakeStorage();
    const repositories = createLocalRepositories(storage);
    await repositories.medications.create(makeMedication({ id: 'm-1' }));
    const before = storage.data.get(STORAGE_KEYS.medications);

    storage.failWrites(createQuotaError());
    const error = await failureOf(
      repositories.medications.create(makeMedication({ id: 'm-2', name: 'Drugi' })),
    );

    expect(error.code).toBe('storage-full');
    expect(storage.data.get(STORAGE_KEYS.medications)).toBe(before);
    storage.heal();
    expect(await repositories.medications.list()).toHaveLength(1);
  });

  it('reports any other refused write as a failed write, with the cause attached', async () => {
    const storage = createFakeStorage();
    const refusal = new DOMException('blocked', 'SecurityError');
    storage.failWrites(refusal);
    const repositories = createLocalRepositories(storage);

    const error = await failureOf(repositories.appointments.create(makeAppointment({ id: 'a-1' })));

    expect(error.code).toBe('storage-write-failed');
    expect(error.cause).toBe(refusal);
    expect(storage.data.size).toBe(0);
  });

  it('rolls back a medication deletion when its intake history cannot be removed', async () => {
    const storage = createFakeStorage();
    const repositories = createLocalRepositories(storage);
    await repositories.medications.create(makeMedication({ id: 'm-1' }));
    await repositories.doseLogs.upsert(makeDoseLog({ id: 'l-1', medicationId: 'm-1' }));
    const before = new Map(storage.data);

    storage.failWrites(createQuotaError(), (key) => key === STORAGE_KEYS.doseLogs);
    const error = await failureOf(repositories.medications.remove('m-1'));

    expect(error.code).toBe('storage-full');
    expect(error.detail).toBe('rolled back');
    expect(storage.data).toEqual(before);
    storage.heal();
    expect(await repositories.medications.list()).toHaveLength(1);
    expect(await repositories.doseLogs.listByDateRange(TODAY, TODAY)).toHaveLength(1);
  });

  describe('deleting a medication that has stock events (three keys)', () => {
    async function seeded() {
      const storage = createFakeStorage();
      const repositories = createLocalRepositories(storage);
      await repositories.medications.create(
        makeMedication({
          id: 'm-1',
          stock: { quantity: 10, unit: 'tabletka', asOf: asTimestamp('2026-10-01T08:00:00Z') },
        }),
      );
      await repositories.doseLogs.upsert(makeDoseLog({ id: 'l-1', medicationId: 'm-1' }));
      await repositories.stockEvents.append(makeStockEvent({ id: 'e-1', medicationId: 'm-1' }));
      return { storage, repositories };
    }

    it('removes the medication, its intake records and its events, writing each key once', async () => {
      const { storage, repositories } = await seeded();
      storage.writes.length = 0;

      await repositories.medications.remove('m-1');

      expect([...storage.writes].sort()).toEqual(
        [STORAGE_KEYS.doseLogs, STORAGE_KEYS.medications, STORAGE_KEYS.stockEvents].sort(),
      );
      expect(await repositories.stockEvents.list()).toEqual([]);
    });

    it('rolls everything back when the events cannot be removed', async () => {
      const { storage, repositories } = await seeded();
      const before = new Map(storage.data);

      storage.failWrites(createQuotaError(), (key) => key === STORAGE_KEYS.stockEvents);
      const error = await failureOf(repositories.medications.remove('m-1'));

      expect(error.code).toBe('storage-full');
      expect(error.detail).toBe('rolled back');
      expect(storage.data).toEqual(before);
      storage.heal();
      expect(await repositories.medications.list()).toHaveLength(1);
      expect(await repositories.doseLogs.listByDateRange(TODAY, TODAY)).toHaveLength(1);
      expect(await repositories.stockEvents.list()).toHaveLength(1);
    });

    it('rolls the medication back when the intake records cannot be removed, before any event is touched', async () => {
      const { storage, repositories } = await seeded();
      const before = new Map(storage.data);

      storage.failWrites(createQuotaError(), (key) => key === STORAGE_KEYS.doseLogs);
      const error = await failureOf(repositories.medications.remove('m-1'));

      expect(error.detail).toBe('rolled back');
      expect(storage.data).toEqual(before);
    });

    it('says so when the rollback of the events step fails too', async () => {
      const { storage, repositories } = await seeded();

      let medicationWrites = 0;
      storage.failWrites(
        createQuotaError(),
        (key) => key === STORAGE_KEYS.stockEvents || ++medicationWrites > 1,
      );
      const error = await failureOf(repositories.medications.remove('m-1'));

      expect(error.detail).toBe('rollback failed: data may be inconsistent');
    });

    it('does not touch the events key when the medication has none', async () => {
      const storage = createFakeStorage();
      const repositories = createLocalRepositories(storage);
      await repositories.medications.create(makeMedication({ id: 'm-1' }));
      await repositories.medications.create(makeMedication({ id: 'm-2', name: 'Inny' }));
      await repositories.stockEvents.append(makeStockEvent({ id: 'e-2', medicationId: 'm-2' }));
      storage.writes.length = 0;

      await repositories.medications.remove('m-1');

      expect(storage.writes).toEqual([STORAGE_KEYS.medications]);
    });

    it('is refused before anything is written when the events are still in the old format', async () => {
      const { storage, repositories } = await seeded();
      storage.data.set(
        STORAGE_KEYS.stockEvents,
        JSON.stringify({ version: 1, items: [makeStockEvent({ id: 'e-1', medicationId: 'm-1' })] }),
      );
      const before = new Map(storage.data);

      const error = await failureOf(repositories.medications.remove('m-1'));

      expect(error.code).toBe('migration-required');
      expect(storage.data).toEqual(before);
    });

    it('reports damaged events as an error and deletes nothing', async () => {
      const { storage, repositories } = await seeded();
      storage.data.set(STORAGE_KEYS.stockEvents, '{not json');
      const before = new Map(storage.data);

      const error = await failureOf(repositories.medications.remove('m-1'));

      expect(error.code).toBe('data-corrupted');
      expect(storage.data).toEqual(before);
    });
  });

  it('says so when even the rollback fails, instead of pretending all is well', async () => {
    const storage = createFakeStorage();
    const repositories = createLocalRepositories(storage);
    await repositories.medications.create(makeMedication({ id: 'm-1' }));
    await repositories.doseLogs.upsert(makeDoseLog({ id: 'l-1', medicationId: 'm-1' }));

    // Writing the medications succeeds once (the deletion), then storage refuses everything.
    let medicationWrites = 0;
    storage.failWrites(
      createQuotaError(),
      (key) => key === STORAGE_KEYS.doseLogs || ++medicationWrites > 1,
    );
    const error = await failureOf(repositories.medications.remove('m-1'));

    expect(error.detail).toBe('rollback failed: data may be inconsistent');
  });

  it('does not touch the intake history when deleting a medication that has none', async () => {
    const storage = createFakeStorage();
    const repositories = createLocalRepositories(storage);
    await repositories.medications.create(
      makeMedication({ id: 'm-1', scheduleTimes: [scheduleTime('a', '08:00')] }),
    );
    const writesBefore = storage.writes.length;

    await repositories.medications.remove('m-1');

    expect(storage.writes.slice(writesBefore)).toEqual([STORAGE_KEYS.medications]);
  });
});
