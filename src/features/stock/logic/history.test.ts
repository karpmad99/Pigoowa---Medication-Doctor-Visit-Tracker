import { describe, expect, it } from 'vitest';
import { makeStockEvent } from '@/test/fixtures';
import { asTimestamp } from '@/utils/date';
import { buildStockHistory, stockEventState } from './history';

const stock = { quantity: 10, unit: 'tabletka', asOf: asTimestamp('2026-10-10T08:00:00Z') };

describe('stockEventState', () => {
  it('counts an event recorded at or after the count, and not one before it', () => {
    expect(
      stockEventState(makeStockEvent({ recordedAt: asTimestamp('2026-10-10T08:00:00Z') }), stock),
    ).toBe('counted');
    expect(
      stockEventState(makeStockEvent({ recordedAt: asTimestamp('2026-10-10T08:00:01Z') }), stock),
    ).toBe('counted');
    expect(
      stockEventState(makeStockEvent({ recordedAt: asTimestamp('2026-10-10T07:59:59Z') }), stock),
    ).toBe('before-count');
  });

  it('says reversed for a reversed event, whatever else is true of it', () => {
    const reversed = makeStockEvent({
      recordedAt: asTimestamp('2026-10-11T08:00:00Z'),
      reversedAt: asTimestamp('2026-10-11T08:05:00Z'),
    });

    expect(stockEventState(reversed, stock)).toBe('reversed');
    expect(stockEventState(reversed, null)).toBe('reversed');
  });

  it('says not-tracked for an event of a medication that has no stock now', () => {
    expect(stockEventState(makeStockEvent(), null)).toBe('not-tracked');
  });
});

describe('buildStockHistory', () => {
  const events = [
    makeStockEvent({ id: 'a', recordedAt: asTimestamp('2026-10-01T08:00:00Z') }),
    makeStockEvent({ id: 'b', recordedAt: asTimestamp('2026-10-12T08:00:00Z'), amount: 5 }),
    makeStockEvent({
      id: 'c',
      recordedAt: asTimestamp('2026-10-11T08:00:00Z'),
      reversedAt: asTimestamp('2026-10-11T09:00:00Z'),
    }),
    makeStockEvent({ id: 'other', medicationId: 'med-2' }),
  ];

  it('lists the events of the medication only, newest first, each with what it does now', () => {
    expect(
      buildStockHistory(events, 'med-1', stock).map((row) => [row.event.id, row.state]),
    ).toEqual([
      ['b', 'counted'],
      ['c', 'reversed'],
      ['a', 'before-count'],
    ]);
  });

  it('keeps a reversed event and an event before the count: nothing is dropped from the history', () => {
    expect(buildStockHistory(events, 'med-1', stock)).toHaveLength(3);
  });

  it('breaks a tie of moments by id, the same way every time', () => {
    const same = asTimestamp('2026-10-12T08:00:00Z');
    const tied = [
      makeStockEvent({ id: 'x', recordedAt: same }),
      makeStockEvent({ id: 'y', recordedAt: same }),
    ];

    expect(buildStockHistory(tied, 'med-1', stock).map((row) => row.event.id)).toEqual(['y', 'x']);
    expect(
      buildStockHistory([...tied].reverse(), 'med-1', stock).map((row) => row.event.id),
    ).toEqual(['y', 'x']);
  });

  it('is empty for a medication with no events, and does not change its input', () => {
    const before = JSON.stringify(events);

    expect(buildStockHistory(events, 'nobody', stock)).toEqual([]);
    buildStockHistory(events, 'med-1', stock);
    expect(JSON.stringify(events)).toBe(before);
  });
});
