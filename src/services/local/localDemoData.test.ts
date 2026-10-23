import { describe, expect, it } from 'vitest';
import { createFixedClock } from '@/utils/clock';
import { asLocalDate, asTimestamp as asTimestampForTest } from '@/utils/date';
import { createFakeStorage, createQuotaError, type FakeStorage } from '@/test/fakeStorage';
import { makeMedication, makeStockEvent } from '@/test/fixtures';
import { createDemoData, isDemoId } from '../demo/demoData';
import { RepositoryError } from '../errors';
import { STORAGE_KEYS } from './collections';
import { createLocalServices } from './createLocalServices';

const INSTANT = '2026-10-15T10:00:00Z';
const TIME_ZONE = 'Europe/Warsaw';
const dataKeys = [
  STORAGE_KEYS.medications,
  STORAGE_KEYS.doseLogs,
  STORAGE_KEYS.appointments,
  STORAGE_KEYS.stockEvents,
];

function setup(storage: FakeStorage = createFakeStorage()) {
  const services = createLocalServices({
    storage,
    clock: createFixedClock(INSTANT),
    timeZone: TIME_ZONE,
  });
  return { storage, ...services };
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

function snapshot(storage: FakeStorage): Record<string, string | undefined> {
  return Object.fromEntries(
    [...dataKeys, STORAGE_KEYS.backup].map((key) => [key, storage.data.get(key)]),
  );
}

describe('nothing is ever loaded or reset implicitly', () => {
  it('reading empty storage leaves it empty', async () => {
    const { storage, repositories } = setup();

    await repositories.medications.list();
    await repositories.appointments.list();

    expect(storage.data.size).toBe(0);
  });

  it('writing ordinary data does not bring demo data along', async () => {
    const { storage, repositories } = setup();

    await repositories.medications.create(makeMedication({ id: 'mine-1' }));

    expect((await repositories.medications.list()).map((medication) => medication.id)).toEqual([
      'mine-1',
    ]);
    expect(await repositories.appointments.list()).toEqual([]);
    expect([...storage.data.keys()]).toEqual([STORAGE_KEYS.medications]);
  });
});

describe('loadDemoData', () => {
  it('fills empty storage with the demo data, readable through the repositories', async () => {
    const { repositories, demoData } = setup();

    await demoData.loadDemoData();

    const expected = createDemoData({ now: createFixedClock(INSTANT).now(), timeZone: TIME_ZONE });
    expect((await repositories.medications.list()).map((m) => m.id).sort()).toEqual(
      expected.medications.map((m) => m.id).sort(),
    );
    expect(await repositories.appointments.list()).toHaveLength(expected.appointments.length);
    const logs = await repositories.doseLogs.listByDateRange(
      asLocalDate('2026-01-01'),
      asLocalDate('2026-12-31'),
    );
    expect(logs).toHaveLength(expected.doseLogs.length);
  });

  it('writes the same data every time for the same clock', async () => {
    const first = setup();
    const second = setup();

    await first.demoData.loadDemoData();
    await second.demoData.loadDemoData();

    expect(snapshot(first.storage)).toEqual(snapshot(second.storage));
  });

  it('marks everything it stored as demo data', async () => {
    const { repositories, demoData } = setup();

    await demoData.loadDemoData();

    const medications = await repositories.medications.list();
    const appointments = await repositories.appointments.list();
    expect([...medications, ...appointments].every((item) => isDemoId(item.id))).toBe(true);
  });

  it('refuses when anything is already stored, and changes nothing', async () => {
    const { storage, demoData } = setup(
      createFakeStorage({ [STORAGE_KEYS.appointments]: '{"version":1,"items":[]}' }),
    );
    const before = snapshot(storage);

    const error = await failureOf(demoData.loadDemoData());

    expect(error.code).toBe('demo-data-not-empty');
    expect(snapshot(storage)).toEqual(before);
  });

  it('refuses even when what is stored is corrupted, rather than overwriting it', async () => {
    const { storage, demoData } = setup(
      createFakeStorage({ [STORAGE_KEYS.medications]: '{broken' }),
    );

    expect((await failureOf(demoData.loadDemoData())).code).toBe('demo-data-not-empty');
    expect(storage.data.get(STORAGE_KEYS.medications)).toBe('{broken');
  });

  it('leaves no half-loaded data behind when a write fails part-way', async () => {
    const { storage, demoData } = setup();
    storage.failWrites(createQuotaError(), (key) => key === STORAGE_KEYS.appointments);

    const error = await failureOf(demoData.loadDemoData());

    expect(error.code).toBe('storage-full');
    expect(error.detail).toBe('rolled back');
    expect(storage.data.size).toBe(0);
  });

  it('reports unreadable storage', async () => {
    const { storage, demoData } = setup();
    storage.failReads();

    expect((await failureOf(demoData.loadDemoData())).code).toBe('storage-unavailable');
  });
});

describe('resetDemoData', () => {
  it("replaces the user's data with demo data, after saving the previous contents to the backup", async () => {
    const { storage, repositories, demoData } = setup();
    await repositories.medications.create(makeMedication({ id: 'mine-1', name: 'Moj lek' }));
    const previous = storage.data.get(STORAGE_KEYS.medications);

    await demoData.resetDemoData();

    const ids = (await repositories.medications.list()).map((medication) => medication.id);
    expect(ids).not.toContain('mine-1');
    expect(ids.every(isDemoId)).toBe(true);
    const backup = JSON.parse(storage.data.get(STORAGE_KEYS.backup) ?? 'null') as {
      backedUpAt: string;
      entries: Record<string, string | null>;
    };
    expect(backup.backedUpAt).toBe('2026-10-15T10:00:00.000Z');
    expect(backup.entries[STORAGE_KEYS.medications]).toBe(previous);
    expect(backup.entries[STORAGE_KEYS.appointments]).toBeNull();
  });

  it('works on corrupted data, saving the damaged text exactly as it was', async () => {
    const damaged = '{"version":1,"items":[{"id":';
    const { storage, repositories, demoData } = setup(
      createFakeStorage({ [STORAGE_KEYS.medications]: damaged }),
    );
    expect((await failureOf(repositories.medications.list())).code).toBe('data-corrupted');

    await demoData.resetDemoData();

    expect(await repositories.medications.list()).not.toHaveLength(0);
    const backup = JSON.parse(storage.data.get(STORAGE_KEYS.backup) ?? 'null') as {
      entries: Record<string, string | null>;
    };
    expect(backup.entries[STORAGE_KEYS.medications]).toBe(damaged);
  });

  it('changes nothing if the backup cannot be written', async () => {
    const { storage, repositories, demoData } = setup();
    await repositories.medications.create(makeMedication({ id: 'mine-1' }));
    const before = snapshot(storage);

    storage.failWrites(createQuotaError(), (key) => key === STORAGE_KEYS.backup);
    const error = await failureOf(demoData.resetDemoData());

    expect(error.code).toBe('storage-full');
    expect(error.detail).toContain('nothing was changed');
    expect(snapshot(storage)).toEqual(before);
  });

  it('restores the previous data if writing the demo data fails part-way', async () => {
    const { storage, repositories, demoData } = setup();
    await repositories.medications.create(makeMedication({ id: 'mine-1' }));
    const before = storage.data.get(STORAGE_KEYS.medications);

    storage.failWrites(createQuotaError(), (key) => key === STORAGE_KEYS.doseLogs);
    const error = await failureOf(demoData.resetDemoData());

    expect(error.detail).toBe('rolled back');
    expect(storage.data.get(STORAGE_KEYS.medications)).toBe(before);
    expect(storage.data.has(STORAGE_KEYS.doseLogs)).toBe(false);
  });

  it('keeps only the most recent previous state in the backup', async () => {
    const { storage, demoData } = setup();
    await demoData.loadDemoData();
    const firstDemo = storage.data.get(STORAGE_KEYS.medications);

    await demoData.resetDemoData();

    const backup = JSON.parse(storage.data.get(STORAGE_KEYS.backup) ?? 'null') as {
      entries: Record<string, string | null>;
    };
    expect(backup.entries[STORAGE_KEYS.medications]).toBe(firstDemo);
  });

  it('does not use the backup key as data: it is never read by the repositories', async () => {
    const { repositories, demoData } = setup();
    await demoData.resetDemoData();
    await demoData.resetDemoData();

    expect(
      (await repositories.medications.list()).every((medication) => isDemoId(medication.id)),
    ).toBe(true);
  });
});

describe('the stock events and the demo data', () => {
  it('loads demo stock events too, readable through the repository, all marked as demo data', async () => {
    const { storage, repositories, demoData } = setup();

    await demoData.loadDemoData();

    const events = await repositories.stockEvents.list();
    expect(events.length).toBeGreaterThan(0);
    expect(events.every((event) => isDemoId(event.id))).toBe(true);
    expect(storage.data.has(STORAGE_KEYS.stockEvents)).toBe(true);
    // The events belong to demo medications that exist.
    const medicationIds = new Set((await repositories.medications.list()).map((m) => m.id));
    expect(events.every((event) => medicationIds.has(event.medicationId))).toBe(true);
  });

  it('refuses to load when only the stock events are stored, rather than mixing them with demo data', async () => {
    const { storage, demoData } = setup(
      createFakeStorage({
        [STORAGE_KEYS.stockEvents]: JSON.stringify({ version: 2, items: [] }),
      }),
    );
    const before = snapshot(storage);

    const error = await failureOf(demoData.loadDemoData());

    expect(error.code).toBe('demo-data-not-empty');
    expect(snapshot(storage)).toEqual(before);
  });

  it('leaves no half-loaded data behind when writing the stock events fails', async () => {
    const { storage, demoData } = setup();

    storage.failWrites(createQuotaError(), (key) => key === STORAGE_KEYS.stockEvents);
    const error = await failureOf(demoData.loadDemoData());

    expect(error.detail).toBe('rolled back');
    for (const key of dataKeys) expect(storage.data.has(key)).toBe(false);
  });

  it("replaces the user's own events on reset, after saving them verbatim to the backup", async () => {
    const { storage, repositories, demoData } = setup();
    await repositories.medications.create(
      makeMedication({
        id: 'mine-1',
        stock: { quantity: 5, unit: 'tabletka', asOf: asTimestampForTest('2026-10-01T08:00:00Z') },
      }),
    );
    await repositories.stockEvents.append(
      makeStockEvent({ id: 'my-event', medicationId: 'mine-1' }),
    );
    const previousEvents = storage.data.get(STORAGE_KEYS.stockEvents);

    await demoData.resetDemoData();

    const events = await repositories.stockEvents.list();
    expect(events.map((event) => event.id)).not.toContain('my-event');
    expect(events.every((event) => isDemoId(event.id))).toBe(true);
    const backup = JSON.parse(storage.data.get(STORAGE_KEYS.backup) ?? 'null') as {
      entries: Record<string, string | null>;
    };
    expect(backup.entries[STORAGE_KEYS.stockEvents]).toBe(previousEvents);
    expect(previousEvents).toContain('my-event');
  });

  it('records a missing stock events key in the backup as null', async () => {
    const { storage, demoData } = setup();

    await demoData.resetDemoData();

    const backup = JSON.parse(storage.data.get(STORAGE_KEYS.backup) ?? 'null') as {
      entries: Record<string, string | null>;
    };
    expect(STORAGE_KEYS.stockEvents in backup.entries).toBe(true);
    expect(backup.entries[STORAGE_KEYS.stockEvents]).toBeNull();
  });

  it('restores the previous events if writing the demo data fails after them', async () => {
    const { storage, repositories, demoData } = setup();
    await repositories.medications.create(
      makeMedication({
        id: 'mine-1',
        stock: { quantity: 5, unit: 'tabletka', asOf: asTimestampForTest('2026-10-01T08:00:00Z') },
      }),
    );
    await repositories.stockEvents.append(
      makeStockEvent({ id: 'my-event', medicationId: 'mine-1' }),
    );
    const before = snapshot(storage);

    // The stock events are written last: a refusal there must undo the three writes before it.
    storage.failWrites(createQuotaError(), (key) => key === STORAGE_KEYS.stockEvents);
    const error = await failureOf(demoData.resetDemoData());

    expect(error.detail).toBe('rolled back');
    const after = snapshot(storage);
    for (const key of dataKeys) expect(after[key]).toBe(before[key]);
  });
});
