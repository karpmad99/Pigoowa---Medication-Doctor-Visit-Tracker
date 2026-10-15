import { describe, expect, it } from 'vitest';
import { asLocalDate, asTimestamp } from '@/utils/date';
import { makeMedication, scheduleTime } from '@/test/fixtures';
import {
  applyScheduleChange,
  isMedicationActiveOn,
  normalizeScheduleTimes,
  validateScheduleTimes,
} from './schedule';

describe('normalizeScheduleTimes', () => {
  it('sorts by time of day', () => {
    const result = normalizeScheduleTimes([
      scheduleTime('b', '20:00'),
      scheduleTime('a', '08:00'),
      scheduleTime('c', '13:30'),
    ]);
    expect(result.map((entry) => entry.timeOfDay)).toEqual(['08:00', '13:30', '20:00']);
  });

  it('keeps one entry per time of day: the one with the smallest id, whatever the input order', () => {
    const first = scheduleTime('a', '08:00', 1);
    const second = scheduleTime('b', '08:00', 2);
    expect(normalizeScheduleTimes([second, first])).toEqual([first]);
    expect(normalizeScheduleTimes([first, second])).toEqual([first]);
  });

  it('does not add duplicate amounts together', () => {
    const result = normalizeScheduleTimes([
      scheduleTime('a', '08:00', 1),
      scheduleTime('b', '08:00', 1),
    ]);
    expect(result).toHaveLength(1);
    expect(result[0]?.doseAmount).toBe(1);
  });

  it('drops entries with unusable amounts, so a valid duplicate can take their place', () => {
    const result = normalizeScheduleTimes([
      scheduleTime('a', '08:00', 0),
      scheduleTime('b', '08:00', 2),
      scheduleTime('c', '12:00', -1),
      scheduleTime('d', '16:00', Number.NaN),
    ]);
    expect(result).toEqual([scheduleTime('b', '08:00', 2)]);
  });

  it('does not modify its input', () => {
    const input = [scheduleTime('b', '20:00'), scheduleTime('a', '08:00')];
    normalizeScheduleTimes(input);
    expect(input.map((entry) => entry.id)).toEqual(['b', 'a']);
  });
});

describe('isMedicationActiveOn', () => {
  const medication = makeMedication({
    startDate: asLocalDate('2026-10-10'),
    endDate: asLocalDate('2026-10-20'),
    scheduleEffectiveFrom: asLocalDate('2026-10-12'),
  });

  it('is active from the later of start date and effective date until the end date, inclusive', () => {
    expect(isMedicationActiveOn(medication, asLocalDate('2026-10-12'))).toBe(true);
    expect(isMedicationActiveOn(medication, asLocalDate('2026-10-16'))).toBe(true);
    expect(isMedicationActiveOn(medication, asLocalDate('2026-10-20'))).toBe(true);
  });

  it('is inactive before the start date, before the effective date, and after the end date', () => {
    expect(isMedicationActiveOn(medication, asLocalDate('2026-10-09'))).toBe(false);
    expect(isMedicationActiveOn(medication, asLocalDate('2026-10-11'))).toBe(false);
    expect(isMedicationActiveOn(medication, asLocalDate('2026-10-21'))).toBe(false);
  });

  it('has no upper limit without an end date', () => {
    const open = makeMedication({ endDate: null });
    expect(isMedicationActiveOn(open, asLocalDate('2999-12-31'))).toBe(true);
  });
});

describe('validateScheduleTimes', () => {
  it('accepts valid entries and returns branded times', () => {
    const result = validateScheduleTimes([
      { timeOfDay: '08:00', doseAmount: 1 },
      { timeOfDay: '20:00', doseAmount: 0.5 },
    ]);
    expect(result).toEqual({
      ok: true,
      times: [
        { timeOfDay: '08:00', doseAmount: 1 },
        { timeOfDay: '20:00', doseAmount: 0.5 },
      ],
    });
  });

  it('requires at least one time', () => {
    expect(validateScheduleTimes([])).toEqual({
      ok: false,
      issues: [{ code: 'empty', index: null }],
    });
  });

  it('reports invalid times with their position', () => {
    const result = validateScheduleTimes([
      { timeOfDay: '08:00', doseAmount: 1 },
      { timeOfDay: '24:00', doseAmount: 1 },
      { timeOfDay: '8:30', doseAmount: 1 },
    ]);
    expect(result).toEqual({
      ok: false,
      issues: [
        { code: 'invalid-time', index: 1 },
        { code: 'invalid-time', index: 2 },
      ],
    });
  });

  it.each([
    ['zero', 0],
    ['negative', -1],
    ['not a number', Number.NaN],
    ['infinite', Number.POSITIVE_INFINITY],
    ['more than 3 decimals', 0.0001],
  ])('rejects a dose amount that is %s', (_label, doseAmount) => {
    expect(validateScheduleTimes([{ timeOfDay: '08:00', doseAmount }])).toEqual({
      ok: false,
      issues: [{ code: 'invalid-amount', index: 0 }],
    });
  });

  it('accepts amounts with up to 3 decimals', () => {
    expect(validateScheduleTimes([{ timeOfDay: '08:00', doseAmount: 0.125 }]).ok).toBe(true);
  });

  it('rejects the same time twice, pointing at the repeat', () => {
    expect(
      validateScheduleTimes([
        { timeOfDay: '08:00', doseAmount: 1 },
        { timeOfDay: '08:00', doseAmount: 2 },
      ]),
    ).toEqual({ ok: false, issues: [{ code: 'duplicate-time', index: 1 }] });
  });

  it('reports several problems at once', () => {
    const result = validateScheduleTimes([
      { timeOfDay: '99:99', doseAmount: 0 },
      { timeOfDay: '08:00', doseAmount: 1 },
      { timeOfDay: '08:00', doseAmount: 1 },
    ]);
    expect(result).toEqual({
      ok: false,
      issues: [
        { code: 'invalid-time', index: 0 },
        { code: 'invalid-amount', index: 0 },
        { code: 'duplicate-time', index: 2 },
      ],
    });
  });
});

describe('applyScheduleChange', () => {
  const today = asLocalDate('2026-10-15');
  const now = asTimestamp('2026-10-15T10:00:00Z');
  const medication = makeMedication({
    startDate: asLocalDate('2026-01-01'),
    scheduleEffectiveFrom: asLocalDate('2026-01-01'),
    scheduleTimes: [scheduleTime('t-1', '08:00', 1)],
  });

  it('moves the effective date to today when a time is added', () => {
    const changed = applyScheduleChange(
      medication,
      [scheduleTime('t-1', '08:00', 1), scheduleTime('t-2', '20:00', 1)],
      today,
      now,
    );
    expect(changed.scheduleEffectiveFrom).toBe('2026-10-15');
    expect(changed.scheduleTimes).toHaveLength(2);
    expect(changed.updatedAt).toBe(now);
  });

  it('counts a changed amount as a schedule change', () => {
    const changed = applyScheduleChange(medication, [scheduleTime('t-1', '08:00', 2)], today, now);
    expect(changed.scheduleEffectiveFrom).toBe('2026-10-15');
  });

  it('counts a changed time as a schedule change', () => {
    const changed = applyScheduleChange(medication, [scheduleTime('t-1', '09:00', 1)], today, now);
    expect(changed.scheduleEffectiveFrom).toBe('2026-10-15');
  });

  it('returns the very same medication when the effective schedule is unchanged', () => {
    const resaved = applyScheduleChange(
      medication,
      [scheduleTime('other-id', '08:00', 1)],
      today,
      now,
    );
    expect(resaved).toBe(medication);
  });

  it('keeps the start date as effective date when the medication has not started yet', () => {
    const future = makeMedication({
      startDate: asLocalDate('2026-11-01'),
      scheduleEffectiveFrom: asLocalDate('2026-11-01'),
    });
    const changed = applyScheduleChange(future, [scheduleTime('t-1', '10:00', 1)], today, now);
    expect(changed.scheduleEffectiveFrom).toBe('2026-11-01');
  });

  it('does not modify the original medication', () => {
    applyScheduleChange(medication, [scheduleTime('t-9', '21:00', 3)], today, now);
    expect(medication.scheduleEffectiveFrom).toBe('2026-01-01');
    expect(medication.scheduleTimes).toHaveLength(1);
  });
});
