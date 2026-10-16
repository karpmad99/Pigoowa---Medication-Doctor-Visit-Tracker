import { beforeEach, describe, expect, it } from 'vitest';
import { changeAppointmentStatus } from '@/features/appointments/logic/status';
import { changeDoseStatus, recordDose, undoDose } from '@/features/doses/logic/recording';
import type { DoseSlot, ScheduledDose } from '@/features/doses/types';
import { applyScheduleChange } from '@/features/medications/logic/schedule';
import { asLocalDate, asLocalTime, asTimestamp } from '@/utils/date';
import { makeAppointment, makeDoseLog, makeMedication, scheduleTime } from '@/test/fixtures';
import { RepositoryError } from '../errors';
import type { Repositories } from '../repositories';

/**
 * Behaviour EVERY implementation of the repository interfaces must have, whatever it stores
 * data in. It knows nothing about localStorage: the local implementation runs it today
 * (src/services/local), and the Supabase implementation of stage 11 must pass it unchanged.
 * Details of one particular storage (corrupt JSON, quota errors, keys) belong in that
 * implementation's own tests, not here.
 */
export interface ContractContext {
  repositories: Repositories;
  /** New repositories over the SAME stored data, as after reloading the application. */
  reopen: () => Repositories;
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

const TODAY = asLocalDate('2026-10-15');
const MORNING = asLocalTime('08:00');
const NOW = asTimestamp('2026-10-15T10:00:00Z');
const CONTEXT = { now: NOW, timeZone: 'Europe/Warsaw' };

export function describeRepositoryContract(name: string, setup: () => ContractContext): void {
  describe(`repository contract: ${name}`, () => {
    let repositories: Repositories;
    let reopen: () => Repositories;

    beforeEach(() => {
      ({ repositories, reopen } = setup());
    });

    describe('medications', () => {
      it('starts empty', async () => {
        expect(await repositories.medications.list()).toEqual([]);
      });

      it('stores a medication and returns it by id and in the list', async () => {
        const medication = makeMedication({ id: 'm-1', notes: 'Notatka' });

        const created = await repositories.medications.create(medication);

        expect(created).toEqual(medication);
        expect(await repositories.medications.get('m-1')).toEqual(medication);
        expect(await repositories.medications.list()).toEqual([medication]);
      });

      it('returns copies: changing a returned object does not change what is stored', async () => {
        await repositories.medications.create(makeMedication({ id: 'm-1', name: 'Lek A' }));

        const first = await repositories.medications.get('m-1');
        first.name = 'Zmienione';
        first.scheduleTimes.length = 0;

        const second = await repositories.medications.get('m-1');
        expect(second.name).toBe('Lek A');
        expect(second.scheduleTimes).toHaveLength(1);
      });

      it('lists medications by name using Polish alphabet rules, then by id', async () => {
        for (const [id, medicationName] of [
          ['m-3', 'Ćmik'],
          ['m-2', 'Beta'],
          ['m-1', 'Czop'],
          ['m-5', 'Beta'],
        ] as const) {
          await repositories.medications.create(makeMedication({ id, name: medicationName }));
        }

        const list = await repositories.medications.list();

        expect(list.map((medication) => medication.id)).toEqual(['m-2', 'm-5', 'm-1', 'm-3']);
      });

      it('rejects a second medication with an existing id and keeps the first unchanged', async () => {
        await repositories.medications.create(makeMedication({ id: 'm-1', name: 'Pierwszy' }));

        const error = await failureOf(
          repositories.medications.create(makeMedication({ id: 'm-1', name: 'Drugi' })),
        );

        expect(error.code).toBe('duplicate-id');
        expect((await repositories.medications.get('m-1')).name).toBe('Pierwszy');
        expect(await repositories.medications.list()).toHaveLength(1);
      });

      it.each([
        ['a blank name', { name: '   ' }],
        ['a blank dose unit', { doseUnit: '' }],
        [
          'a schedule time listed twice',
          { scheduleTimes: [scheduleTime('a', '08:00'), scheduleTime('b', '08:00')] },
        ],
        ['a dose amount of zero', { scheduleTimes: [scheduleTime('a', '08:00', 0)] }],
        [
          'an end date before the start date',
          { startDate: TODAY, scheduleEffectiveFrom: TODAY, endDate: asLocalDate('2026-10-14') },
        ],
        ['a negative stock quantity', { stock: { quantity: -1, unit: 'tabletka', asOf: NOW } }],
      ])('refuses to store a medication with %s', async (_label, overrides) => {
        const error = await failureOf(
          repositories.medications.create(makeMedication({ id: 'm-1', ...overrides })),
        );

        expect(error.code).toBe('invalid-input');
        expect(await repositories.medications.list()).toEqual([]);
      });

      it('rejects reading a medication that does not exist', async () => {
        expect((await failureOf(repositories.medications.get('nope'))).code).toBe('not-found');
      });

      it('replaces a medication on update and leaves the others exactly as they were', async () => {
        const other = makeMedication({ id: 'm-2', name: 'Inny' });
        await repositories.medications.create(makeMedication({ id: 'm-1', name: 'Przed' }));
        await repositories.medications.create(other);

        await repositories.medications.update(makeMedication({ id: 'm-1', name: 'Po' }));

        expect((await repositories.medications.get('m-1')).name).toBe('Po');
        expect(await repositories.medications.get('m-2')).toEqual(other);
        expect(await repositories.medications.list()).toHaveLength(2);
      });

      it('does not create a medication when updating one that does not exist', async () => {
        const error = await failureOf(
          repositories.medications.update(makeMedication({ id: 'ghost' })),
        );

        expect(error.code).toBe('not-found');
        expect(await repositories.medications.list()).toEqual([]);
      });

      it('keeps the previous version when an update is invalid', async () => {
        await repositories.medications.create(makeMedication({ id: 'm-1', name: 'Dobry' }));

        const error = await failureOf(
          repositories.medications.update(makeMedication({ id: 'm-1', name: '' })),
        );

        expect(error.code).toBe('invalid-input');
        expect((await repositories.medications.get('m-1')).name).toBe('Dobry');
      });

      it('deletes a medication and only that one', async () => {
        await repositories.medications.create(makeMedication({ id: 'm-1' }));
        await repositories.medications.create(makeMedication({ id: 'm-2', name: 'Drugi' }));

        await repositories.medications.remove('m-1');

        expect((await repositories.medications.list()).map((medication) => medication.id)).toEqual([
          'm-2',
        ]);
      });

      it('rejects deleting a medication that does not exist, changing nothing', async () => {
        await repositories.medications.create(makeMedication({ id: 'm-1' }));

        expect((await failureOf(repositories.medications.remove('ghost'))).code).toBe('not-found');
        expect(await repositories.medications.list()).toHaveLength(1);
      });

      it('is still there after the repositories are reopened (persistence)', async () => {
        const medication = makeMedication({ id: 'm-1' });
        await repositories.medications.create(medication);

        expect(await reopen().medications.list()).toEqual([medication]);
      });

      it('lets two repository instances share data without overwriting each other', async () => {
        const second = reopen();
        await repositories.medications.create(makeMedication({ id: 'm-1', name: 'Pierwszy' }));
        await second.medications.create(makeMedication({ id: 'm-2', name: 'Drugi' }));

        const fromFirst = await repositories.medications.list();
        const fromSecond = await second.medications.list();

        expect(fromFirst.map((m) => m.id)).toEqual(['m-2', 'm-1']);
        expect(fromSecond).toEqual(fromFirst);
      });
    });

    describe('intake records (dose logs)', () => {
      beforeEach(async () => {
        await repositories.medications.create(makeMedication({ id: 'med-1' }));
      });

      it('starts empty', async () => {
        expect(await repositories.doseLogs.listByDateRange(TODAY, TODAY)).toEqual([]);
      });

      it('stores a record for an existing medication', async () => {
        const log = makeDoseLog({ id: 'l-1' });

        expect(await repositories.doseLogs.upsert(log)).toEqual(log);
        expect(await repositories.doseLogs.listByDateRange(TODAY, TODAY)).toEqual([log]);
      });

      it('refuses a record for a medication that does not exist, storing nothing', async () => {
        const error = await failureOf(
          repositories.doseLogs.upsert(makeDoseLog({ id: 'l-1', medicationId: 'ghost' })),
        );

        expect(error.code).toBe('missing-reference');
        expect(await repositories.doseLogs.listByDateRange(TODAY, TODAY)).toEqual([]);
      });

      it.each([
        ['a dose amount of zero', { doseAmount: 0 }],
        ['a blank unit', { doseUnit: ' ' }],
        ['an unknown status', { status: 'forgotten' as never }],
      ])('refuses a record with %s', async (_label, overrides) => {
        const error = await failureOf(
          repositories.doseLogs.upsert(makeDoseLog({ id: 'l-1', ...overrides })),
        );

        expect(error.code).toBe('invalid-input');
        expect(await repositories.doseLogs.listByDateRange(TODAY, TODAY)).toEqual([]);
      });

      it('lists by date range, including both ends and nothing outside, in a fixed order', async () => {
        const dates = ['2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16'];
        for (const [index, date] of dates.entries()) {
          await repositories.doseLogs.upsert(
            makeDoseLog({ id: `l-${String(index)}`, scheduledDate: asLocalDate(date) }),
          );
        }
        await repositories.doseLogs.upsert(
          makeDoseLog({
            id: 'l-evening',
            scheduledDate: asLocalDate('2026-10-14'),
            scheduledTime: asLocalTime('20:00'),
          }),
        );

        const range = await repositories.doseLogs.listByDateRange(
          asLocalDate('2026-10-14'),
          asLocalDate('2026-10-15'),
        );

        expect(range.map((log) => log.id)).toEqual(['l-1', 'l-evening', 'l-2']);
      });

      it('rejects a range that ends before it starts', async () => {
        const error = await failureOf(
          repositories.doseLogs.listByDateRange(
            asLocalDate('2026-10-16'),
            asLocalDate('2026-10-15'),
          ),
        );

        expect(error.code).toBe('invalid-input');
      });

      it('updates a record in place when the same id is stored again: still one record per slot', async () => {
        await repositories.doseLogs.upsert(makeDoseLog({ id: 'l-1', status: 'taken' }));

        await repositories.doseLogs.upsert(makeDoseLog({ id: 'l-1', status: 'skipped' }));

        const logs = await repositories.doseLogs.listByDateRange(TODAY, TODAY);
        expect(logs).toHaveLength(1);
        expect(logs[0]?.status).toBe('skipped');
      });

      it('storing the identical record again changes nothing', async () => {
        const log = makeDoseLog({ id: 'l-1' });
        await repositories.doseLogs.upsert(log);
        await repositories.doseLogs.upsert(log);

        expect(await repositories.doseLogs.listByDateRange(TODAY, TODAY)).toEqual([log]);
      });

      it('never overwrites a different record in the same slot: it reports a duplicate instead', async () => {
        const first = makeDoseLog({ id: 'l-1', status: 'taken' });
        await repositories.doseLogs.upsert(first);

        const error = await failureOf(
          repositories.doseLogs.upsert(makeDoseLog({ id: 'l-2', status: 'skipped' })),
        );

        expect(error.code).toBe('duplicate-slot');
        expect(await repositories.doseLogs.listByDateRange(TODAY, TODAY)).toEqual([first]);
      });

      it('removes the record of one slot and nothing else', async () => {
        await repositories.doseLogs.upsert(makeDoseLog({ id: 'l-1', scheduledTime: MORNING }));
        const evening = makeDoseLog({ id: 'l-2', scheduledTime: asLocalTime('20:00') });
        await repositories.doseLogs.upsert(evening);

        await repositories.doseLogs.remove({ medicationId: 'med-1', date: TODAY, time: MORNING });

        expect(await repositories.doseLogs.listByDateRange(TODAY, TODAY)).toEqual([evening]);
      });

      it('succeeds when removing a slot that has no record, so undo can be repeated', async () => {
        const log = makeDoseLog({ id: 'l-1' });
        await repositories.doseLogs.upsert(log);
        const emptySlot: DoseSlot = {
          medicationId: 'med-1',
          date: TODAY,
          time: asLocalTime('12:00'),
        };

        await repositories.doseLogs.remove(emptySlot);
        await repositories.doseLogs.remove(emptySlot);

        expect(await repositories.doseLogs.listByDateRange(TODAY, TODAY)).toEqual([log]);
      });

      it('is still there after the repositories are reopened (persistence)', async () => {
        const log = makeDoseLog({ id: 'l-1' });
        await repositories.doseLogs.upsert(log);

        expect(await reopen().doseLogs.listByDateRange(TODAY, TODAY)).toEqual([log]);
      });

      it('works with the Stage 2 domain actions: record, change and undo always leave at most one record', async () => {
        const dose: ScheduledDose = {
          medicationId: 'med-1',
          date: TODAY,
          time: MORNING,
          medicationName: 'Lek A',
          doseAmount: 1,
          doseUnit: 'tabletka',
          status: 'unrecorded',
          log: null,
        };
        const load = () => repositories.doseLogs.listByDateRange(TODAY, TODAY);

        const recorded = recordDose({
          dose,
          status: 'taken',
          newLogId: 'l-1',
          logs: await load(),
          context: CONTEXT,
        });
        if (!recorded.ok || !recorded.log) throw new Error('recordDose should succeed');
        await repositories.doseLogs.upsert(recorded.log);
        expect(await load()).toHaveLength(1);

        const changed = changeDoseStatus({
          slot: dose,
          status: 'skipped',
          logs: await load(),
          context: CONTEXT,
        });
        if (!changed.ok || !changed.log) throw new Error('changeDoseStatus should succeed');
        await repositories.doseLogs.upsert(changed.log);
        const afterChange = await load();
        expect(afterChange).toHaveLength(1);
        expect(afterChange[0]).toMatchObject({ id: 'l-1', status: 'skipped' });

        const undone = undoDose({ slot: dose, logs: await load() });
        expect(undone.ok && undone.change).toBe('removed');
        await repositories.doseLogs.remove(dose);
        expect(await load()).toEqual([]);
      });
    });

    describe('intake history and medications together', () => {
      it('keeps the recorded amount and unit when the medication is changed afterwards', async () => {
        const original = makeMedication({ id: 'med-1', doseUnit: 'tabletka' });
        await repositories.medications.create(original);
        await repositories.doseLogs.upsert(
          makeDoseLog({ id: 'l-1', doseAmount: 1, doseUnit: 'tabletka' }),
        );

        const changedSchedule = applyScheduleChange(
          original,
          [scheduleTime('t-9', '09:00', 3)],
          TODAY,
          NOW,
        );
        await repositories.medications.update({ ...changedSchedule, doseUnit: 'kapsułka' });

        const [log] = await repositories.doseLogs.listByDateRange(TODAY, TODAY);
        expect(log).toMatchObject({ doseAmount: 1, doseUnit: 'tabletka' });
      });

      it('keeps the history when a medication is ended with an end date', async () => {
        const medication = makeMedication({ id: 'med-1' });
        await repositories.medications.create(medication);
        await repositories.doseLogs.upsert(makeDoseLog({ id: 'l-1' }));

        await repositories.medications.update({ ...medication, endDate: TODAY });

        expect(await repositories.doseLogs.listByDateRange(TODAY, TODAY)).toHaveLength(1);
      });

      it("deletes the history of a deleted medication, and only that medication's", async () => {
        await repositories.medications.create(makeMedication({ id: 'med-1' }));
        await repositories.medications.create(makeMedication({ id: 'med-2', name: 'Drugi' }));
        await repositories.doseLogs.upsert(makeDoseLog({ id: 'l-1', medicationId: 'med-1' }));
        const kept = makeDoseLog({ id: 'l-2', medicationId: 'med-2' });
        await repositories.doseLogs.upsert(kept);

        await repositories.medications.remove('med-1');

        expect(await repositories.doseLogs.listByDateRange(TODAY, TODAY)).toEqual([kept]);
      });

      it("does not let a deleted medication's id be used for new records", async () => {
        await repositories.medications.create(makeMedication({ id: 'med-1' }));
        await repositories.medications.remove('med-1');

        const error = await failureOf(repositories.doseLogs.upsert(makeDoseLog({ id: 'l-1' })));

        expect(error.code).toBe('missing-reference');
      });
    });

    describe('appointments', () => {
      it('starts empty', async () => {
        expect(await repositories.appointments.list()).toEqual([]);
      });

      it('stores an appointment and returns it by id and in the list', async () => {
        const appointment = makeAppointment({ id: 'a-1', location: 'Gabinet 4' });

        expect(await repositories.appointments.create(appointment)).toEqual(appointment);
        expect(await repositories.appointments.get('a-1')).toEqual(appointment);
        expect(await repositories.appointments.list()).toEqual([appointment]);
      });

      it('returns copies', async () => {
        await repositories.appointments.create(
          makeAppointment({ id: 'a-1', doctorName: 'dr Nowak' }),
        );

        const first = await repositories.appointments.get('a-1');
        first.doctorName = 'Zmieniony';

        expect((await repositories.appointments.get('a-1')).doctorName).toBe('dr Nowak');
      });

      it('lists by date and time, then by id', async () => {
        await repositories.appointments.create(
          makeAppointment({ id: 'a-late', scheduledAt: asTimestamp('2026-11-01T08:00:00Z') }),
        );
        await repositories.appointments.create(
          makeAppointment({ id: 'a-b', scheduledAt: asTimestamp('2026-10-20T08:00:00Z') }),
        );
        await repositories.appointments.create(
          makeAppointment({ id: 'a-a', scheduledAt: asTimestamp('2026-10-20T08:00:00Z') }),
        );

        const list = await repositories.appointments.list();

        expect(list.map((appointment) => appointment.id)).toEqual(['a-a', 'a-b', 'a-late']);
      });

      it('rejects a duplicate id and an invalid appointment, storing nothing extra', async () => {
        await repositories.appointments.create(makeAppointment({ id: 'a-1' }));

        const duplicate = await failureOf(
          repositories.appointments.create(makeAppointment({ id: 'a-1' })),
        );
        const invalid = await failureOf(
          repositories.appointments.create(
            makeAppointment({ id: 'a-2', doctorName: null, specialty: null }),
          ),
        );

        expect(duplicate.code).toBe('duplicate-id');
        expect(invalid.code).toBe('invalid-input');
        expect(await repositories.appointments.list()).toHaveLength(1);
      });

      it('rejects reading, updating and deleting an appointment that does not exist', async () => {
        expect((await failureOf(repositories.appointments.get('ghost'))).code).toBe('not-found');
        expect(
          (await failureOf(repositories.appointments.update(makeAppointment({ id: 'ghost' }))))
            .code,
        ).toBe('not-found');
        expect((await failureOf(repositories.appointments.remove('ghost'))).code).toBe('not-found');
        expect(await repositories.appointments.list()).toEqual([]);
      });

      it('stores a status change made with the Stage 2 domain logic, keeping the date and other details', async () => {
        const appointment = makeAppointment({ id: 'a-1', location: 'Gabinet 4' });
        await repositories.appointments.create(appointment);

        const result = changeAppointmentStatus(appointment, 'completed', NOW);
        if (!result.ok) throw new Error('the status change should be allowed');
        await repositories.appointments.update(result.appointment);

        expect(await repositories.appointments.get('a-1')).toEqual({
          ...appointment,
          status: 'completed',
          updatedAt: NOW,
        });
      });

      it('deletes one appointment and leaves the others', async () => {
        await repositories.appointments.create(makeAppointment({ id: 'a-1' }));
        await repositories.appointments.create(makeAppointment({ id: 'a-2' }));

        await repositories.appointments.remove('a-1');

        expect((await repositories.appointments.list()).map((a) => a.id)).toEqual(['a-2']);
      });

      it('is still there after the repositories are reopened (persistence)', async () => {
        const appointment = makeAppointment({ id: 'a-1' });
        await repositories.appointments.create(appointment);

        expect(await reopen().appointments.list()).toEqual([appointment]);
      });
    });

    describe('isolation between collections', () => {
      it('changing appointments does not touch medications or intake records, and vice versa', async () => {
        const medication = makeMedication({ id: 'med-1' });
        const log = makeDoseLog({ id: 'l-1' });
        await repositories.medications.create(medication);
        await repositories.doseLogs.upsert(log);

        await repositories.appointments.create(makeAppointment({ id: 'a-1' }));
        await repositories.appointments.remove('a-1');

        expect(await repositories.medications.list()).toEqual([medication]);
        expect(await repositories.doseLogs.listByDateRange(TODAY, TODAY)).toEqual([log]);

        await repositories.appointments.create(makeAppointment({ id: 'a-2' }));
        await repositories.medications.remove('med-1');
        expect(await repositories.appointments.list()).toHaveLength(1);
      });
    });
  });
}
