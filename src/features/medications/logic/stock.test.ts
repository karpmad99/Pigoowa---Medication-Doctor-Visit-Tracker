import { describe, expect, it } from 'vitest';
import { asLocalDate, asLocalTime, asTimestamp } from '@/utils/date';
import {
  assertOk,
  makeDoseLog,
  makeMedication,
  makeStockEvent,
  scheduleTime,
} from '@/test/fixtures';
import type { DoseLog } from '@/features/doses/types';
import type { Medication, MedicationStock } from '../types';
import {
  buildMedicationStock,
  estimateStock,
  isLowStock,
  LOW_STOCK_THRESHOLD_DAYS,
  lowStockRule,
  thresholdApplies,
  thresholdUnitDiffers,
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

describe('estimateStock: the strength and the dosage form are information only', () => {
  const logs = [takenLog('a'), takenLog('b', { recordedAt: asTimestamp('2026-10-06T08:00:00Z') })];
  const base = makeMedication({ stock: stock({ quantity: 28 }) });

  it('gives the same estimate whatever the strength is, or whether there is one', () => {
    const reference = estimate(base, logs);

    for (const strength of [
      null,
      { value: 1, unit: 'mg' },
      { value: 500, unit: 'mg' },
      { value: 9_999_999.999, unit: 'g' },
      { value: 2.5, unit: 'mg/ml' },
      { value: 50, unit: '%' },
    ]) {
      expect(estimate({ ...base, strength }, logs)).toEqual(reference);
    }
    expect(reference).toMatchObject({ available: true, remaining: 26 });
  });

  it('gives the same estimate whatever the dosage form is', () => {
    const reference = estimate(base, logs);

    for (const dosageForm of ['tablet', 'liquid', 'drops', 'other'] as const) {
      expect(estimate({ ...base, dosageForm }, logs)).toEqual(reference);
    }
  });

  it('does not make a strength unit count as the dose or stock unit', () => {
    // A strength of "500 mg" with a stock counted in "mg" is still a different unit than "tabletka".
    const medication = makeMedication({
      strength: { value: 500, unit: 'mg' },
      stock: stock({ unit: 'mg', quantity: 5000 }),
    });

    expect(estimate(medication)).toEqual({ available: false, reason: 'incompatible-units' });
  });

  it('is computed without reading the strength at all (the field can be unreadable)', () => {
    const trap = {
      get value(): number {
        throw new Error('the estimate read the strength');
      },
      unit: 'mg',
    };

    expect(() => estimate({ ...base, strength: trap }, logs)).not.toThrow();
  });
});

describe('the own low-stock threshold', () => {
  const available = (remaining: number, daysRemaining = 30, unit = 'tabletka'): StockEstimate => ({
    available: true,
    remaining,
    unit,
    daysRemaining,
  });
  const threshold = (quantity: number, unit = 'tabletka') => ({ quantity, unit });

  describe('isLowStock with a threshold that applies: remaining <= threshold', () => {
    it.each([
      ['above the threshold', 11, false],
      ['one thousandth above', 10.001, false],
      ['exactly at the threshold', 10, true],
      ['one thousandth below', 9.999, true],
      ['far below', 2, true],
      ['used up', 0, true],
    ])('is %s: low = %s', (_label, remaining, low) => {
      expect(isLowStock(available(remaining), threshold(10))).toBe(low);
    });

    it('ignores the number of days when the threshold applies (plenty of days, but at the threshold)', () => {
      expect(isLowStock(available(10, 365), threshold(10))).toBe(true);
    });

    it('does not warn for a few days when the threshold applies and is not reached', () => {
      // Only 2 days left, but the person set a threshold of 5 and 8 are left: their rule decides.
      expect(isLowStock(available(8, 2), threshold(5))).toBe(false);
    });

    it('with a threshold of zero warns only when the stock is used up', () => {
      expect(isLowStock(available(0, 0), threshold(0))).toBe(true);
      expect(isLowStock(available(0.001, 0), threshold(0))).toBe(false);
    });

    it('compares in whole thousandths, so 0.1 + 0.2 is not "above" 0.3', () => {
      expect(isLowStock(available(0.1 + 0.2), threshold(0.3))).toBe(true);
    });

    it('matches the unit however it is written (case, spaces)', () => {
      expect(isLowStock(available(5, 30, 'Tabletka '), threshold(5, ' tabletka'))).toBe(true);
    });
  });

  describe('without a threshold, or with one that does not apply: the 7-day rule', () => {
    it.each([null, undefined])('uses the 7-day rule for %s', (none) => {
      expect(isLowStock(available(10, LOW_STOCK_THRESHOLD_DAYS - 1), none)).toBe(true);
      expect(isLowStock(available(10, LOW_STOCK_THRESHOLD_DAYS), none)).toBe(false);
    });

    it('is the same as before when no second argument is given', () => {
      expect(isLowStock(available(10, 6))).toBe(true);
      expect(isLowStock(available(10, 7))).toBe(false);
    });

    it('does not apply a threshold in another unit, and falls back to the 7-day rule', () => {
      const inMl = threshold(100, 'ml');

      expect(thresholdApplies(inMl, available(5, 30))).toBe(false);
      // 5 tablets and a "threshold of 100 ml": nothing is converted, so the threshold says nothing;
      // 30 days is not low, 3 days is.
      expect(isLowStock(available(5, 30), inMl)).toBe(false);
      expect(isLowStock(available(5, 3), inMl)).toBe(true);
    });
  });

  it('never calls an unavailable estimate low, with or without a threshold', () => {
    for (const reason of [
      'no-stock',
      'invalid-data',
      'ended',
      'no-schedule',
      'incompatible-units',
    ] as const) {
      const estimate: StockEstimate = { available: false, reason };

      expect(isLowStock(estimate)).toBe(false);
      expect(isLowStock(estimate, threshold(1_000_000))).toBe(false);
      expect(lowStockRule(estimate, threshold(5))).toBeNull();
      expect(thresholdApplies(threshold(5), estimate)).toBe(false);
    }
  });

  describe('lowStockRule', () => {
    it('says which rule decides', () => {
      expect(lowStockRule(available(50), threshold(5))).toBe('threshold');
      expect(lowStockRule(available(50), null)).toBe('days');
      expect(lowStockRule(available(50), threshold(5, 'ml'))).toBe('days');
    });
  });

  describe('thresholdUnitDiffers', () => {
    const base = makeMedication({ stock: stock({ unit: 'tabletka' }) });

    it('is true only for a threshold in another unit than the stock', () => {
      expect(thresholdUnitDiffers({ ...base, lowStockThreshold: threshold(5, 'ml') })).toBe(true);
      expect(thresholdUnitDiffers({ ...base, lowStockThreshold: threshold(5) })).toBe(false);
      expect(thresholdUnitDiffers({ ...base, lowStockThreshold: threshold(5, ' TABLETKA') })).toBe(
        false,
      );
    });

    it('is false without a threshold, and without a stock', () => {
      expect(thresholdUnitDiffers(base)).toBe(false);
      expect(thresholdUnitDiffers({ ...base, lowStockThreshold: null })).toBe(false);
      expect(
        thresholdUnitDiffers({ ...base, stock: null, lowStockThreshold: threshold(5, 'ml') }),
      ).toBe(false);
    });
  });

  describe('with the real estimate', () => {
    const logs = [takenLog('a', { doseAmount: 1 }), takenLog('b', { doseAmount: 1 })];
    const medication = makeMedication({ stock: stock({ quantity: 12 }) }); // 12 - 2 = 10 left

    it('warns exactly when the estimate reaches the threshold', () => {
      const result = estimate(medication, logs);

      expect(result).toMatchObject({ available: true, remaining: 10 });
      expect(isLowStock(result, threshold(9))).toBe(false);
      expect(isLowStock(result, threshold(10))).toBe(true);
      expect(isLowStock(result, threshold(11))).toBe(true);
    });

    it('is not affected by the threshold: the estimate itself is the same', () => {
      const withThreshold = estimate({ ...medication, lowStockThreshold: threshold(50) }, logs);

      expect(withThreshold).toEqual(estimate(medication, logs));
    });

    it('does not warn for a medication whose estimate is unavailable because of units', () => {
      const mixed = makeMedication({
        doseUnit: 'tabletka',
        stock: stock({ unit: 'ml', quantity: 3 }),
        lowStockThreshold: threshold(10, 'ml'),
      });

      const result = estimate(mixed);

      expect(result).toEqual({ available: false, reason: 'incompatible-units' });
      expect(isLowStock(result, mixed.lowStockThreshold)).toBe(false);
    });
  });
});

describe('estimateStock with stock events (PROJECT_SPEC §7.6)', () => {
  const asOf = asTimestamp('2026-10-10T08:00:00Z');
  const medication = makeMedication({
    id: 'med-1',
    stock: { quantity: 20, unit: 'tabletka', asOf },
    scheduleTimes: [scheduleTime('a', '08:00', 1), scheduleTime('b', '20:00', 1)], // 2 a day
  });
  const refill = (overrides = {}) =>
    makeStockEvent({ recordedAt: asTimestamp('2026-10-11T09:00:00Z'), ...overrides });
  const withEvents = (events: ReturnType<typeof makeStockEvent>[], logs: DoseLog[] = []) =>
    estimateStock({ medication, doseLogs: logs, stockEvents: events, today: TODAY });

  it('is exactly the estimate without events when there are none, or the argument is omitted', () => {
    const plain = estimateStock({ medication, doseLogs: [], today: TODAY });

    expect(withEvents([])).toEqual(plain);
    expect(plain).toEqual({ available: true, remaining: 20, unit: 'tabletka', daysRemaining: 10 });
  });

  it('a refill adds its amount, once, and the days follow the planned daily use', () => {
    expect(withEvents([refill({ amount: 30 })])).toEqual({
      available: true,
      remaining: 50,
      unit: 'tabletka',
      daysRemaining: 25,
    });
  });

  it('two refills add both', () => {
    expect(
      withEvents([
        refill({ id: 'a', amount: 10 }),
        refill({ id: 'b', amount: 5, recordedAt: asTimestamp('2026-10-12T09:00:00Z') }),
      ]),
    ).toMatchObject({ remaining: 35 });
  });

  it('counts a refill recorded exactly at the moment of the count, and not one a second before', () => {
    expect(withEvents([refill({ recordedAt: asOf, amount: 5 })])).toMatchObject({ remaining: 25 });
    expect(
      withEvents([refill({ recordedAt: asTimestamp('2026-10-10T07:59:59Z'), amount: 5 })]),
    ).toMatchObject({ remaining: 20 });
  });

  it('does not count a reversed refill, and counts it again only if it is not reversed', () => {
    const reversed = refill({
      amount: 30,
      reversedAt: asTimestamp('2026-10-11T09:05:00Z'),
    });

    expect(withEvents([reversed])).toMatchObject({ remaining: 20 });
    expect(withEvents([{ ...reversed, reversedAt: null }])).toMatchObject({ remaining: 50 });
  });

  it('a refill and taken doses together: the refill adds, each taken dose subtracts once', () => {
    const taken = [
      makeDoseLog({
        id: 'l1',
        status: 'taken',
        doseAmount: 1,
        recordedAt: asTimestamp('2026-10-12T08:00:00Z'),
      }),
      makeDoseLog({
        id: 'l2',
        status: 'taken',
        doseAmount: 1,
        recordedAt: asTimestamp('2026-10-12T20:00:00Z'),
      }),
      makeDoseLog({
        id: 'l3',
        status: 'skipped',
        doseAmount: 1,
        recordedAt: asTimestamp('2026-10-13T08:00:00Z'),
      }),
    ];

    expect(withEvents([refill({ amount: 30 })], taken)).toMatchObject({ remaining: 48 });
  });

  it('waste subtracts, and a reversed waste does not', () => {
    const waste = refill({ kind: 'waste', amount: 4 });

    expect(withEvents([waste])).toMatchObject({ remaining: 16 });
    expect(
      withEvents([{ ...waste, reversedAt: asTimestamp('2026-10-11T10:00:00Z') }]),
    ).toMatchObject({ remaining: 20 });
  });

  it('counting the stock again (a later "as of") makes earlier events historical', () => {
    const recounted = {
      ...medication,
      stock: { quantity: 7, unit: 'tabletka', asOf: asTimestamp('2026-10-14T08:00:00Z') },
    };

    expect(
      estimateStock({
        medication: recounted,
        doseLogs: [],
        stockEvents: [refill({ amount: 30 })],
        today: TODAY,
      }),
    ).toMatchObject({ remaining: 7 });
  });

  it('ignores the events of other medications', () => {
    expect(withEvents([refill({ medicationId: 'med-2', amount: 99 })])).toMatchObject({
      remaining: 20,
    });
  });

  it('makes the estimate unavailable for an event in another unit, and never converts', () => {
    expect(withEvents([refill({ unit: 'ml', amount: 5 })])).toEqual({
      available: false,
      reason: 'incompatible-units',
    });
  });

  it('ignores the unit of an event that does not count (reversed or before the count)', () => {
    expect(
      withEvents([
        refill({ unit: 'ml', reversedAt: asTimestamp('2026-10-11T10:00:00Z') }),
        refill({ id: 'old', unit: 'ml', recordedAt: asTimestamp('2026-10-01T08:00:00Z') }),
      ]),
    ).toMatchObject({ available: true, remaining: 20 });
  });

  it('matches the unit however it is written', () => {
    expect(withEvents([refill({ unit: 'Tabletka ', amount: 5 })])).toMatchObject({ remaining: 25 });
  });

  it('reports an unusable amount as invalid data rather than guessing', () => {
    expect(withEvents([refill({ amount: -3 })])).toEqual({
      available: false,
      reason: 'invalid-data',
    });
  });

  it('computes in whole thousandths, so refills of 0.1 and 0.2 add to exactly 0.3', () => {
    const small = { ...medication, stock: { quantity: 0, unit: 'tabletka', asOf } };

    expect(
      estimateStock({
        medication: small,
        doseLogs: [],
        stockEvents: [refill({ id: 'a', amount: 0.1 }), refill({ id: 'b', amount: 0.2 })],
        today: TODAY,
      }),
    ).toMatchObject({ remaining: 0.3 });
  });

  it('holds the amount at zero and says the sum went below zero (the stock may have run out earlier)', () => {
    const logs = Array.from({ length: 5 }, (_value, index) =>
      makeDoseLog({
        id: `l${String(index)}`,
        status: 'taken',
        doseAmount: 5,
        recordedAt: asTimestamp('2026-10-12T08:00:00Z'),
        scheduledTime: asLocalTime(`0${String(index + 1)}:00`),
      }),
    );

    expect(withEvents([], logs)).toEqual({
      available: true,
      remaining: 0,
      unit: 'tabletka',
      daysRemaining: 0,
      wentBelowZero: true,
    });
    // A refill that brings it back above zero removes the flag: the estimate is not below zero any more.
    expect(withEvents([refill({ amount: 30 })], logs)).not.toHaveProperty('wentBelowZero');
  });

  it('does not set the flag for an exact zero', () => {
    expect(withEvents([refill({ kind: 'waste', amount: 20 })])).toEqual({
      available: true,
      remaining: 0,
      unit: 'tabletka',
      daysRemaining: 0,
    });
  });

  it('is not affected by how the stock was started: the basis changes wording only', () => {
    const fresh = {
      ...medication,
      stock: { quantity: 20, unit: 'tabletka', asOf, basis: 'new-package' as const },
    };

    expect(
      estimateStock({
        medication: fresh,
        doseLogs: [],
        stockEvents: [refill({ amount: 30 })],
        today: TODAY,
      }),
    ).toEqual(withEvents([refill({ amount: 30 })]));
  });

  it('refreshes the warning: a refill lifts the stock above the own threshold, a waste drops it to the threshold', () => {
    const threshold = { quantity: 10, unit: 'tabletka' };
    const low = {
      ...medication,
      stock: { quantity: 8, unit: 'tabletka', asOf },
      lowStockThreshold: threshold,
    };
    const estimateOf = (events: ReturnType<typeof makeStockEvent>[]) =>
      estimateStock({ medication: low, doseLogs: [], stockEvents: events, today: TODAY });

    expect(isLowStock(estimateOf([]), threshold)).toBe(true); // 8 <= 10
    expect(isLowStock(estimateOf([refill({ amount: 3 })]), threshold)).toBe(false); // 11 > 10
    expect(isLowStock(estimateOf([refill({ amount: 2 })]), threshold)).toBe(true); // 10 <= 10
    expect(
      isLowStock(
        estimateOf([refill({ amount: 3 }), refill({ id: 'w', kind: 'waste', amount: 1 })]),
        threshold,
      ),
    ).toBe(true); // 10
  });

  it('refreshes the 7-day rule too: a refill lifts a stock that would run out within a week', () => {
    const short = { ...medication, stock: { quantity: 6, unit: 'tabletka', asOf } }; // 3 days

    expect(isLowStock(estimateStock({ medication: short, doseLogs: [], today: TODAY }))).toBe(true);
    expect(
      isLowStock(
        estimateStock({
          medication: short,
          doseLogs: [],
          stockEvents: [refill({ amount: 30 })],
          today: TODAY,
        }),
      ),
    ).toBe(false);
  });

  it('does not change the lists it is given', () => {
    const events = [refill({ amount: 30 })];
    const before = JSON.stringify(events);

    withEvents(events);

    expect(JSON.stringify(events)).toBe(before);
  });
});

describe('estimateStock with waste (PROJECT_SPEC F-7)', () => {
  const asOf = asTimestamp('2026-10-10T08:00:00Z');
  const medication = makeMedication({
    id: 'med-1',
    stock: { quantity: 20, unit: 'tabletka', asOf },
    scheduleTimes: [scheduleTime('a', '08:00', 1), scheduleTime('b', '20:00', 1)],
    lowStockThreshold: { quantity: 12, unit: 'tabletka' },
  });
  const waste = (overrides = {}) =>
    makeStockEvent({
      kind: 'waste',
      amount: 3,
      recordedAt: asTimestamp('2026-10-11T09:00:00Z'),
      ...overrides,
    });
  const estimateWith = (events: ReturnType<typeof makeStockEvent>[], logs: DoseLog[] = []) =>
    estimateStock({ medication, doseLogs: logs, stockEvents: events, today: TODAY });

  it('drops the estimate by the amount, and the days follow the planned use', () => {
    expect(estimateWith([waste()])).toEqual({
      available: true,
      remaining: 17,
      unit: 'tabletka',
      daysRemaining: 8,
    });
  });

  it('is not a taken dose: it uses no dose record and does not depend on them', () => {
    const logs = [
      makeDoseLog({
        id: 'l1',
        status: 'taken',
        doseAmount: 1,
        recordedAt: asTimestamp('2026-10-12T08:00:00Z'),
      }),
    ];

    // 20 - 1 (taken) - 3 (waste); without the dose record 20 - 3.
    expect(estimateWith([waste()], logs)).toMatchObject({ remaining: 16 });
    expect(estimateWith([waste()], [])).toMatchObject({ remaining: 17 });
    expect(logs).toHaveLength(1);
  });

  it('a reversed waste stops counting and the estimate is restored', () => {
    const reversed = waste({ reversedAt: asTimestamp('2026-10-11T09:30:00Z') });

    expect(estimateWith([waste()])).toMatchObject({ remaining: 17 });
    expect(estimateWith([reversed])).toEqual(estimateWith([]));
  });

  it('does not count a waste event before the last count, and counts one at that moment', () => {
    expect(
      estimateWith([waste({ recordedAt: asTimestamp('2026-10-10T07:59:59Z') })]),
    ).toMatchObject({ remaining: 20 });
    expect(estimateWith([waste({ recordedAt: asOf })])).toMatchObject({ remaining: 17 });
  });

  it('adds up with refills and other waste', () => {
    expect(
      estimateWith([
        waste({ id: 'a', amount: 3 }),
        waste({ id: 'b', amount: 2 }),
        makeStockEvent({ id: 'r', amount: 10, recordedAt: asTimestamp('2026-10-12T08:00:00Z') }),
      ]),
    ).toMatchObject({ remaining: 25 });
  });

  it('an amount larger than the estimate holds it at zero and says the sum went below zero', () => {
    expect(estimateWith([waste({ amount: 25 })])).toEqual({
      available: true,
      remaining: 0,
      unit: 'tabletka',
      daysRemaining: 0,
      wentBelowZero: true,
    });
  });

  it('a waste in another unit makes the estimate unavailable, and nothing is converted', () => {
    expect(estimateWith([waste({ unit: 'ml' })])).toEqual({
      available: false,
      reason: 'incompatible-units',
    });
  });

  it('ignores the waste of another medication', () => {
    expect(estimateWith([waste({ medicationId: 'med-2', amount: 15 })])).toMatchObject({
      remaining: 20,
    });
  });

  it('refreshes the own threshold: the waste brings the stock to it (at the threshold is low), reversing lifts it', () => {
    const threshold = medication.lowStockThreshold;

    expect(isLowStock(estimateWith([]), threshold)).toBe(false); // 20 > 12
    expect(isLowStock(estimateWith([waste({ amount: 7 })]), threshold)).toBe(false); // 13 > 12
    expect(isLowStock(estimateWith([waste({ amount: 8 })]), threshold)).toBe(true); // 12 <= 12
    expect(
      isLowStock(
        estimateWith([waste({ amount: 8, reversedAt: asTimestamp('2026-10-11T10:00:00Z') })]),
        threshold,
      ),
    ).toBe(false);
  });

  it('is never low for a medication with no stock, whatever waste exists', () => {
    const none = { ...medication, stock: null };
    const result = estimateStock({
      medication: none,
      doseLogs: [],
      stockEvents: [waste()],
      today: TODAY,
    });

    expect(result).toEqual({ available: false, reason: 'no-stock' });
    expect(isLowStock(result, medication.lowStockThreshold)).toBe(false);
  });
});

describe('estimateStock: the amount actually taken (PROJECT_SPEC DEC-48, §7.6 taken rows)', () => {
  const asOf = asTimestamp('2026-10-10T08:00:00Z');
  const medication = makeMedication({
    id: 'med-1',
    stock: { quantity: 20, unit: 'tabletka', asOf },
    scheduleTimes: [scheduleTime('a', '08:00', 1), scheduleTime('b', '20:00', 1)],
  });
  const taken = (id: string, overrides: Partial<DoseLog> = {}) =>
    makeDoseLog({
      id,
      status: 'taken',
      doseAmount: 1,
      recordedAt: asTimestamp('2026-10-12T08:00:00Z'),
      ...overrides,
    });
  const remainingWith = (logs: DoseLog[]) => {
    const result = estimateStock({ medication, doseLogs: logs, today: TODAY });
    return result.available ? result.remaining : null;
  };

  it('taken as planned counts the planned amount, once', () => {
    expect(remainingWith([taken('a')])).toBe(19);
  });

  it('taken with a LARGER amount counts the amount taken, not the plan', () => {
    expect(remainingWith([taken('a', { takenAmount: 3 })])).toBe(17);
  });

  it('taken with a SMALLER amount counts the amount taken', () => {
    expect(remainingWith([taken('a', { takenAmount: 0.5 })])).toBe(19.5);
  });

  it('a record without the field (older data) counts its plan, as before', () => {
    const old = taken('a');

    expect('takenAmount' in old).toBe(false);
    expect(remainingWith([old])).toBe(19);
  });

  it('several doses add up, each by its own amount', () => {
    expect(
      remainingWith([
        taken('a'),
        taken('b', { takenAmount: 2, scheduledTime: asLocalTime('12:00') }),
        taken('c', { takenAmount: 0.5, scheduledTime: asLocalTime('16:00') }),
      ]),
    ).toBe(16.5);
  });

  it('changing the amount of a taken record applies the difference (the same record, the same moment)', () => {
    const before = taken('a');
    const after = { ...before, takenAmount: 4 };

    expect(after.recordedAt).toBe(before.recordedAt);
    expect(remainingWith([before])).toBe(19);
    expect(remainingWith([after])).toBe(16);
  });

  it('taken to skipped counts nothing; back to taken starts from the plan', () => {
    const skipped = taken('a', { status: 'skipped' });

    expect(remainingWith([skipped])).toBe(20);
    expect(remainingWith([taken('a')])).toBe(19);
  });

  it('clearing the record counts nothing', () => {
    expect(remainingWith([])).toBe(20);
  });

  it('does not count a record made before the stock was counted, with or without an amount taken', () => {
    const before = asTimestamp('2026-10-09T08:00:00Z');

    expect(remainingWith([taken('a', { recordedAt: before, takenAmount: 5 })])).toBe(20);
  });

  it('days still follow the PLANNED daily use, not what was taken', () => {
    const result = estimateStock({
      medication,
      doseLogs: [taken('a', { takenAmount: 10 })],
      today: TODAY,
    });

    // 20 - 10 = 10 left, 2 planned a day: 5 days.
    expect(result).toMatchObject({ available: true, remaining: 10, daysRemaining: 5 });
  });

  it('works together with a refill and a waste event', () => {
    const result = estimateStock({
      medication,
      doseLogs: [taken('a', { takenAmount: 3 })],
      stockEvents: [
        makeStockEvent({ id: 'r', amount: 10, recordedAt: asTimestamp('2026-10-11T08:00:00Z') }),
        makeStockEvent({
          id: 'w',
          kind: 'waste',
          amount: 2,
          recordedAt: asTimestamp('2026-10-11T09:00:00Z'),
        }),
      ],
      today: TODAY,
    });

    expect(result).toMatchObject({ remaining: 25 });
  });

  it('refuses an unusable amount taken as invalid data, and a unit that differs as incompatible', () => {
    expect(
      estimateStock({ medication, doseLogs: [taken('a', { takenAmount: -1 })], today: TODAY }),
    ).toEqual({ available: false, reason: 'invalid-data' });
    expect(
      estimateStock({
        medication,
        doseLogs: [taken('a', { doseUnit: 'ml', takenAmount: 2 })],
        today: TODAY,
      }),
    ).toEqual({ available: false, reason: 'incompatible-units' });
  });

  it('is unavailable when there is no stock, whatever was taken, and never low', () => {
    const none = { ...medication, stock: null };
    const result = estimateStock({
      medication: none,
      doseLogs: [taken('a', { takenAmount: 99 })],
      today: TODAY,
    });

    expect(result).toEqual({ available: false, reason: 'no-stock' });
    expect(isLowStock(result)).toBe(false);
  });

  it('refreshes the own threshold warning with the amount taken', () => {
    const threshold = { quantity: 15, unit: 'tabletka' };

    expect(
      isLowStock(estimateStock({ medication, doseLogs: [taken('a')], today: TODAY }), threshold),
    ).toBe(false); // 19
    expect(
      isLowStock(
        estimateStock({ medication, doseLogs: [taken('a', { takenAmount: 5 })], today: TODAY }),
        threshold,
      ),
    ).toBe(true); // 15 <= 15
  });
});
