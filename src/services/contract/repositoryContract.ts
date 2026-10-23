import { beforeEach, describe, expect, it } from 'vitest';
import { changeAppointmentStatus } from '@/features/appointments/logic/status';
import { changeDoseStatus, recordDose, undoDose } from '@/features/doses/logic/recording';
import type { DoseSlot, ScheduledDose } from '@/features/doses/types';
import { applyScheduleChange } from '@/features/medications/logic/schedule';
import { asLocalDate, asLocalTime, asTimestamp } from '@/utils/date';
import {
  makeAppointment,
  makeDoseLog,
  makeMedication,
  makeStockEvent,
  scheduleTime,
} from '@/test/fixtures';
import { RepositoryError } from '../errors';
import type { Repositories } from '../repositories';

/**
 * Behaviour EVERY implementation of the repository interfaces must have, whatever it stores
 * data in. It knows nothing about localStorage: the local implementation runs it
 * (src/services/local), and the Supabase implementation (src/services/supabase) runs it against a
 * real local Supabase stack (supabase/tests/client). Details of one particular storage (corrupt
 * JSON, quota errors, keys, SQL error codes) belong in that implementation's own tests, not here.
 */
export interface ContractContext {
  repositories: Repositories;
  /** New repositories over the SAME stored data, as after reloading the application. */
  reopen: () => Repositories;
  /**
   * False for a store that cannot tell an optional field that was left out from one that was set to
   * `null` (a SQL column holds NULL for both). Such a store reads both back as absent. Default true.
   */
  distinguishesNullFromAbsent?: boolean;
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

export function describeRepositoryContract(
  name: string,
  setup: () => ContractContext | Promise<ContractContext>,
): void {
  describe(`repository contract: ${name}`, () => {
    let repositories: Repositories;
    let reopen: () => Repositories;
    let distinguishesNullFromAbsent = true;

    beforeEach(async () => {
      const context = await setup();
      ({ repositories, reopen } = context);
      distinguishesNullFromAbsent = context.distinguishesNullFromAbsent ?? true;
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
        ['an unknown dosage form', { dosageForm: 'powder' as never }],
        ['a strength of zero', { strength: { value: 0, unit: 'mg' } }],
        ['a negative strength', { strength: { value: -5, unit: 'mg' } }],
        ['a strength with more than three decimals', { strength: { value: 1.2345, unit: 'mg' } }],
        ['a strength unit that is not on the list', { strength: { value: 5, unit: 'tabletka' } }],
        ['a strength without a unit', { strength: { value: 5 } as never }],
        ['a strength that is not an object', { strength: 'mocny' as never }],
        [
          'a negative low-stock threshold',
          {
            stock: { quantity: 5, unit: 'tabletka', asOf: NOW },
            lowStockThreshold: { quantity: -1, unit: 'tabletka' },
          },
        ],
        [
          'a low-stock threshold with more than three decimals',
          {
            stock: { quantity: 5, unit: 'tabletka', asOf: NOW },
            lowStockThreshold: { quantity: 1.2345, unit: 'tabletka' },
          },
        ],
        [
          'a low-stock threshold without a unit',
          {
            stock: { quantity: 5, unit: 'tabletka', asOf: NOW },
            lowStockThreshold: { quantity: 1, unit: ' ' },
          },
        ],
        [
          'a low-stock threshold that is not an object',
          { stock: { quantity: 5, unit: 'tabletka', asOf: NOW }, lowStockThreshold: 5 as never },
        ],
        [
          'a low-stock threshold with no stock to be about',
          { stock: null, lowStockThreshold: { quantity: 1, unit: 'tabletka' } },
        ],
      ])('refuses to store a medication with %s', async (_label, overrides) => {
        const error = await failureOf(
          repositories.medications.create(makeMedication({ id: 'm-1', ...overrides })),
        );

        expect(error.code).toBe('invalid-input');
        expect(await repositories.medications.list()).toEqual([]);
      });

      it('stores and returns the dosage form and the strength as given', async () => {
        const medication = makeMedication({
          id: 'm-1',
          dosageForm: 'liquid',
          strength: { value: 2.5, unit: 'mg/ml' },
        });

        await repositories.medications.create(medication);

        expect(await repositories.medications.get('m-1')).toEqual(medication);
        expect(await repositories.medications.list()).toEqual([medication]);
      });

      it('still has the dosage form and the strength after the repositories are reopened', async () => {
        const medication = makeMedication({
          id: 'm-1',
          dosageForm: 'drops',
          strength: { value: 10, unit: 'mg/ml' },
        });
        await repositories.medications.create(medication);

        expect(await reopen().medications.get('m-1')).toEqual(medication);
      });

      it('stores and returns the low-stock threshold as given, including zero and a unit written freely', async () => {
        const medication = makeMedication({
          id: 'm-1',
          stock: { quantity: 5, unit: 'Opakowanie ', asOf: NOW },
          lowStockThreshold: { quantity: 0, unit: 'Opakowanie ' },
        });

        await repositories.medications.create(medication);

        expect(await repositories.medications.get('m-1')).toEqual(medication);
        expect(await reopen().medications.get('m-1')).toEqual(medication);
      });

      it('replaces and removes the low-stock threshold on update', async () => {
        const stock = { quantity: 5, unit: 'tabletka', asOf: NOW };
        await repositories.medications.create(
          makeMedication({
            id: 'm-1',
            stock,
            lowStockThreshold: { quantity: 2, unit: 'tabletka' },
          }),
        );

        await repositories.medications.update(
          makeMedication({
            id: 'm-1',
            stock,
            lowStockThreshold: { quantity: 3, unit: 'tabletka' },
          }),
        );
        expect((await repositories.medications.get('m-1')).lowStockThreshold).toEqual({
          quantity: 3,
          unit: 'tabletka',
        });

        await repositories.medications.update(makeMedication({ id: 'm-1', stock }));
        expect('lowStockThreshold' in (await repositories.medications.get('m-1'))).toBe(false);
      });

      it('keeps a medication without the optional fields without them: absent stays absent', async () => {
        await repositories.medications.create(makeMedication({ id: 'm-1' }));

        const read = await repositories.medications.get('m-1');

        expect('dosageForm' in read).toBe(false);
        expect('strength' in read).toBe(false);
        expect('lowStockThreshold' in read).toBe(false);
      });

      it('keeps an explicitly empty strength (null) as null, and does not invent one', async () => {
        await repositories.medications.create(makeMedication({ id: 'm-1', strength: null }));

        const { strength } = await repositories.medications.get('m-1');

        // A SQL column cannot hold "null" apart from "left out": such a store reads both back as none.
        expect(distinguishesNullFromAbsent ? strength : (strength ?? null)).toBeNull();
      });

      it('replaces the dosage form and the strength on update, and removes them when the update has none', async () => {
        await repositories.medications.create(
          makeMedication({ id: 'm-1', dosageForm: 'tablet', strength: { value: 500, unit: 'mg' } }),
        );

        await repositories.medications.update(
          makeMedication({ id: 'm-1', dosageForm: 'capsule', strength: { value: 1, unit: 'g' } }),
        );
        expect(await repositories.medications.get('m-1')).toMatchObject({
          dosageForm: 'capsule',
          strength: { value: 1, unit: 'g' },
        });

        await repositories.medications.update(makeMedication({ id: 'm-1' }));
        const read = await repositories.medications.get('m-1');
        expect('dosageForm' in read).toBe(false);
        expect('strength' in read).toBe(false);
      });

      it('keeps a unit that is not on any list exactly as it was written', async () => {
        const unit = 'Inhalacja ';
        await repositories.medications.create(
          makeMedication({
            id: 'm-1',
            doseUnit: unit,
            dosageForm: 'inhaler',
            stock: { quantity: 3, unit, asOf: NOW },
          }),
        );

        const read = await repositories.medications.get('m-1');

        expect(read.doseUnit).toBe(unit);
        expect(read.stock?.unit).toBe(unit);
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

      it('stores the amount actually taken and the note beside the plan, and reads them back after a reopen', async () => {
        const log = makeDoseLog({
          id: 'l-1',
          doseAmount: 1,
          takenAmount: 2,
          note: 'Zgodnie z zaleceniem lekarza',
        });

        await repositories.doseLogs.upsert(log);

        const [read] = await repositories.doseLogs.listByDateRange(TODAY, TODAY);
        expect(read).toEqual(log);
        expect(read).toMatchObject({ doseAmount: 1, takenAmount: 2 });
        expect(await reopen().doseLogs.listByDateRange(TODAY, TODAY)).toEqual([log]);
      });

      it('accepts a note of exactly 500 characters and a smaller amount than the plan', async () => {
        await repositories.doseLogs.upsert(
          makeDoseLog({ id: 'l-1', doseAmount: 2, takenAmount: 0.5, note: 'x'.repeat(500) }),
        );

        expect(await repositories.doseLogs.listByDateRange(TODAY, TODAY)).toHaveLength(1);
      });

      it('keeps a record saved before these fields without them: absent stays absent', async () => {
        await repositories.doseLogs.upsert(makeDoseLog({ id: 'l-1' }));

        const [read] = await repositories.doseLogs.listByDateRange(TODAY, TODAY);

        expect(read && 'takenAmount' in read).toBe(false);
        expect(read && 'note' in read).toBe(false);
      });

      it('replaces the details when the same record is stored again, and removes them when it has none', async () => {
        await repositories.doseLogs.upsert(makeDoseLog({ id: 'l-1', takenAmount: 2, note: 'a' }));

        await repositories.doseLogs.upsert(makeDoseLog({ id: 'l-1', takenAmount: 3, note: 'b' }));
        expect((await repositories.doseLogs.listByDateRange(TODAY, TODAY))[0]).toMatchObject({
          takenAmount: 3,
          note: 'b',
        });

        await repositories.doseLogs.upsert(makeDoseLog({ id: 'l-1' }));
        const [read] = await repositories.doseLogs.listByDateRange(TODAY, TODAY);
        expect(read && 'takenAmount' in read).toBe(false);
        expect(read && 'note' in read).toBe(false);
        expect(await repositories.doseLogs.listByDateRange(TODAY, TODAY)).toHaveLength(1);
      });

      it('does not touch the medication or its schedule when a record with an amount is stored', async () => {
        const before = await repositories.medications.get('med-1');

        await repositories.doseLogs.upsert(makeDoseLog({ id: 'l-1', takenAmount: 5 }));

        expect(await repositories.medications.get('med-1')).toEqual(before);
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
        ['an amount taken of zero', { takenAmount: 0 }],
        ['a negative amount taken', { takenAmount: -1 }],
        ['an amount taken with more than three decimals', { takenAmount: 1.2345 }],
        ['an amount taken that is not a number', { takenAmount: '2' as never }],
        ['an amount taken on a skipped dose', { status: 'skipped' as const, takenAmount: 2 }],
        ['a note that is too long', { note: 'x'.repeat(501) }],
        ['a note on a skipped dose', { status: 'skipped' as const, note: 'x' }],
        ['a note that is not text', { note: 5 as never }],
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

    describe('counting the intake history of a medication', () => {
      beforeEach(async () => {
        await repositories.medications.create(makeMedication({ id: 'med-1' }));
        await repositories.medications.create(makeMedication({ id: 'med-2', name: 'Drugi' }));
      });

      it('is 0 for a medication without records and for an unknown id', async () => {
        expect(await repositories.doseLogs.countForMedication('med-1')).toBe(0);
        expect(await repositories.doseLogs.countForMedication('no-such-medication')).toBe(0);
      });

      it('counts all dates of one medication and none of another', async () => {
        await repositories.doseLogs.upsert(makeDoseLog({ id: 'l-1', medicationId: 'med-1' }));
        await repositories.doseLogs.upsert(
          makeDoseLog({
            id: 'l-2',
            medicationId: 'med-1',
            scheduledDate: asLocalDate('2026-03-01'),
          }),
        );
        await repositories.doseLogs.upsert(
          makeDoseLog({ id: 'l-3', medicationId: 'med-1', scheduledTime: asLocalTime('20:00') }),
        );
        await repositories.doseLogs.upsert(makeDoseLog({ id: 'l-4', medicationId: 'med-2' }));

        expect(await repositories.doseLogs.countForMedication('med-1')).toBe(3);
        expect(await repositories.doseLogs.countForMedication('med-2')).toBe(1);
      });

      it('follows undo, replacement and deletion of the medication', async () => {
        await repositories.doseLogs.upsert(makeDoseLog({ id: 'l-1', medicationId: 'med-1' }));
        await repositories.doseLogs.upsert(
          makeDoseLog({ id: 'l-2', medicationId: 'med-1', scheduledTime: asLocalTime('20:00') }),
        );

        // Changing a record's status replaces it: still one record, so still counted once.
        await repositories.doseLogs.upsert(
          makeDoseLog({ id: 'l-1', medicationId: 'med-1', status: 'skipped' }),
        );
        expect(await repositories.doseLogs.countForMedication('med-1')).toBe(2);

        await repositories.doseLogs.remove({ medicationId: 'med-1', date: TODAY, time: MORNING });
        expect(await repositories.doseLogs.countForMedication('med-1')).toBe(1);

        await repositories.medications.remove('med-1');
        expect(await repositories.doseLogs.countForMedication('med-1')).toBe(0);
      });

      it('is the number of records that deleting the medication destroys', async () => {
        await repositories.doseLogs.upsert(makeDoseLog({ id: 'l-1', medicationId: 'med-1' }));
        await repositories.doseLogs.upsert(
          makeDoseLog({ id: 'l-2', medicationId: 'med-1', scheduledTime: asLocalTime('20:00') }),
        );
        await repositories.doseLogs.upsert(makeDoseLog({ id: 'l-3', medicationId: 'med-2' }));
        const before = await repositories.doseLogs.listByDateRange(
          asLocalDate('2000-01-01'),
          asLocalDate('2999-12-31'),
        );
        const announced = await repositories.doseLogs.countForMedication('med-1');

        await repositories.medications.remove('med-1');

        const after = await repositories.doseLogs.listByDateRange(
          asLocalDate('2000-01-01'),
          asLocalDate('2999-12-31'),
        );
        expect(before.length - after.length).toBe(announced);
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

    describe('stock events', () => {
      const withMedication = async (id = 'med-1') => {
        await repositories.medications.create(
          makeMedication({ id, stock: { quantity: 10, unit: 'tabletka', asOf: NOW } }),
        );
      };

      it('starts empty', async () => {
        expect(await repositories.stockEvents.list()).toEqual([]);
        expect(await repositories.stockEvents.listForMedication('med-1')).toEqual([]);
        expect(await repositories.stockEvents.countForMedication('med-1')).toBe(0);
      });

      it('appends an event and returns it as given, in the list and in the list of its medication', async () => {
        await withMedication();
        const event = makeStockEvent({ id: 'ev-1', note: 'Nowe opakowanie' });

        const appended = await repositories.stockEvents.append(event);

        expect(appended).toEqual(event);
        expect(await repositories.stockEvents.list()).toEqual([event]);
        expect(await repositories.stockEvents.listForMedication('med-1')).toEqual([event]);
        expect(await repositories.stockEvents.countForMedication('med-1')).toBe(1);
      });

      it('stores the note on the event, and null when there is none', async () => {
        await withMedication();
        await repositories.stockEvents.append(makeStockEvent({ id: 'a', note: 'Skąd: apteka' }));
        await repositories.stockEvents.append(makeStockEvent({ id: 'b', note: null }));

        const events = await repositories.stockEvents.list();

        expect(events.find((event) => event.id === 'a')?.note).toBe('Skąd: apteka');
        expect(events.find((event) => event.id === 'b')?.note).toBeNull();
      });

      it('rejects a second event with an existing id and keeps the first unchanged', async () => {
        await withMedication();
        await repositories.stockEvents.append(makeStockEvent({ id: 'ev-1', amount: 30 }));

        const error = await failureOf(
          repositories.stockEvents.append(makeStockEvent({ id: 'ev-1', amount: 99 })),
        );

        expect(error.code).toBe('duplicate-id');
        expect(await repositories.stockEvents.list()).toHaveLength(1);
        expect((await repositories.stockEvents.list())[0]?.amount).toBe(30);
      });

      it('rejects an event of a medication that does not exist, and stores nothing', async () => {
        const error = await failureOf(
          repositories.stockEvents.append(makeStockEvent({ id: 'ev-1', medicationId: 'ghost' })),
        );

        expect(error.code).toBe('missing-reference');
        expect(await repositories.stockEvents.list()).toEqual([]);
      });

      it.each([
        ['an amount of zero', { amount: 0 }],
        ['a negative amount', { amount: -1 }],
        ['an amount with more than three decimals', { amount: 1.2345 }],
        ['an amount that is too large', { amount: 10_000_000 }],
        ['a blank unit', { unit: ' ' }],
        ['an unknown kind', { kind: 'gift' as never }],
        ['a note that is too long', { note: 'x'.repeat(501) }],
        ['a blank id', { id: ' ' }],
        ['a reversal before the event', { reversedAt: asTimestamp('2026-10-01T00:00:00Z') }],
      ])('refuses to store an event with %s', async (_label, overrides) => {
        await withMedication();

        const error = await failureOf(
          repositories.stockEvents.append(makeStockEvent({ id: 'ev-1', ...overrides })),
        );

        expect(error.code).toBe('invalid-input');
        expect(await repositories.stockEvents.list()).toEqual([]);
      });

      it('accepts a note of exactly 500 characters', async () => {
        await withMedication();

        await repositories.stockEvents.append(
          makeStockEvent({ id: 'ev-1', note: 'x'.repeat(500) }),
        );

        expect(await repositories.stockEvents.list()).toHaveLength(1);
      });

      it('lists events oldest first, and keeps those of another medication apart', async () => {
        await withMedication('med-1');
        await withMedication('med-2');
        await repositories.stockEvents.append(
          makeStockEvent({ id: 'late', recordedAt: asTimestamp('2026-10-12T08:00:00Z') }),
        );
        await repositories.stockEvents.append(
          makeStockEvent({ id: 'early', recordedAt: asTimestamp('2026-10-11T08:00:00Z') }),
        );
        await repositories.stockEvents.append(
          makeStockEvent({ id: 'other', medicationId: 'med-2' }),
        );

        expect((await repositories.stockEvents.list()).map((event) => event.id)).toEqual([
          'other',
          'early',
          'late',
        ]);
        expect(
          (await repositories.stockEvents.listForMedication('med-1')).map((event) => event.id),
        ).toEqual(['early', 'late']);
        expect(await repositories.stockEvents.countForMedication('med-2')).toBe(1);
      });

      it('an unknown medication has no events and counts zero: that is not an error', async () => {
        expect(await repositories.stockEvents.listForMedication('nope')).toEqual([]);
        expect(await repositories.stockEvents.countForMedication('nope')).toBe(0);
      });

      it('is still there after the repositories are reopened (persistence)', async () => {
        await withMedication();
        const event = makeStockEvent({ id: 'ev-1', note: 'Notatka' });
        await repositories.stockEvents.append(event);

        expect(await reopen().stockEvents.list()).toEqual([event]);
      });

      it('stores a waste event the same way, with its note, and keeps the doses untouched', async () => {
        await withMedication();
        const waste = makeStockEvent({ id: 'w-1', kind: 'waste', amount: 2, note: 'Wypadły' });
        const before = await repositories.doseLogs.listByDateRange(TODAY, TODAY);

        await repositories.stockEvents.append(waste);

        expect(await repositories.stockEvents.list()).toEqual([waste]);
        expect(await reopen().stockEvents.list()).toEqual([waste]);
        expect(await repositories.doseLogs.listByDateRange(TODAY, TODAY)).toEqual(before);
        expect(await repositories.medications.get('med-1')).toMatchObject({
          scheduleTimes: [expect.objectContaining({ timeOfDay: '08:00' })],
        });
      });

      it('reverses a waste event like any other: kept, marked, repeated reversal changes nothing', async () => {
        await withMedication();
        await repositories.stockEvents.append(makeStockEvent({ id: 'w-1', kind: 'waste' }));

        const first = await repositories.stockEvents.reverse('w-1', NOW);
        const second = await repositories.stockEvents.reverse(
          'w-1',
          asTimestamp('2026-10-16T10:00:00Z'),
        );

        expect(first).toMatchObject({ kind: 'waste', reversedAt: NOW });
        expect(second).toEqual(first);
      });

      describe('reversal', () => {
        const REVERSED_AT = asTimestamp('2026-10-15T10:00:00Z');

        it('marks the event as reversed and keeps it, with everything else as it was', async () => {
          await withMedication();
          const event = makeStockEvent({ id: 'ev-1', note: 'Notatka' });
          await repositories.stockEvents.append(event);

          const reversed = await repositories.stockEvents.reverse('ev-1', REVERSED_AT);

          expect(reversed).toEqual({ ...event, reversedAt: REVERSED_AT });
          expect(await repositories.stockEvents.list()).toEqual([reversed]);
          expect(await reopen().stockEvents.list()).toEqual([reversed]);
          expect(await repositories.stockEvents.countForMedication('med-1')).toBe(1);
        });

        it('reversing again changes nothing, not even the moment', async () => {
          await withMedication();
          await repositories.stockEvents.append(makeStockEvent({ id: 'ev-1' }));
          const first = await repositories.stockEvents.reverse('ev-1', REVERSED_AT);

          const second = await repositories.stockEvents.reverse(
            'ev-1',
            asTimestamp('2026-10-16T10:00:00Z'),
          );

          expect(second).toEqual(first);
          expect((await repositories.stockEvents.list())[0]?.reversedAt).toBe(REVERSED_AT);
        });

        it('touches only the event it names', async () => {
          await withMedication();
          await repositories.stockEvents.append(makeStockEvent({ id: 'a' }));
          const other = await repositories.stockEvents.append(makeStockEvent({ id: 'b' }));

          await repositories.stockEvents.reverse('a', REVERSED_AT);

          expect((await repositories.stockEvents.list()).find((event) => event.id === 'b')).toEqual(
            other,
          );
        });

        it('rejects an event that does not exist', async () => {
          const error = await failureOf(repositories.stockEvents.reverse('nope', REVERSED_AT));

          expect(error.code).toBe('not-found');
        });

        it('rejects a moment before the event was recorded, and keeps the event as it was', async () => {
          await withMedication();
          const event = makeStockEvent({ id: 'ev-1' });
          await repositories.stockEvents.append(event);

          const error = await failureOf(
            repositories.stockEvents.reverse('ev-1', asTimestamp('2026-10-01T00:00:00Z')),
          );

          expect(error.code).toBe('invalid-input');
          expect(await repositories.stockEvents.list()).toEqual([event]);
        });
      });

      describe('together with the medication (cascade)', () => {
        it('deleting a medication deletes its events, and only its events', async () => {
          await withMedication('med-1');
          await withMedication('med-2');
          await repositories.stockEvents.append(makeStockEvent({ id: 'a', medicationId: 'med-1' }));
          await repositories.stockEvents.append(makeStockEvent({ id: 'b', medicationId: 'med-1' }));
          const kept = await repositories.stockEvents.append(
            makeStockEvent({ id: 'c', medicationId: 'med-2' }),
          );

          await repositories.medications.remove('med-1');

          expect(await repositories.stockEvents.list()).toEqual([kept]);
          expect(await repositories.stockEvents.countForMedication('med-1')).toBe(0);
          expect(await reopen().stockEvents.list()).toEqual([kept]);
        });

        it('also removes the reversed events: nothing is left of a deleted medication', async () => {
          await withMedication();
          await repositories.stockEvents.append(makeStockEvent({ id: 'a' }));
          await repositories.stockEvents.reverse('a', NOW);

          await repositories.medications.remove('med-1');

          expect(await repositories.stockEvents.list()).toEqual([]);
        });

        it('deleting a medication with intake records and events removes all of them', async () => {
          await withMedication();
          await repositories.doseLogs.upsert(makeDoseLog({ id: 'l-1', medicationId: 'med-1' }));
          await repositories.stockEvents.append(makeStockEvent({ id: 'a' }));

          await repositories.medications.remove('med-1');

          expect(await repositories.doseLogs.listByDateRange(TODAY, TODAY)).toEqual([]);
          expect(await repositories.stockEvents.list()).toEqual([]);
          expect(await repositories.medications.list()).toEqual([]);
        });

        it('deleting a medication that has no events leaves the other events alone', async () => {
          await withMedication('med-1');
          await withMedication('med-2');
          const kept = await repositories.stockEvents.append(
            makeStockEvent({ id: 'c', medicationId: 'med-2' }),
          );

          await repositories.medications.remove('med-1');

          expect(await repositories.stockEvents.list()).toEqual([kept]);
        });

        it('keeps the events when the medication is only updated (ended)', async () => {
          await withMedication();
          const event = await repositories.stockEvents.append(makeStockEvent({ id: 'a' }));
          const medication = await repositories.medications.get('med-1');

          await repositories.medications.update({ ...medication, endDate: TODAY });

          expect(await repositories.stockEvents.list()).toEqual([event]);
        });
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
