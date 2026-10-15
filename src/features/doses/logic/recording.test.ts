import { describe, expect, it } from 'vitest';
import { asLocalDate, asLocalTime, asTimestamp } from '@/utils/date';
import { assertOk, makeDoseLog } from '@/test/fixtures';
import type { DoseSlot, ScheduledDose } from '../types';
import { changeDoseStatus, recordDose, undoDose, type RecordingContext } from './recording';

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
