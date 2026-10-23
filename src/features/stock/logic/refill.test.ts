import { describe, expect, it } from 'vitest';
import { makeMedication } from '@/test/fixtures';
import { asLocalDate, asTimestamp } from '@/utils/date';
import { STOCK_EVENT_NOTE_MAX } from './limits';
import { buildRefill, buildWaste, refillAvailability, type BuildRefillInput } from './refill';

const NOW = asTimestamp('2026-10-15T10:00:00Z');
const TODAY = asLocalDate('2026-10-15');
const withStock = makeMedication({
  id: 'm-1',
  stock: { quantity: 28, unit: 'tabletka', asOf: asTimestamp('2026-10-01T08:00:00Z') },
});

function input(overrides: Partial<BuildRefillInput> = {}): BuildRefillInput {
  return {
    medication: withStock,
    amountText: '30',
    noteText: '',
    id: 'ev-new',
    now: NOW,
    today: TODAY,
    ...overrides,
  };
}

describe('buildRefill', () => {
  it('builds a refill event in the unit of the stock, recorded now, not reversed', () => {
    expect(buildRefill(input())).toEqual({
      ok: true,
      event: {
        id: 'ev-new',
        medicationId: 'm-1',
        kind: 'refill',
        amount: 30,
        unit: 'tabletka',
        recordedAt: NOW,
        note: null,
        reversedAt: null,
      },
    });
  });

  it.each([
    ['30', 30],
    ['0,5', 0.5],
    ['12.25', 12.25],
    [' 7 ', 7],
    ['0,001', 0.001],
    ['9999999,999', 9_999_999.999],
  ])('reads the amount "%s" as %s', (amountText, amount) => {
    const result = buildRefill(input({ amountText }));

    expect(result.ok && result.event.amount).toBe(amount);
  });

  it.each(['', '  ', '0', '0,0', '-5', 'abc', '1e3', '1,2345', '10000000', '1 000'])(
    'refuses the amount "%s": nothing is built',
    (amountText) => {
      expect(buildRefill(input({ amountText }))).toEqual({
        ok: false,
        issues: [{ field: 'amount', code: 'amount-invalid' }],
      });
    },
  );

  it('uses the unit the stock is counted in, exactly as stored, and never the dose unit', () => {
    const medication = makeMedication({
      id: 'm-1',
      doseUnit: 'kropla',
      stock: { quantity: 10, unit: 'Ml ', asOf: asTimestamp('2026-10-01T08:00:00Z') },
    });

    const result = buildRefill(input({ medication }));

    expect(result.ok && result.event.unit).toBe('Ml ');
  });

  it('stores the note on the event, trimmed, and null for an empty one', () => {
    const noted = buildRefill(input({ noteText: '  Nowe opakowanie z apteki  ' }));
    const plain = buildRefill(input({ noteText: '   ' }));

    expect(noted.ok && noted.event.note).toBe('Nowe opakowanie z apteki');
    expect(plain.ok && plain.event.note).toBeNull();
  });

  it('allows a note of exactly the limit and refuses one character more', () => {
    const limit = 'x'.repeat(STOCK_EVENT_NOTE_MAX);

    expect(buildRefill(input({ noteText: limit })).ok).toBe(true);
    expect(buildRefill(input({ noteText: `${limit}x` }))).toEqual({
      ok: false,
      issues: [{ field: 'note', code: 'note-too-long' }],
    });
    // The limit is counted after trimming.
    expect(buildRefill(input({ noteText: `  ${limit}  ` })).ok).toBe(true);
  });

  it('refuses a refill for a medication without a stock to add to, and says so', () => {
    const result = buildRefill(input({ medication: makeMedication({ id: 'm-1', stock: null }) }));

    expect(result).toEqual({ ok: false, issues: [{ field: 'medication', code: 'no-baseline' }] });
  });

  it('refuses a refill for an ended medication', () => {
    const ended = makeMedication({
      id: 'm-1',
      endDate: asLocalDate('2026-10-14'),
      stock: withStock.stock,
    });

    expect(buildRefill(input({ medication: ended }))).toEqual({
      ok: false,
      issues: [{ field: 'medication', code: 'medication-ended' }],
    });
  });

  it('allows a refill on the last day of a medication', () => {
    const lastDay = makeMedication({
      id: 'm-1',
      endDate: TODAY,
      stock: withStock.stock,
    });

    expect(buildRefill(input({ medication: lastDay })).ok).toBe(true);
  });

  it('reports every problem together', () => {
    const result = buildRefill(
      input({
        medication: makeMedication({ id: 'm-1', stock: null }),
        amountText: '0',
        noteText: 'x'.repeat(STOCK_EVENT_NOTE_MAX + 1),
      }),
    );

    expect(result).toEqual({
      ok: false,
      issues: [
        { field: 'medication', code: 'no-baseline' },
        { field: 'amount', code: 'amount-invalid' },
        { field: 'note', code: 'note-too-long' },
      ],
    });
  });

  it('does not change the medication it is given, and uses the id it is given', () => {
    const before = JSON.stringify(withStock);

    const result = buildRefill(input({ id: 'chosen-id' }));

    expect(JSON.stringify(withStock)).toBe(before);
    expect(result.ok && result.event.id).toBe('chosen-id');
  });
});

describe('refillAvailability', () => {
  it('is available with a stock, and says why when it is not', () => {
    expect(refillAvailability(withStock, TODAY)).toBe('available');
    expect(refillAvailability(makeMedication({ stock: null }), TODAY)).toBe('no-baseline');
    expect(refillAvailability({ ...withStock, endDate: asLocalDate('2026-10-14') }, TODAY)).toBe(
      'ended',
    );
  });

  it('reports an ended medication as ended even when it has no stock', () => {
    expect(
      refillAvailability(
        makeMedication({ stock: null, endDate: asLocalDate('2026-10-14') }),
        TODAY,
      ),
    ).toBe('ended');
  });
});

describe('buildWaste: the same rules, the other kind', () => {
  it('builds a waste event in the unit of the stock, recorded now, not reversed, with no dose in it', () => {
    const result = buildWaste(input({ amountText: '2', noteText: 'Wypadły do zlewu' }));

    expect(result).toEqual({
      ok: true,
      event: {
        id: 'ev-new',
        medicationId: 'm-1',
        kind: 'waste',
        amount: 2,
        unit: 'tabletka',
        recordedAt: NOW,
        note: 'Wypadły do zlewu',
        reversedAt: null,
      },
    });
    // A stock event has no slot, no date of a dose and no status of a dose.
    expect(result.ok && Object.keys(result.event).sort()).toEqual(
      ['amount', 'id', 'kind', 'medicationId', 'note', 'recordedAt', 'reversedAt', 'unit'].sort(),
    );
  });

  it.each(['', '0', '-1', 'abc', '1,2345', '10000000'])('refuses the amount "%s"', (amountText) => {
    expect(buildWaste(input({ amountText }))).toEqual({
      ok: false,
      issues: [{ field: 'amount', code: 'amount-invalid' }],
    });
  });

  it('allows an amount larger than the stock: an estimate must not block a fact', () => {
    const result = buildWaste(input({ amountText: '9999' }));

    expect(result.ok && result.event.amount).toBe(9999);
  });

  it('uses the stock unit, never the dose unit', () => {
    const drops = makeMedication({
      id: 'm-1',
      doseUnit: 'kropla',
      stock: { quantity: 10, unit: 'ml', asOf: asTimestamp('2026-10-01T08:00:00Z') },
    });

    const result = buildWaste(input({ medication: drops }));

    expect(result.ok && result.event.unit).toBe('ml');
  });

  it('refuses a medication with no stock (unknown is not zero) and an ended one', () => {
    expect(buildWaste(input({ medication: makeMedication({ id: 'm-1', stock: null }) }))).toEqual({
      ok: false,
      issues: [{ field: 'medication', code: 'no-baseline' }],
    });
    expect(
      buildWaste(input({ medication: { ...withStock, endDate: asLocalDate('2026-10-14') } })),
    ).toEqual({ ok: false, issues: [{ field: 'medication', code: 'medication-ended' }] });
  });

  it('keeps the note on the event: trimmed, null when empty, refused over the limit', () => {
    expect(buildWaste(input({ noteText: '   ' })).ok && 'ok').toBe('ok');
    const empty = buildWaste(input({ noteText: '   ' }));
    expect(empty.ok && empty.event.note).toBeNull();
    expect(buildWaste(input({ noteText: 'x'.repeat(STOCK_EVENT_NOTE_MAX + 1) }))).toEqual({
      ok: false,
      issues: [{ field: 'note', code: 'note-too-long' }],
    });
  });

  it('does not change the medication: no schedule, stock, notes or dates are touched', () => {
    const before = JSON.stringify(withStock);

    buildWaste(input({ amountText: '2', noteText: 'x' }));

    expect(JSON.stringify(withStock)).toBe(before);
  });
});
