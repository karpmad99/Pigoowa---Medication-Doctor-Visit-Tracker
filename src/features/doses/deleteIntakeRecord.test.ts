import { describe, expect, it } from 'vitest';
import { RepositoryError } from '@/services/errors';
import { STORAGE_KEYS } from '@/services/local/collections';
import type { AppServices } from '@/services/repositories';
import { makeDoseLog, makeMedication, scheduleTime } from '@/test/fixtures';
import { createTestServices } from '@/test/services';
import { asLocalDate, asLocalTime } from '@/utils/date';
import { deleteOutsideScheduleRecord } from './deleteIntakeRecord';
import type { DoseLog } from './types';

const d = asLocalDate;
const t = asLocalTime;

// The medication's schedule took effect on 10 October, so a record of 5 October is outside it.
async function setup() {
  const services = createTestServices();
  await services.repositories.medications.create(
    makeMedication({
      id: 'med-1',
      startDate: d('2026-09-01'),
      scheduleEffectiveFrom: d('2026-10-10'),
      scheduleTimes: [scheduleTime('t-1', '08:00'), scheduleTime('t-2', '20:00')],
    }),
  );
  return services;
}

const store = (services: AppServices, ...logs: Partial<DoseLog>[]) =>
  Promise.all(
    logs.map((log) =>
      services.repositories.doseLogs.upsert(makeDoseLog({ medicationId: 'med-1', ...log })),
    ),
  );
const everything = (services: AppServices) =>
  services.repositories.doseLogs.listByDateRange(d('2000-01-01'), d('2999-12-31'));
const outside = makeDoseLog({
  id: 'outside',
  medicationId: 'med-1',
  scheduledDate: d('2026-10-05'),
  scheduledTime: t('08:00'),
});

describe('deleteOutsideScheduleRecord', () => {
  it('deletes exactly that record and leaves every other record alone', async () => {
    const services = await setup();
    await store(
      services,
      { id: 'outside', scheduledDate: d('2026-10-05'), scheduledTime: t('08:00') },
      // Same medication, same day, other time; same time, other day; a record inside the schedule.
      { id: 'same-day', scheduledDate: d('2026-10-05'), scheduledTime: t('20:00') },
      { id: 'other-day', scheduledDate: d('2026-10-04'), scheduledTime: t('08:00') },
      { id: 'inside', scheduledDate: d('2026-10-12'), scheduledTime: t('08:00') },
    );

    const outcome = await deleteOutsideScheduleRecord({
      repositories: services.repositories,
      log: outside,
    });

    expect(outcome).toEqual({ ok: true, change: 'removed' });
    expect((await everything(services)).map((log) => log.id).sort()).toEqual([
      'inside',
      'other-day',
      'same-day',
    ]);
  });

  it('does not touch the medication or its schedule', async () => {
    const services = await setup();
    await store(services, {
      id: 'outside',
      scheduledDate: d('2026-10-05'),
      scheduledTime: t('08:00'),
    });
    const before = await services.repositories.medications.list();

    await deleteOutsideScheduleRecord({ repositories: services.repositories, log: outside });

    expect(await services.repositories.medications.list()).toEqual(before);
  });

  it('is harmless to repeat: a record that is already gone succeeds and writes nothing', async () => {
    const services = await setup();
    const writesBefore = services.storage.writes.length;

    const outcome = await deleteOutsideScheduleRecord({
      repositories: services.repositories,
      log: outside,
    });

    expect(outcome).toEqual({ ok: true, change: 'none' });
    expect(services.storage.writes).toHaveLength(writesBefore);
  });

  it('refuses when the record in the slot is not the one the user confirmed (replaced)', async () => {
    const services = await setup();
    await store(services, {
      id: 'someone-elses',
      scheduledDate: d('2026-10-05'),
      scheduledTime: t('08:00'),
    });

    const outcome = await deleteOutsideScheduleRecord({
      repositories: services.repositories,
      log: outside,
    });

    expect(outcome).toEqual({ ok: false, error: 'changed-meanwhile' });
    expect((await everything(services)).map((log) => log.id)).toEqual(['someone-elses']);
  });

  it('refuses when its status was changed after the user looked at it', async () => {
    const services = await setup();
    await store(services, {
      id: 'outside',
      scheduledDate: d('2026-10-05'),
      scheduledTime: t('08:00'),
      status: 'skipped',
    });

    const outcome = await deleteOutsideScheduleRecord({
      repositories: services.repositories,
      log: { ...outside, status: 'taken' },
    });

    expect(outcome).toEqual({ ok: false, error: 'changed-meanwhile' });
    expect(await everything(services)).toHaveLength(1);
  });

  it('refuses a record that now belongs to the current schedule (it is corrected in the day view)', async () => {
    const services = await setup();
    const inside = makeDoseLog({
      id: 'inside',
      medicationId: 'med-1',
      scheduledDate: d('2026-10-12'),
      scheduledTime: t('08:00'),
    });
    await store(services, inside);

    const outcome = await deleteOutsideScheduleRecord({
      repositories: services.repositories,
      log: inside,
    });

    expect(outcome).toEqual({ ok: false, error: 'now-in-schedule' });
    expect(await everything(services)).toHaveLength(1);
  });

  it('refuses a slot that holds several records, without guessing which to remove', async () => {
    const services = await setup();
    const damaged = {
      ...services.repositories,
      doseLogs: {
        ...services.repositories.doseLogs,
        listByDateRange: () =>
          Promise.resolve([
            makeDoseLog({ id: 'a', medicationId: 'med-1', scheduledDate: d('2026-10-05') }),
            makeDoseLog({ id: 'b', medicationId: 'med-1', scheduledDate: d('2026-10-05') }),
          ]),
      },
    };

    expect(await deleteOutsideScheduleRecord({ repositories: damaged, log: outside })).toEqual({
      ok: false,
      error: 'conflicting-records',
    });
  });

  it('can delete a leftover record of a medication that no longer exists', async () => {
    const services = await setup();
    const orphan = makeDoseLog({ id: 'orphan', medicationId: 'm-gone' });
    services.storage.data.set(
      STORAGE_KEYS.doseLogs,
      JSON.stringify({
        version: 1,
        items: [
          orphan,
          makeDoseLog({ id: 'keep', medicationId: 'med-1', scheduledDate: d('2026-10-12') }),
        ],
      }),
    );

    const outcome = await deleteOutsideScheduleRecord({
      repositories: services.repositories,
      log: orphan,
    });

    expect(outcome).toEqual({ ok: true, change: 'removed' });
    expect((await everything(services)).map((log) => log.id)).toEqual(['keep']);
  });

  it('rejects when storage refuses the write, and keeps the record', async () => {
    const services = await setup();
    await store(services, {
      id: 'outside',
      scheduledDate: d('2026-10-05'),
      scheduledTime: t('08:00'),
    });
    services.storage.failWrites();

    await expect(
      deleteOutsideScheduleRecord({ repositories: services.repositories, log: outside }),
    ).rejects.toBeInstanceOf(RepositoryError);

    services.storage.heal();
    expect(await everything(services)).toHaveLength(1);
  });

  it('rejects when storage cannot be read, instead of pretending the record is gone', async () => {
    const services = await setup();
    await store(services, {
      id: 'outside',
      scheduledDate: d('2026-10-05'),
      scheduledTime: t('08:00'),
    });
    services.storage.failReads();

    await expect(
      deleteOutsideScheduleRecord({ repositories: services.repositories, log: outside }),
    ).rejects.toMatchObject({ code: 'storage-unavailable' });
  });
});
