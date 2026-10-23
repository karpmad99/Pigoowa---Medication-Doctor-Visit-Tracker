import { describe, expect, it } from 'vitest';
import { RepositoryError } from '@/services/errors';
import type { AppServices } from '@/services/repositories';
import { createTestServices, TEST_INSTANT, TEST_TIME_ZONE } from '@/test/services';
import { makeDoseLog, makeMedication, scheduleTime } from '@/test/fixtures';
import { asLocalDate, asLocalTime, asTimestamp } from '@/utils/date';
import { applyDoseAction, applyTakenDetails, type DoseTarget } from './applyDoseAction';
import { generateScheduledDoses } from './logic/scheduledDoses';
import type { ScheduledDose } from './types';

// "Today" in these tests is 2026-10-15 (TEST_INSTANT in Europe/Warsaw).
const TODAY = asLocalDate('2026-10-15');

async function setup(medicationOverrides: Parameters<typeof makeMedication>[0] = {}) {
  const services = createTestServices();
  const medication = makeMedication({
    id: 'med-1',
    name: 'Lek A',
    scheduleTimes: [scheduleTime('t-1', '08:00', 1), scheduleTime('t-2', '20:00', 2)],
    ...medicationOverrides,
  });
  await services.repositories.medications.create(medication);
  return { services, medication };
}

async function doseAt(
  services: AppServices,
  time: string,
  date = TODAY,
  medicationId = 'med-1',
): Promise<ScheduledDose> {
  const medications = await services.repositories.medications.list();
  const doseLogs = await services.repositories.doseLogs.listByDateRange(date, date);
  const found = generateScheduledDoses({ medications, doseLogs, date }).doses.find(
    (dose) => dose.time === time && dose.medicationId === medicationId,
  );
  if (found === undefined) throw new Error(`No dose at ${time} on ${date}`);
  return found;
}

function act(services: AppServices, dose: ScheduledDose, target: DoseTarget) {
  return applyDoseAction({
    repositories: services.repositories,
    dose,
    target,
    now: services.clock.now(),
    timeZone: TEST_TIME_ZONE,
    // The services' own generator: every new record gets its own id, as in the app.
    createId: services.createId,
  });
}

const allLogs = (services: AppServices) =>
  services.repositories.doseLogs.listByDateRange(
    asLocalDate('2026-01-01'),
    asLocalDate('2026-12-31'),
  );

describe('applyDoseAction: recording', () => {
  it('records a dose as taken with the amount and unit it has now', async () => {
    const { services } = await setup();

    const outcome = await act(services, await doseAt(services, '20:00'), 'taken');

    expect(outcome).toMatchObject({ ok: true, change: 'created' });
    expect(await allLogs(services)).toEqual([
      expect.objectContaining({
        medicationId: 'med-1',
        scheduledDate: TODAY,
        scheduledTime: '20:00',
        status: 'taken',
        doseAmount: 2,
        doseUnit: 'tabletka',
        recordedAt: asTimestamp(TEST_INSTANT),
      }),
    ]);
  });

  it('records skipped as skipped, not as taken', async () => {
    const { services } = await setup();
    await act(services, await doseAt(services, '08:00'), 'skipped');
    expect((await allLogs(services)).map((log) => log.status)).toEqual(['skipped']);
  });

  it('records a past day and does not touch other slots', async () => {
    const { services } = await setup();
    const yesterday = asLocalDate('2026-10-14');

    await act(services, await doseAt(services, '08:00', yesterday), 'taken');

    const logs = await allLogs(services);
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ scheduledDate: yesterday, scheduledTime: '08:00' });
    // The other slots of that day and of today are still unrecorded.
    expect((await doseAt(services, '20:00', yesterday)).status).toBe('unrecorded');
    expect((await doseAt(services, '08:00')).status).toBe('unrecorded');
  });

  it('refuses a future day and writes nothing', async () => {
    const { services } = await setup();
    const tomorrow = asLocalDate('2026-10-16');
    const dose = await doseAt(services, '08:00', tomorrow);
    const writesBefore = services.storage.writes.length;

    expect(await act(services, dose, 'taken')).toEqual({ ok: false, error: 'future-date' });

    expect(await allLogs(services)).toEqual([]);
    expect(services.storage.writes).toHaveLength(writesBefore);
  });

  it('uses the local date of the user, not UTC, to decide what the future is', async () => {
    // 22:30 UTC on the 15th is already the 16th in Warsaw, so the 16th is today, not the future.
    const services = createTestServices();
    await services.repositories.medications.create(makeMedication({ id: 'med-1' }));
    const dose = await doseAt(services, '08:00', asLocalDate('2026-10-16'));

    const outcome = await applyDoseAction({
      repositories: services.repositories,
      dose,
      target: 'taken',
      now: asTimestamp('2026-10-15T22:30:00Z'),
      timeZone: 'Europe/Warsaw',
      createId: () => 'x',
    });

    expect(outcome).toMatchObject({ ok: true, change: 'created' });
  });

  it('a repeated record request (double click) leaves exactly one record', async () => {
    const { services } = await setup();
    const dose = await doseAt(services, '08:00'); // still "unrecorded" on the stale screen

    const first = await act(services, dose, 'taken');
    const second = await act(services, dose, 'taken');

    expect(first).toMatchObject({ ok: true, change: 'created' });
    expect(second).toMatchObject({ ok: true, change: 'unchanged' });
    expect(await allLogs(services)).toHaveLength(1);
  });

  it('never overwrites a record with another status when the screen was out of date', async () => {
    const { services } = await setup();
    const staleDose = await doseAt(services, '08:00'); // the screen believes: unrecorded
    await act(services, staleDose, 'skipped'); // another tab records "skipped"

    const outcome = await act(services, staleDose, 'taken');

    expect(outcome).toEqual({ ok: false, error: 'already-recorded' });
    expect((await allLogs(services)).map((log) => log.status)).toEqual(['skipped']);
  });

  it('rejects a dose with an unusable amount instead of storing a misleading record', async () => {
    const { services } = await setup();
    const dose = { ...(await doseAt(services, '08:00')), doseAmount: 0 };

    expect(await act(services, dose, 'taken')).toEqual({ ok: false, error: 'invalid-dose' });
    expect(await allLogs(services)).toEqual([]);
  });
});

describe('applyDoseAction: correcting a status', () => {
  it('changes taken to skipped by updating the same record, keeping its id and snapshot', async () => {
    const { services } = await setup();
    await services.repositories.doseLogs.upsert(
      makeDoseLog({
        id: 'log-1',
        scheduledTime: asLocalTime('08:00'),
        doseAmount: 1,
        doseUnit: 'tabletka',
        status: 'taken',
      }),
    );
    const dose = await doseAt(services, '08:00');

    const outcome = await act(services, dose, 'skipped');

    expect(outcome).toMatchObject({ ok: true, change: 'updated' });
    const logs = await allLogs(services);
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({
      id: 'log-1',
      status: 'skipped',
      doseAmount: 1,
      doseUnit: 'tabletka',
    });
  });

  it('keeps the amount and unit recorded earlier even though the medication changed afterwards', async () => {
    const { services, medication } = await setup();
    await act(services, await doseAt(services, '08:00'), 'taken');
    // The medication is edited: the dose is doubled and the unit renamed.
    await services.repositories.medications.update({
      ...medication,
      name: 'Nowa nazwa',
      doseUnit: 'kapsułka',
      scheduleTimes: [scheduleTime('t-1', '08:00', 2), scheduleTime('t-2', '20:00', 2)],
    });

    await act(services, await doseAt(services, '08:00'), 'skipped');

    const [log] = await allLogs(services);
    expect(log).toMatchObject({ status: 'skipped', doseAmount: 1, doseUnit: 'tabletka' });
  });

  it('repeating the same change is harmless', async () => {
    const { services } = await setup();
    await act(services, await doseAt(services, '08:00'), 'taken');
    const recorded = await doseAt(services, '08:00');

    const first = await act(services, recorded, 'skipped');
    const second = await act(services, recorded, 'skipped');

    expect(first).toMatchObject({ change: 'updated' });
    expect(second).toMatchObject({ change: 'unchanged' });
    expect(await allLogs(services)).toHaveLength(1);
  });

  it('does not bring back a record that was cleared elsewhere', async () => {
    const { services } = await setup();
    await act(services, await doseAt(services, '08:00'), 'taken');
    const staleRecorded = await doseAt(services, '08:00'); // the screen believes: taken
    await act(services, staleRecorded, 'clear'); // another tab clears it

    const outcome = await act(services, staleRecorded, 'skipped');

    expect(outcome).toEqual({ ok: false, error: 'record-not-found' });
    expect(await allLogs(services)).toEqual([]);
  });
});

describe('applyDoseAction: clearing', () => {
  it('removes the record of that slot only and keeps every other record', async () => {
    const { services } = await setup();
    await services.repositories.medications.create(
      makeMedication({ id: 'med-2', name: 'Lek B', scheduleTimes: [scheduleTime('b-1', '08:00')] }),
    );
    const yesterday = asLocalDate('2026-10-14');
    await act(services, await doseAt(services, '08:00'), 'taken');
    await act(services, await doseAt(services, '20:00'), 'skipped');
    await act(services, await doseAt(services, '08:00', TODAY, 'med-2'), 'taken');
    await act(services, await doseAt(services, '08:00', yesterday), 'taken');

    const outcome = await act(services, await doseAt(services, '08:00'), 'clear');

    expect(outcome).toEqual({ ok: true, change: 'removed', log: null });
    const left = (await allLogs(services)).map(
      (log) => `${log.medicationId} ${log.scheduledDate} ${log.scheduledTime} ${log.status}`,
    );
    expect(left).toEqual([
      'med-1 2026-10-14 08:00 taken',
      'med-2 2026-10-15 08:00 taken',
      'med-1 2026-10-15 20:00 skipped',
    ]);
  });

  it('clearing a dose that has no record succeeds, writes nothing and creates nothing', async () => {
    const { services } = await setup();
    const dose = await doseAt(services, '08:00');
    const writesBefore = services.storage.writes.length;

    expect(await act(services, dose, 'clear')).toEqual({ ok: true, change: 'none', log: null });
    expect(await act(services, dose, 'clear')).toEqual({ ok: true, change: 'none', log: null });

    expect(await allLogs(services)).toEqual([]);
    expect(services.storage.writes).toHaveLength(writesBefore);
  });

  it('can clear a past record whose medication has since ended', async () => {
    const { services, medication } = await setup();
    await act(services, await doseAt(services, '08:00'), 'taken');
    const recorded = await doseAt(services, '08:00');
    await services.repositories.medications.update({
      ...medication,
      endDate: asLocalDate('2026-10-10'),
    });

    expect(await act(services, recorded, 'clear')).toMatchObject({ ok: true, change: 'removed' });
    expect(await allLogs(services)).toEqual([]);
  });
});

describe('applyDoseAction: failures are reported, never hidden', () => {
  it('rejects when storage refuses the write, and nothing is stored', async () => {
    const { services } = await setup();
    const dose = await doseAt(services, '08:00');
    services.storage.failWrites();

    await expect(act(services, dose, 'taken')).rejects.toBeInstanceOf(RepositoryError);

    services.storage.heal();
    expect(await allLogs(services)).toEqual([]);
  });

  it('rejects when storage cannot be read', async () => {
    const { services } = await setup();
    const dose = await doseAt(services, '08:00');
    services.storage.failReads();

    await expect(act(services, dose, 'taken')).rejects.toMatchObject({
      code: 'storage-unavailable',
    });
  });

  it('a failed clear leaves the record in place', async () => {
    const { services } = await setup();
    await act(services, await doseAt(services, '08:00'), 'taken');
    const recorded = await doseAt(services, '08:00');
    services.storage.failWrites();

    await expect(act(services, recorded, 'clear')).rejects.toBeInstanceOf(RepositoryError);

    services.storage.heal();
    expect(await allLogs(services)).toHaveLength(1);
  });

  it('turns a race between two tabs into duplicate-slot instead of replacing the other record', async () => {
    const { services } = await setup();
    const dose = await doseAt(services, '08:00');
    // Between our read and our write another tab stores a different record in the same slot.
    const racing = {
      ...services.repositories,
      doseLogs: {
        ...services.repositories.doseLogs,
        listByDateRange: () => Promise.resolve([]),
      },
    };
    await services.repositories.doseLogs.upsert(
      makeDoseLog({ id: 'other-tab', scheduledTime: asLocalTime('08:00'), status: 'skipped' }),
    );

    await expect(
      applyDoseAction({
        repositories: racing,
        dose,
        target: 'taken',
        now: services.clock.now(),
        timeZone: TEST_TIME_ZONE,
        createId: () => 'mine',
      }),
    ).rejects.toMatchObject({ code: 'duplicate-slot' });

    expect(await allLogs(services)).toEqual([
      expect.objectContaining({ id: 'other-tab', status: 'skipped' }),
    ]);
  });

  it('changes nothing when the stored data holds several records for the slot', async () => {
    const { services } = await setup();
    const dose = await doseAt(services, '08:00');
    const damaged = {
      ...services.repositories,
      doseLogs: {
        ...services.repositories.doseLogs,
        listByDateRange: () =>
          Promise.resolve([
            makeDoseLog({ id: 'a', scheduledTime: asLocalTime('08:00') }),
            makeDoseLog({ id: 'b', scheduledTime: asLocalTime('08:00') }),
          ]),
      },
    };

    const outcome = await applyDoseAction({
      repositories: damaged,
      dose,
      target: 'clear',
      now: services.clock.now(),
      timeZone: TEST_TIME_ZONE,
      createId: () => 'x',
    });

    expect(outcome).toEqual({ ok: false, error: 'conflicting-records' });
    expect(await allLogs(services)).toEqual([]);
  });
});

function details(
  services: AppServices,
  dose: ScheduledDose,
  values: { takenAmount: number; note: string | null },
) {
  return applyTakenDetails({
    repositories: services.repositories,
    dose,
    details: values,
    now: services.clock.now(),
    timeZone: TEST_TIME_ZONE,
    createId: services.createId,
  });
}

describe('applyTakenDetails: recording with the amount actually taken and a note', () => {
  it('records a dose as taken with a LARGER amount, keeping the plan next to it', async () => {
    const { services } = await setup();
    const dose = await doseAt(services, '08:00');

    const outcome = await details(services, dose, { takenAmount: 3, note: 'Zalecenie lekarza' });

    expect(outcome).toMatchObject({ ok: true, change: 'created' });
    const [log] = await allLogs(services);
    expect(log).toMatchObject({
      status: 'taken',
      doseAmount: 1,
      takenAmount: 3,
      note: 'Zalecenie lekarza',
      recordedAt: services.clock.now(),
    });
    expect(await allLogs(services)).toHaveLength(1);
  });

  it('records a SMALLER amount, and the planned amount without any amount field', async () => {
    const { services } = await setup();

    await details(services, await doseAt(services, '20:00'), { takenAmount: 0.5, note: null });
    await details(services, await doseAt(services, '08:00'), {
      takenAmount: 1,
      note: 'Po jedzeniu',
    });

    const logs = await allLogs(services);
    expect(logs.find((log) => log.scheduledTime === '20:00')).toMatchObject({
      doseAmount: 2,
      takenAmount: 0.5,
    });
    const planned = logs.find((log) => log.scheduledTime === '08:00');
    expect(planned && 'takenAmount' in planned).toBe(false);
    expect(planned?.note).toBe('Po jedzeniu');
  });

  it('does not touch the schedule, scheduleEffectiveFrom or the medication', async () => {
    const { services, medication } = await setup();

    await details(services, await doseAt(services, '08:00'), { takenAmount: 9, note: 'x' });

    expect(await services.repositories.medications.get('med-1')).toEqual(medication);
    // The doses of tomorrow are generated from the same plan: nothing was adjusted.
    const tomorrow = asLocalDate('2026-10-16');
    const generated = generateScheduledDoses({
      medications: [await services.repositories.medications.get('med-1')],
      doseLogs: [],
      date: tomorrow,
    });
    expect(generated.doses.map((dose) => dose.doseAmount)).toEqual([1, 2]);
  });

  it('edits the amount and the note of a taken dose without moving recordedAt', async () => {
    const { services } = await setup();
    await act(services, await doseAt(services, '08:00'), 'taken');
    const [before] = await allLogs(services);

    const outcome = await details(services, await doseAt(services, '08:00'), {
      takenAmount: 2,
      note: 'Dwie',
    });

    expect(outcome).toMatchObject({ ok: true, change: 'updated' });
    const [after] = await allLogs(services);
    expect(after).toEqual({ ...before, takenAmount: 2, note: 'Dwie' });
    expect(after?.recordedAt).toBe(before?.recordedAt);
    expect(await allLogs(services)).toHaveLength(1);
  });

  it('the same amount and note again writes nothing', async () => {
    const { services } = await setup();
    await details(services, await doseAt(services, '08:00'), { takenAmount: 2, note: 'x' });
    const stored = new Map(services.storage.data);
    const writesBefore = services.storage.writes.length;

    const outcome = await details(services, await doseAt(services, '08:00'), {
      takenAmount: 2,
      note: 'x',
    });

    expect(outcome).toMatchObject({ ok: true, change: 'unchanged' });
    expect(services.storage.writes).toHaveLength(writesBefore);
    expect(services.storage.data).toEqual(stored);
  });

  it('refuses a record changed in the meantime and overwrites nothing', async () => {
    const { services } = await setup();
    await act(services, await doseAt(services, '08:00'), 'taken');
    const seenOnScreen = await doseAt(services, '08:00');
    // Another tab edits the same record first.
    await details(services, seenOnScreen, { takenAmount: 5, note: 'z innej karty' });
    const stored = await allLogs(services);

    const outcome = await details(services, seenOnScreen, { takenAmount: 2, note: 'moja' });

    expect(outcome).toEqual({ ok: false, error: 'record-changed' });
    expect(await allLogs(services)).toEqual(stored);
  });

  it('refuses details for a dose that is recorded as skipped meanwhile, or whose record is gone', async () => {
    const { services } = await setup();
    await act(services, await doseAt(services, '08:00'), 'taken');
    const takenOnScreen = await doseAt(services, '08:00');
    await act(services, takenOnScreen, 'skipped');

    expect(await details(services, takenOnScreen, { takenAmount: 2, note: null })).toEqual({
      ok: false,
      error: 'details-need-taken',
    });
    await act(services, await doseAt(services, '08:00'), 'clear');
    expect(await details(services, takenOnScreen, { takenAmount: 2, note: null })).toEqual({
      ok: false,
      error: 'record-not-found',
    });
    expect(await allLogs(services)).toEqual([]);
  });

  it('refuses to merge details into a record that appeared in the meantime for an unrecorded dose', async () => {
    const { services } = await setup();
    const unrecordedOnScreen = await doseAt(services, '08:00');
    await act(services, unrecordedOnScreen, 'taken'); // another tab recorded it first
    const stored = await allLogs(services);

    const outcome = await details(services, unrecordedOnScreen, { takenAmount: 4, note: 'x' });

    expect(outcome).toEqual({ ok: false, error: 'already-recorded' });
    expect(await allLogs(services)).toEqual(stored);
  });

  it('refuses a skipped dose on screen', async () => {
    const { services } = await setup();
    await act(services, await doseAt(services, '08:00'), 'skipped');

    expect(
      await details(services, await doseAt(services, '08:00'), { takenAmount: 2, note: null }),
    ).toEqual({ ok: false, error: 'details-need-taken' });
  });

  it('refuses an invalid amount and a long note without writing', async () => {
    const { services } = await setup();
    const dose = await doseAt(services, '08:00');

    expect(await details(services, dose, { takenAmount: 0, note: null })).toEqual({
      ok: false,
      error: 'invalid-amount',
    });
    expect(await details(services, dose, { takenAmount: 2, note: 'x'.repeat(501) })).toEqual({
      ok: false,
      error: 'note-too-long',
    });
    expect(await allLogs(services)).toEqual([]);
  });

  it('turns a refused write into an error and never into a success', async () => {
    const { services } = await setup();
    const dose = await doseAt(services, '08:00');
    services.storage.failWrites(new DOMException('full', 'QuotaExceededError'));

    await expect(details(services, dose, { takenAmount: 2, note: null })).rejects.toBeInstanceOf(
      RepositoryError,
    );
    services.storage.heal();
    expect(await allLogs(services)).toEqual([]);
  });

  it('records nothing for a day that has not come', async () => {
    const { services } = await setup();
    const future = await doseAt(services, '08:00', asLocalDate('2026-10-16'));

    expect(await details(services, future, { takenAmount: 2, note: null })).toEqual({
      ok: false,
      error: 'future-date',
    });
  });

  it('keeps an older record (without the fields) working: marking it skipped and clearing it as before', async () => {
    const { services } = await setup();
    await services.repositories.doseLogs.upsert(
      makeDoseLog({
        id: 'old',
        medicationId: 'med-1',
        scheduledDate: TODAY,
        scheduledTime: asLocalTime('08:00'),
        doseAmount: 1,
        recordedAt: asTimestamp('2026-10-15T06:00:00Z'),
      }),
    );

    await act(services, await doseAt(services, '08:00'), 'skipped');
    expect((await allLogs(services))[0]).toMatchObject({ id: 'old', status: 'skipped' });
    await act(services, await doseAt(services, '08:00'), 'clear');
    expect(await allLogs(services)).toEqual([]);
  });
});
