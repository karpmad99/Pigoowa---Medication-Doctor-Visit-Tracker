import { describe, expect, it } from 'vitest';
import { asLocalDate, asLocalTime, asTimestamp } from '@/utils/date';
import { assertOk, makeDoseLog } from '@/test/fixtures';
import type { DoseSlot, ScheduledDose } from '../types';
import {
  adjustTakenAmount,
  changeDoseStatus,
  recordDose,
  undoDose,
  type RecordingContext,
} from './recording';

// 10:00 UTC on 15 October 2026 is 12:00 in Warsaw (UTC+2): "today" is 2026-10-15.
const context: RecordingContext = {
  now: asTimestamp('2026-10-15T10:00:00Z'),
  timeZone: 'Europe/Warsaw',
};

const slot: DoseSlot = {
  medicationId: 'med-1',
  date: asLocalDate('2026-10-15'),
  time: asLocalTime('08:00'),
};

const dose: ScheduledDose = {
  ...slot,
  medicationName: 'Lek A',
  doseAmount: 2,
  doseUnit: 'tabletka',
  status: 'unrecorded',
  log: null,
};

const existingTaken = makeDoseLog({
  id: 'log-existing',
  status: 'taken',
  doseAmount: 1,
  doseUnit: 'kapsułka',
  recordedAt: asTimestamp('2026-10-15T06:05:00Z'),
});

describe('recordDose', () => {
  it('creates a taken record that copies the dose amount and unit', () => {
    const result = recordDose({ dose, status: 'taken', newLogId: 'new-id', logs: [], context });

    assertOk(result);
    expect(result.change).toBe('created');
    expect(result.log).toEqual({
      id: 'new-id',
      medicationId: 'med-1',
      scheduledDate: '2026-10-15',
      scheduledTime: '08:00',
      status: 'taken',
      doseAmount: 2,
      doseUnit: 'tabletka',
      recordedAt: '2026-10-15T10:00:00.000Z',
    });
    expect(result.logs).toEqual([result.log]);
  });

  it('creates a skipped record that is distinguishable from a taken one', () => {
    const result = recordDose({ dose, status: 'skipped', newLogId: 'new-id', logs: [], context });

    assertOk(result);
    expect(result.log?.status).toBe('skipped');
  });

  it('keeps the other records and does not modify the list it was given', () => {
    const other = makeDoseLog({ id: 'other', scheduledTime: asLocalTime('20:00') });
    const logs = [other];

    const result = recordDose({ dose, status: 'taken', newLogId: 'new-id', logs, context });

    assertOk(result);
    expect(result.logs).toEqual([other, result.log]);
    expect(logs).toEqual([other]);
  });

  it('is safe to repeat: the same action again changes nothing and adds no second record', () => {
    const first = recordDose({ dose, status: 'taken', newLogId: 'id-1', logs: [], context });
    assertOk(first);

    const repeated = recordDose({
      dose,
      status: 'taken',
      newLogId: 'id-2',
      logs: first.logs,
      context: { ...context, now: asTimestamp('2026-10-15T10:00:05Z') },
    });

    assertOk(repeated);
    expect(repeated.change).toBe('unchanged');
    expect(repeated.logs).toHaveLength(1);
    expect(repeated.log).toEqual(first.log);
  });

  it('refuses to overwrite a record that has a different status', () => {
    const result = recordDose({
      dose,
      status: 'skipped',
      newLogId: 'x',
      logs: [existingTaken],
      context,
    });

    expect(result).toEqual({ ok: false, error: 'already-recorded' });
  });

  it('refuses to act when the data holds conflicting records for the slot', () => {
    const duplicate = makeDoseLog({ id: 'log-duplicate', status: 'skipped' });

    const result = recordDose({
      dose,
      status: 'taken',
      newLogId: 'x',
      logs: [existingTaken, duplicate],
      context,
    });

    expect(result).toEqual({ ok: false, error: 'conflicting-records' });
  });

  it('refuses unusable doses instead of storing a misleading record', () => {
    expect(
      recordDose({
        dose: { ...dose, doseAmount: 0 },
        status: 'taken',
        newLogId: 'x',
        logs: [],
        context,
      }),
    ).toEqual({
      ok: false,
      error: 'invalid-dose',
    });
    expect(
      recordDose({
        dose: { ...dose, doseUnit: '  ' },
        status: 'taken',
        newLogId: 'x',
        logs: [],
        context,
      }),
    ).toEqual({
      ok: false,
      error: 'invalid-dose',
    });
  });

  describe('future doses', () => {
    it('can be recorded for today and for past days', () => {
      const yesterday = { ...dose, date: asLocalDate('2026-10-14') };
      expect(recordDose({ dose, status: 'taken', newLogId: 'a', logs: [], context }).ok).toBe(true);
      expect(
        recordDose({ dose: yesterday, status: 'taken', newLogId: 'b', logs: [], context }).ok,
      ).toBe(true);
    });

    it('cannot be recorded for tomorrow', () => {
      const tomorrow = { ...dose, date: asLocalDate('2026-10-16') };
      expect(
        recordDose({ dose: tomorrow, status: 'taken', newLogId: 'a', logs: [], context }),
      ).toEqual({
        ok: false,
        error: 'future-date',
      });
    });

    it('uses the user\'s time zone to decide what "today" is', () => {
      // 22:30 UTC on the 15th is already 00:30 on the 16th in Warsaw.
      const lateEvening: RecordingContext = {
        ...context,
        now: asTimestamp('2026-10-15T22:30:00Z'),
      };
      const tomorrow = { ...dose, date: asLocalDate('2026-10-16') };

      expect(
        recordDose({
          dose: tomorrow,
          status: 'taken',
          newLogId: 'a',
          logs: [],
          context: lateEvening,
        }).ok,
      ).toBe(true);
      expect(
        recordDose({
          dose: tomorrow,
          status: 'taken',
          newLogId: 'a',
          logs: [],
          context: { ...lateEvening, timeZone: 'UTC' },
        }),
      ).toEqual({ ok: false, error: 'future-date' });
    });
  });
});

describe('changeDoseStatus', () => {
  it('updates the existing record in place: same id, new status, new recording time', () => {
    const other = makeDoseLog({ id: 'other', scheduledTime: asLocalTime('20:00') });

    const result = changeDoseStatus({
      slot,
      status: 'skipped',
      logs: [other, existingTaken],
      context,
    });

    assertOk(result);
    expect(result.change).toBe('updated');
    expect(result.log).toEqual({
      ...existingTaken,
      status: 'skipped',
      recordedAt: '2026-10-15T10:00:00.000Z',
    });
    expect(result.logs).toEqual([other, result.log]);
    expect(result.logs).toHaveLength(2);
  });

  it('keeps the amount and unit that were recorded originally, not the current schedule values', () => {
    const result = changeDoseStatus({ slot, status: 'skipped', logs: [existingTaken], context });

    assertOk(result);
    expect(result.log?.doseAmount).toBe(1);
    expect(result.log?.doseUnit).toBe('kapsułka');
  });

  it('works both ways, taken to skipped and back, always leaving one record', () => {
    const toSkipped = changeDoseStatus({ slot, status: 'skipped', logs: [existingTaken], context });
    assertOk(toSkipped);
    const backToTaken = changeDoseStatus({ slot, status: 'taken', logs: toSkipped.logs, context });
    assertOk(backToTaken);

    expect(backToTaken.logs).toHaveLength(1);
    expect(backToTaken.log?.id).toBe('log-existing');
    expect(backToTaken.log?.status).toBe('taken');
  });

  it('changes nothing when the status is already the requested one', () => {
    const result = changeDoseStatus({ slot, status: 'taken', logs: [existingTaken], context });

    assertOk(result);
    expect(result.change).toBe('unchanged');
    expect(result.log).toBe(existingTaken);
  });

  it('fails for a slot without a record, rather than creating one', () => {
    const result = changeDoseStatus({ slot, status: 'skipped', logs: [], context });

    expect(result).toEqual({ ok: false, error: 'record-not-found' });
  });

  it('does not match a record of another slot', () => {
    const otherSlotLog = makeDoseLog({ scheduledTime: asLocalTime('20:00') });

    expect(changeDoseStatus({ slot, status: 'skipped', logs: [otherSlotLog], context })).toEqual({
      ok: false,
      error: 'record-not-found',
    });
  });

  it('refuses to act on conflicting records and changes none of them', () => {
    const duplicate = makeDoseLog({ id: 'log-duplicate', status: 'skipped' });

    expect(
      changeDoseStatus({ slot, status: 'taken', logs: [existingTaken, duplicate], context }),
    ).toEqual({
      ok: false,
      error: 'conflicting-records',
    });
  });

  it('refuses future dates', () => {
    const tomorrow = { ...slot, date: asLocalDate('2026-10-16') };

    expect(changeDoseStatus({ slot: tomorrow, status: 'skipped', logs: [], context })).toEqual({
      ok: false,
      error: 'future-date',
    });
  });
});

describe('undoDose', () => {
  it("removes the slot's record, returning the dose to unrecorded", () => {
    const other = makeDoseLog({ id: 'other', scheduledTime: asLocalTime('20:00') });

    const result = undoDose({ slot, logs: [other, existingTaken] });

    assertOk(result);
    expect(result.change).toBe('removed');
    expect(result.log).toBeNull();
    expect(result.logs).toEqual([other]);
  });

  it('does nothing and creates nothing when the dose was never recorded', () => {
    const other = makeDoseLog({ id: 'other', scheduledTime: asLocalTime('20:00') });

    const result = undoDose({ slot, logs: [other] });

    assertOk(result);
    expect(result.change).toBe('none');
    expect(result.logs).toEqual([other]);
  });

  it('is safe to repeat', () => {
    const first = undoDose({ slot, logs: [existingTaken] });
    assertOk(first);
    const second = undoDose({ slot, logs: first.logs });

    assertOk(second);
    expect(second.change).toBe('none');
    expect(second.logs).toEqual([]);
  });

  it('leaves records of other days and medications alone', () => {
    const otherDay = makeDoseLog({ id: 'day', scheduledDate: asLocalDate('2026-10-14') });
    const otherMedication = makeDoseLog({ id: 'med', medicationId: 'med-2' });

    const result = undoDose({ slot, logs: [otherDay, existingTaken, otherMedication] });

    assertOk(result);
    expect(result.logs.map((log) => log.id)).toEqual(['day', 'med']);
  });

  it('refuses to guess which of several conflicting records to remove', () => {
    const duplicate = makeDoseLog({ id: 'log-duplicate' });

    expect(undoDose({ slot, logs: [existingTaken, duplicate] })).toEqual({
      ok: false,
      error: 'conflicting-records',
    });
  });

  it('allows a new record to be made after an undo (record -> undo -> record)', () => {
    const recorded = recordDose({ dose, status: 'taken', newLogId: 'id-1', logs: [], context });
    assertOk(recorded);
    const undone = undoDose({ slot, logs: recorded.logs });
    assertOk(undone);
    const again = recordDose({
      dose,
      status: 'skipped',
      newLogId: 'id-2',
      logs: undone.logs,
      context,
    });

    assertOk(again);
    expect(again.change).toBe('created');
    expect(again.logs).toHaveLength(1);
    expect(again.log?.status).toBe('skipped');
  });
});

describe('recordDose with the amount actually taken and a note (DEC-48)', () => {
  const record = (
    details: Parameters<typeof recordDose>[0]['details'],
    status: 'taken' | 'skipped' = 'taken',
    logs = [] as ReturnType<typeof makeDoseLog>[],
  ) => recordDose({ dose, status, newLogId: 'new-id', logs, context, details });

  it('records a LARGER amount next to the plan, which stays as it was', () => {
    const result = record({ takenAmount: 4, note: 'Zgodnie z zaleceniem lekarza' });

    assertOk(result);
    expect(result.change).toBe('created');
    expect(result.log).toEqual({
      id: 'new-id',
      medicationId: 'med-1',
      scheduledDate: '2026-10-15',
      scheduledTime: '08:00',
      status: 'taken',
      doseAmount: 2, // the plan is not overwritten
      doseUnit: 'tabletka',
      recordedAt: '2026-10-15T10:00:00.000Z',
      takenAmount: 4,
      note: 'Zgodnie z zaleceniem lekarza',
    });
  });

  it('records a SMALLER amount the same way', () => {
    const result = record({ takenAmount: 0.5, note: null });

    assertOk(result);
    expect(result.log).toMatchObject({ doseAmount: 2, takenAmount: 0.5 });
    expect(result.log && 'note' in result.log).toBe(false);
  });

  it('stores the planned amount as "as planned": no takenAmount field', () => {
    const result = record({ takenAmount: 2, note: null });

    assertOk(result);
    expect(result.log && 'takenAmount' in result.log).toBe(false);
    expect(result.log && 'note' in result.log).toBe(false);
  });

  it('stores a note with the planned amount', () => {
    const result = record({ takenAmount: 2, note: 'Po jedzeniu' });

    assertOk(result);
    expect(result.log).toMatchObject({ doseAmount: 2, note: 'Po jedzeniu' });
    expect(result.log && 'takenAmount' in result.log).toBe(false);
  });

  it('a record without details is exactly as before: no new field at all', () => {
    const result = recordDose({ dose, status: 'taken', newLogId: 'new-id', logs: [], context });

    assertOk(result);
    expect(Object.keys(result.log ?? {}).sort()).toEqual(
      [
        'doseAmount',
        'doseUnit',
        'id',
        'medicationId',
        'recordedAt',
        'scheduledDate',
        'scheduledTime',
        'status',
      ].sort(),
    );
  });

  it.each([0, -1, Number.NaN, 1.2345, 10_000_000])(
    'refuses the amount %s and creates nothing',
    (takenAmount) => {
      expect(record({ takenAmount, note: null })).toEqual({ ok: false, error: 'invalid-amount' });
    },
  );

  it('refuses a note over 500 characters', () => {
    expect(record({ takenAmount: 2, note: 'x'.repeat(501) })).toEqual({
      ok: false,
      error: 'note-too-long',
    });
  });

  it('refuses details for a skipped dose: a skipped dose has neither', () => {
    expect(record({ takenAmount: 2, note: 'x' }, 'skipped')).toEqual({
      ok: false,
      error: 'details-need-taken',
    });
  });

  it('writes nothing, and merges into nothing, when the slot already has a record', () => {
    expect(record({ takenAmount: 3, note: null }, 'taken', [existingSlotLog('taken')])).toEqual({
      ok: false,
      error: 'already-recorded',
    });
    expect(record({ takenAmount: 3, note: null }, 'taken', [existingSlotLog('skipped')])).toEqual({
      ok: false,
      error: 'already-recorded',
    });
  });

  it('still refuses a future day', () => {
    const future: ScheduledDose = { ...dose, date: asLocalDate('2026-10-16') };

    expect(
      recordDose({
        dose: future,
        status: 'taken',
        newLogId: 'x',
        logs: [],
        context,
        details: { takenAmount: 2, note: null },
      }),
    ).toEqual({ ok: false, error: 'future-date' });
  });
});

function existingSlotLog(status: 'taken' | 'skipped') {
  return makeDoseLog({
    id: 'log-here',
    medicationId: 'med-1',
    scheduledDate: asLocalDate('2026-10-15'),
    scheduledTime: asLocalTime('08:00'),
    status,
    doseAmount: 2,
    doseUnit: 'tabletka',
    recordedAt: asTimestamp('2026-10-15T06:05:00Z'),
  });
}

describe('changeDoseStatus with the amount taken and the note', () => {
  const takenDifferently = {
    ...existingSlotLog('taken'),
    takenAmount: 4,
    note: 'Zalecenie lekarza',
  };

  it('taken to skipped removes the amount taken and the note, and keeps the plan', () => {
    const result = changeDoseStatus({ slot, status: 'skipped', logs: [takenDifferently], context });

    assertOk(result);
    expect(result.change).toBe('updated');
    expect(result.log).toEqual({
      ...existingSlotLog('taken'),
      status: 'skipped',
      recordedAt: '2026-10-15T10:00:00.000Z',
    });
    expect(result.log && 'takenAmount' in result.log).toBe(false);
    expect(result.log && 'note' in result.log).toBe(false);
  });

  it('and back to taken starts from the plan again: no amount, no note', () => {
    const skipped = changeDoseStatus({
      slot,
      status: 'skipped',
      logs: [takenDifferently],
      context,
    });
    assertOk(skipped);

    const back = changeDoseStatus({ slot, status: 'taken', logs: skipped.logs, context });

    assertOk(back);
    expect(back.log && 'takenAmount' in back.log).toBe(false);
    expect(back.log && 'note' in back.log).toBe(false);
    expect(back.log).toMatchObject({ status: 'taken', doseAmount: 2 });
  });

  it('the same status again is unchanged and keeps the details', () => {
    const result = changeDoseStatus({ slot, status: 'taken', logs: [takenDifferently], context });

    assertOk(result);
    expect(result.change).toBe('unchanged');
    expect(result.log).toEqual(takenDifferently);
  });

  it('clearing the record removes it with its details (nothing is counted any more)', () => {
    const result = undoDose({ slot, logs: [takenDifferently] });

    assertOk(result);
    expect(result.logs).toEqual([]);
  });
});

describe('adjustTakenAmount', () => {
  const taken = existingSlotLog('taken');
  const adjust = (
    details: Parameters<typeof adjustTakenAmount>[0]['details'],
    options: {
      seen?: ReturnType<typeof makeDoseLog>;
      logs?: ReturnType<typeof makeDoseLog>[];
    } = {},
  ) =>
    adjustTakenAmount({
      slot,
      seen: options.seen ?? taken,
      details,
      logs: options.logs ?? [taken],
    });

  it('sets a larger amount and a note, without moving recordedAt or touching the plan', () => {
    const result = adjust({ takenAmount: 4, note: 'Zalecenie lekarza' });

    assertOk(result);
    expect(result.change).toBe('updated');
    expect(result.log).toEqual({ ...taken, takenAmount: 4, note: 'Zalecenie lekarza' });
    expect(result.log?.recordedAt).toBe(taken.recordedAt);
    expect(result.log?.doseAmount).toBe(2);
    expect(result.logs).toEqual([result.log]);
  });

  it('sets a smaller amount', () => {
    const result = adjust({ takenAmount: 1, note: null });

    assertOk(result);
    expect(result.log).toMatchObject({ takenAmount: 1, doseAmount: 2 });
  });

  it('the same amount and note again is unchanged and writes nothing', () => {
    const edited = { ...taken, takenAmount: 3, note: 'x' };

    const result = adjust({ takenAmount: 3, note: 'x' }, { seen: edited, logs: [edited] });

    assertOk(result);
    expect(result.change).toBe('unchanged');
    expect(result.log).toEqual(edited);
  });

  it('the planned amount with no note is unchanged for a record that has no details (as planned)', () => {
    const result = adjust({ takenAmount: 2, note: null });

    assertOk(result);
    expect(result.change).toBe('unchanged');
  });

  it('going back to the planned amount removes the amount taken (the plan counts again)', () => {
    const edited = { ...taken, takenAmount: 4, note: 'x' };

    const result = adjust({ takenAmount: 2, note: 'x' }, { seen: edited, logs: [edited] });

    assertOk(result);
    expect(result.change).toBe('updated');
    expect(result.log && 'takenAmount' in result.log).toBe(false);
    expect(result.log?.note).toBe('x');
  });

  it('removes the note when it is emptied', () => {
    const edited = { ...taken, takenAmount: 4, note: 'x' };

    const result = adjust({ takenAmount: 4, note: null }, { seen: edited, logs: [edited] });

    assertOk(result);
    expect(result.log && 'note' in result.log).toBe(false);
    expect(result.log?.takenAmount).toBe(4);
  });

  it('refuses when the stored record is not the one the person saw (changed meanwhile), and changes nothing', () => {
    const meanwhile = { ...taken, takenAmount: 3 };

    expect(adjust({ takenAmount: 4, note: null }, { seen: taken, logs: [meanwhile] })).toEqual({
      ok: false,
      error: 'record-changed',
    });
    // Replaced by another record of the slot (another id) is a change too.
    expect(
      adjust({ takenAmount: 4, note: null }, { seen: taken, logs: [{ ...taken, id: 'other' }] }),
    ).toEqual({ ok: false, error: 'record-changed' });
    // And so is a note written meanwhile, or a new moment.
    expect(
      adjust({ takenAmount: 4, note: null }, { seen: taken, logs: [{ ...taken, note: 'inna' }] }),
    ).toEqual({ ok: false, error: 'record-changed' });
    expect(
      adjust(
        { takenAmount: 4, note: null },
        { seen: taken, logs: [{ ...taken, recordedAt: asTimestamp('2026-10-15T11:00:00Z') }] },
      ),
    ).toEqual({ ok: false, error: 'record-changed' });
  });

  it('refuses when the record is gone, or became skipped, or the data holds several', () => {
    expect(adjust({ takenAmount: 4, note: null }, { logs: [] })).toEqual({
      ok: false,
      error: 'record-not-found',
    });
    expect(
      adjust({ takenAmount: 4, note: null }, { logs: [{ ...taken, status: 'skipped' }] }),
    ).toEqual({ ok: false, error: 'details-need-taken' });
    expect(
      adjust({ takenAmount: 4, note: null }, { logs: [taken, { ...taken, id: 'dup' }] }),
    ).toEqual({ ok: false, error: 'conflicting-records' });
  });

  it.each([0, -1, Number.NaN, 1.2345])('refuses the amount %s', (takenAmount) => {
    expect(adjust({ takenAmount, note: null })).toEqual({ ok: false, error: 'invalid-amount' });
  });

  it('refuses a note over 500 characters', () => {
    expect(adjust({ takenAmount: 3, note: 'x'.repeat(501) })).toEqual({
      ok: false,
      error: 'note-too-long',
    });
  });

  it('touches only this record: the others are returned as they were', () => {
    const other = makeDoseLog({ id: 'other', scheduledTime: asLocalTime('20:00') });

    const result = adjust({ takenAmount: 4, note: null }, { logs: [taken, other] });

    assertOk(result);
    expect(result.logs).toEqual([{ ...taken, takenAmount: 4 }, other]);
  });

  it('does not change its inputs', () => {
    const logs = [taken];
    const before = JSON.stringify(logs);

    adjust({ takenAmount: 4, note: 'x' }, { logs });

    expect(JSON.stringify(logs)).toBe(before);
  });
});
