import { describe, expect, it } from 'vitest';
import { makeDoseLog, makeMedication, scheduleTime } from '@/test/fixtures';
import { asLocalDate, asTimestamp } from '@/utils/date';
import { estimateStock } from './stock';
import { summarizeStock } from './stockSummary';

const TODAY = asLocalDate('2026-10-15');
const COUNTED = asTimestamp('2026-10-01T08:00:00Z');
const withStock = (id: string, name: string, quantity: number, overrides = {}) =>
  makeMedication({
    id,
    name,
    scheduleTimes: [scheduleTime(`${id}-t`, '08:00', 1)],
    stock: { quantity, unit: 'tabletka', asOf: COUNTED },
    ...overrides,
  });

describe('summarizeStock', () => {
  it('lists only medications whose estimate can be computed, soonest to run out first', () => {
    const result = summarizeStock({
      medications: [
        withStock('a', 'Lek A', 30), // 30 days
        withStock('b', 'Lek B', 3), // 3 days
        withStock('c', 'Lek C', 12), // 12 days
      ],
      doseLogs: [],
      today: TODAY,
    });

    expect(result.items.map((item) => [item.medication.name, item.estimate.daysRemaining])).toEqual(
      [
        ['Lek B', 3],
        ['Lek C', 12],
        ['Lek A', 30],
      ],
    );
    expect(result.unavailableCount).toBe(0);
  });

  it('uses the figures of estimateStock unchanged (no arithmetic of its own)', () => {
    const medication = withStock('a', 'Lek A', 10);
    const doseLogs = [
      makeDoseLog({ id: 'l1', medicationId: 'a', recordedAt: asTimestamp('2026-10-10T08:00:00Z') }),
      makeDoseLog({
        id: 'l2',
        medicationId: 'a',
        scheduledDate: asLocalDate('2026-10-11'),
        recordedAt: asTimestamp('2026-10-11T08:00:00Z'),
        status: 'skipped',
      }),
    ];

    const [item] = summarizeStock({ medications: [medication], doseLogs, today: TODAY }).items;

    expect(item?.estimate).toEqual(estimateStock({ medication, doseLogs, today: TODAY }));
    expect(item?.estimate.remaining).toBe(9); // one taken dose counted, the skipped one not
  });

  it('never lists a medication without a computable estimate: it is only counted', () => {
    const result = summarizeStock({
      medications: [
        withStock('ok', 'Z zapasem', 20),
        makeMedication({ id: 'none', name: 'Bez zapasu', stock: null }),
        withStock('units', 'Inne jednostki', 20, {
          stock: { quantity: 20, unit: 'mg', asOf: COUNTED },
        }),
        withStock('empty', 'Bez harmonogramu', 20, { scheduleTimes: [] }),
      ],
      doseLogs: [],
      today: TODAY,
    });

    expect(result.items.map((item) => item.medication.id)).toEqual(['ok']);
    expect(result.unavailableCount).toBe(3);
  });

  it('does not count an ended medication as "unavailable", and does not list it', () => {
    const result = summarizeStock({
      medications: [withStock('old', 'Zakończony', 20, { endDate: asLocalDate('2026-10-01') })],
      doseLogs: [],
      today: TODAY,
    });

    expect(result).toEqual({ items: [], unavailableCount: 0 });
  });

  it('does not count an ended medication without stock either (the estimate would say "no stock" first)', () => {
    const result = summarizeStock({
      medications: [
        makeMedication({
          id: 'old',
          name: 'Zakończony',
          stock: null,
          endDate: asLocalDate('2026-10-01'),
        }),
        makeMedication({ id: 'live', name: 'W użyciu', stock: null }),
      ],
      doseLogs: [],
      today: TODAY,
    });

    expect(result).toEqual({ items: [], unavailableCount: 1 });
  });

  it('lists used-up stock as an available zero (it is not "unavailable")', () => {
    const medication = withStock('a', 'Lek A', 1);
    const result = summarizeStock({
      medications: [medication],
      doseLogs: [
        makeDoseLog({ medicationId: 'a', recordedAt: asTimestamp('2026-10-10T08:00:00Z') }),
      ],
      today: TODAY,
    });

    expect(result.items[0]?.estimate).toMatchObject({ available: true, remaining: 0 });
    expect(result.unavailableCount).toBe(0);
  });

  it('breaks ties by Polish name and then id, so the order is stable', () => {
    const result = summarizeStock({
      medications: [
        withStock('3', 'Żyrafa', 10),
        withStock('2', 'Ąbc', 10),
        withStock('1', 'Ąbc', 10),
        withStock('4', 'Bec', 10),
      ],
      doseLogs: [],
      today: TODAY,
    });

    expect(result.items.map((item) => item.medication.id)).toEqual(['1', '2', '4', '3']);
  });

  it('is empty for no medications, and does not modify its input', () => {
    expect(summarizeStock({ medications: [], doseLogs: [], today: TODAY })).toEqual({
      items: [],
      unavailableCount: 0,
    });
    const medications = [withStock('a', 'A', 5), withStock('b', 'B', 1)];
    const snapshot = structuredClone(medications);
    summarizeStock({ medications, doseLogs: [], today: TODAY });
    expect(medications).toEqual(snapshot);
  });
});
