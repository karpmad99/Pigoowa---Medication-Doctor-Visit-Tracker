import { describe, expect, it } from 'vitest';
import { asLocalDate, asTimestamp } from '@/utils/date';
import { assertOk, makeDoseLog, makeMedication, scheduleTime } from '@/test/fixtures';
import type { DoseLog } from '@/features/doses/types';
import type { Medication, MedicationStock } from '../types';
import {
  buildMedicationStock,
  estimateStock,
  isLowStock,
  LOW_STOCK_THRESHOLD_DAYS,
  type StockEstimate,
} from './stock';

const TODAY = asLocalDate('2026-10-15');
const STOCK_AS_OF = asTimestamp('2026-10-01T08:00:00Z');

function stock(overrides: Partial<MedicationStock> = {}): MedicationStock {
  return { quantity: 30, unit: 'tabletka', asOf: STOCK_AS_OF, ...overrides };
}

function takenLog(id: string, overrides: Partial<DoseLog> = {}): DoseLog {
  return makeDoseLog({
    id,
    status: 'taken',
    recordedAt: asTimestamp('2026-10-05T08:00:00Z'),
    ...overrides,
  });
}

function estimate(medication: Medication, doseLogs: DoseLog[] = []): StockEstimate {
  return estimateStock({ medication, doseLogs, today: TODAY });
}

describe('estimateStock', () => {
  it('estimates remaining stock and days from stock, taken doses and the schedule', () => {
    // 30 tablets, 2 per day (1 morning + 1 evening), 4 taken so far.
    const medication = makeMedication({
      stock: stock({ quantity: 30 }),
      scheduleTimes: [scheduleTime('t-1', '08:00', 1), scheduleTime('t-2', '20:00', 1)],
    });
    const logs = [takenLog('l-1'), takenLog('l-2'), takenLog('l-3'), takenLog('l-4')];

    expect(estimate(medication, logs)).toEqual({
      available: true,
      remaining: 26,
      unit: 'tabletka',
      daysRemaining: 13,
    });
  });

  it('rounds days remaining down (a part-day of stock is not a day)', () => {
    const medication = makeMedication({
      stock: stock({ quantity: 5 }),
      scheduleTimes: [scheduleTime('t-1', '08:00', 2)],
    });

    expect(estimate(medication)).toMatchObject({ remaining: 5, daysRemaining: 2 });
  });

  it('reduces stock only for taken doses, not for skipped ones', () => {
    const medication = makeMedication({ stock: stock({ quantity: 10 }) });
    const logs = [
      takenLog('l-1'),
      takenLog('l-2', { status: 'skipped' }),
      takenLog('l-3', { status: 'skipped' }),
    ];

    expect(estimate(medication, logs)).toMatchObject({ remaining: 9 });
  });

  it('does not reduce stock for planned doses that were never recorded', () => {
    const medication = makeMedication({ stock: stock({ quantity: 10 }) });

    expect(estimate(medication, [])).toMatchObject({ remaining: 10 });
  });

  it('counts the amount recorded at the time, not the current schedule amount', () => {
    const medication = makeMedication({
      stock: stock({ quantity: 10 }),
      scheduleTimes: [scheduleTime('t-1', '08:00', 5)],
    });

    expect(estimate(medication, [takenLog('l-1', { doseAmount: 2 })])).toMatchObject({
      remaining: 8,
    });
  });

  it('ignores doses recorded before the stock was entered, counting from that moment on', () => {
    const medication = makeMedication({ stock: stock({ quantity: 10 }) });
    const before = takenLog('l-before', { recordedAt: asTimestamp('2026-10-01T07:59:59Z') });
    const exactly = takenLog('l-at', { recordedAt: STOCK_AS_OF });

    expect(estimate(medication, [before, exactly])).toMatchObject({ remaining: 9 });
  });

  it('ignores records of other medications', () => {
    const medication = makeMedication({ stock: stock({ quantity: 10 }) });

    expect(estimate(medication, [takenLog('l-1', { medicationId: 'med-2' })])).toMatchObject({
      remaining: 10,
    });
  });

  it('computes with decimals exactly (no floating-point drift)', () => {
    // 0.3 left, 0.1 used per day: exactly 3 days, although 0.3 / 0.1 is 2.9999999999999996 in floating point.
    const medication = makeMedication({
      doseUnit: 'ml',
      stock: stock({ quantity: 0.3, unit: 'ml' }),
      scheduleTimes: [scheduleTime('t-1', '08:00', 0.1)],
    });
    const logs = [
      takenLog('l-1', { doseAmount: 0.1, doseUnit: 'ml' }),
      takenLog('l-2', { doseAmount: 0.2, doseUnit: 'ml' }),
    ];

    expect(estimate(medication)).toMatchObject({ remaining: 0.3, daysRemaining: 3 });
    expect(estimate(medication, logs)).toMatchObject({ remaining: 0, daysRemaining: 0 });
  });

  it('collapses duplicate schedule times the same way dose generation does', () => {
    const medication = makeMedication({
      stock: stock({ quantity: 10 }),
      scheduleTimes: [scheduleTime('t-a', '08:00', 1), scheduleTime('t-b', '08:00', 1)],
    });

    expect(estimate(medication)).toMatchObject({ daysRemaining: 10 });
  });

  describe('zero versus unavailable', () => {
    it('reports an exact zero stock as an available estimate of 0', () => {
      const medication = makeMedication({ stock: stock({ quantity: 0 }) });

      expect(estimate(medication)).toEqual({
        available: true,
        remaining: 0,
        unit: 'tabletka',
        daysRemaining: 0,
      });
    });

    it('never goes below zero when more was taken than the stock held', () => {
      const medication = makeMedication({ stock: stock({ quantity: 1 }) });
      const logs = [takenLog('l-1'), takenLog('l-2'), takenLog('l-3')];

      expect(estimate(medication, logs)).toMatchObject({
        available: true,
        remaining: 0,
        daysRemaining: 0,
      });
    });

    it('reports missing stock information as unavailable, not as zero', () => {
      expect(estimate(makeMedication({ stock: null }))).toEqual({
        available: false,
        reason: 'no-stock',
      });
    });
  });

  describe('unavailable results', () => {
    it('has no estimate without usable schedule times', () => {
      const none = makeMedication({ stock: stock(), scheduleTimes: [] });
      const unusable = makeMedication({
        stock: stock(),
        scheduleTimes: [scheduleTime('t', '08:00', 0)],
      });

      expect(estimate(none)).toEqual({ available: false, reason: 'no-schedule' });
      expect(estimate(unusable)).toEqual({ available: false, reason: 'no-schedule' });
    });

    it('has no estimate once the medication has ended, but still has one on its last day', () => {
      const endedYesterday = makeMedication({ stock: stock(), endDate: asLocalDate('2026-10-14') });
      const endsToday = makeMedication({ stock: stock(), endDate: asLocalDate('2026-10-15') });

      expect(estimate(endedYesterday)).toEqual({ available: false, reason: 'ended' });
      expect(estimate(endsToday).available).toBe(true);
    });

    it('does not combine a stock unit with a different dose unit', () => {
      const medication = makeMedication({ doseUnit: 'mg', stock: stock({ unit: 'tabletka' }) });

      expect(estimate(medication)).toEqual({ available: false, reason: 'incompatible-units' });
    });

    it('treats the same unit written differently as compatible', () => {
      const medication = makeMedication({
        doseUnit: 'Tabletka',
        stock: stock({ unit: ' tabletka ' }),
      });

      expect(estimate(medication).available).toBe(true);
    });

    it('does not subtract a taken dose that was recorded in a different unit', () => {
      const medication = makeMedication({ stock: stock({ quantity: 10 }) });
      const logs = [takenLog('l-1', { doseUnit: 'ml' })];

      expect(estimate(medication, logs)).toEqual({
        available: false,
        reason: 'incompatible-units',
      });
    });

    it('does not let a record in another unit matter if it would not be counted anyway', () => {
      const medication = makeMedication({ stock: stock({ quantity: 10 }) });
      const logs = [
        takenLog('l-old', { doseUnit: 'ml', recordedAt: asTimestamp('2026-09-01T08:00:00Z') }),
        takenLog('l-skipped', { doseUnit: 'ml', status: 'skipped' }),
      ];

      expect(estimate(medication, logs)).toMatchObject({ available: true, remaining: 10 });
    });

    it.each([
      ['negative', -1],
      ['not a number', Number.NaN],
      ['infinite', Number.POSITIVE_INFINITY],
    ])('refuses stored stock that is %s instead of calculating with it', (_label, quantity) => {
      const medication = makeMedication({ stock: stock({ quantity }) });

      expect(estimate(medication)).toEqual({ available: false, reason: 'invalid-data' });
    });

    it('refuses to calculate when a counted record has an unusable amount', () => {
      const medication = makeMedication({ stock: stock({ quantity: 10 }) });

      expect(estimate(medication, [takenLog('l-1', { doseAmount: -2 })])).toEqual({
        available: false,
        reason: 'invalid-data',
      });
    });
  });
});

describe('isLowStock', () => {
  it('is true only below the threshold', () => {
    const lasting = (days: number): StockEstimate => ({
      available: true,
      remaining: days,
      unit: 'tabletka',
      daysRemaining: days,
    });

    expect(isLowStock(lasting(LOW_STOCK_THRESHOLD_DAYS - 1))).toBe(true);
    expect(isLowStock(lasting(0))).toBe(true);
    expect(isLowStock(lasting(LOW_STOCK_THRESHOLD_DAYS))).toBe(false);
  });

  it('is never true for an unavailable estimate', () => {
    expect(isLowStock({ available: false, reason: 'no-stock' })).toBe(false);
  });
});

describe('buildMedicationStock', () => {
  const asOf = asTimestamp('2026-10-15T10:00:00Z');

  it('builds stock stamped with the given moment and a trimmed unit', () => {
    const result = buildMedicationStock({ quantity: 28, unit: '  tabletka ' }, asOf);

    assertOk(result);
    expect(result.stock).toEqual({ quantity: 28, unit: 'tabletka', asOf });
  });

  it('accepts zero ("none left") and decimals up to three places', () => {
    expect(buildMedicationStock({ quantity: 0, unit: 'ml' }, asOf).ok).toBe(true);
    expect(buildMedicationStock({ quantity: 12.125, unit: 'ml' }, asOf).ok).toBe(true);
  });

  it.each([
    ['negative', -0.5],
    ['not a number', Number.NaN],
    ['infinite', Number.POSITIVE_INFINITY],
    ['too many decimals', 1.2345],
    ['too large', 10_000_000],
  ])('rejects a quantity that is %s', (_label, quantity) => {
    expect(buildMedicationStock({ quantity, unit: 'ml' }, asOf)).toEqual({
      ok: false,
      issues: ['invalid-quantity'],
    });
  });

  it('rejects a blank or over-long unit', () => {
    expect(buildMedicationStock({ quantity: 1, unit: '   ' }, asOf)).toEqual({
      ok: false,
      issues: ['invalid-unit'],
    });
    expect(buildMedicationStock({ quantity: 1, unit: 'x'.repeat(31) }, asOf)).toEqual({
      ok: false,
      issues: ['invalid-unit'],
    });
  });

  it('reports every problem together', () => {
    expect(buildMedicationStock({ quantity: -1, unit: '' }, asOf)).toEqual({
      ok: false,
      issues: ['invalid-quantity', 'invalid-unit'],
    });
  });
});
