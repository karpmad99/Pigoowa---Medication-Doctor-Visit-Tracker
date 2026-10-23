import { describe, expect, it } from 'vitest';
import { makeMedication } from '@/test/fixtures';
import { asLocalDate, asTimestamp } from '@/utils/date';
import { estimateStock } from '@/features/medications/logic/stock';
import { buildStartTracking, type StartTrackingInput } from './startTracking';

const NOW = asTimestamp('2026-10-15T10:00:00Z');
const TODAY = asLocalDate('2026-10-15');
const untracked = makeMedication({ id: 'm-1', doseUnit: 'tabletka', stock: null });

function input(overrides: Partial<StartTrackingInput> = {}): StartTrackingInput {
  return {
    medication: untracked,
    mode: 'counted',
    quantityText: '28',
    now: NOW,
    today: TODAY,
    ...overrides,
  };
}

describe('buildStartTracking: counted', () => {
  it('creates a baseline from the typed quantity, in the dose unit, as of now, marked as counted', () => {
    const result = buildStartTracking(input());

    expect(result.ok && result.medication.stock).toEqual({
      quantity: 28,
      unit: 'tabletka',
      asOf: NOW,
      basis: 'counted',
    });
    expect(result.ok && result.medication.updatedAt).toBe(NOW);
  });

  it('allows a typed zero: "I have none" is a real count', () => {
    const result = buildStartTracking(input({ quantityText: '0' }));

    expect(result.ok && result.medication.stock?.quantity).toBe(0);
  });

  it('refuses an empty field and never stores it as zero', () => {
    for (const quantityText of ['', '   ']) {
      expect(buildStartTracking(input({ quantityText }))).toEqual({
        ok: false,
        issues: ['quantity-required'],
      });
    }
  });

  it.each(['-1', 'abc', '1,2345', '1e3', '10000000'])(
    'refuses the quantity "%s"',
    (quantityText) => {
      expect(buildStartTracking(input({ quantityText }))).toEqual({
        ok: false,
        issues: ['quantity-invalid'],
      });
    },
  );
});

describe('buildStartTracking: new package', () => {
  it('creates a baseline from the size of the package, marked as new-package', () => {
    const result = buildStartTracking(input({ mode: 'new-package', quantityText: '30' }));

    expect(result.ok && result.medication.stock).toEqual({
      quantity: 30,
      unit: 'tabletka',
      asOf: NOW,
      basis: 'new-package',
    });
  });

  it('refuses a package of size zero (a counted zero is allowed, a package of zero is not)', () => {
    expect(buildStartTracking(input({ mode: 'new-package', quantityText: '0' }))).toEqual({
      ok: false,
      issues: ['package-size-zero'],
    });
  });

  it('refuses an empty field here too', () => {
    expect(buildStartTracking(input({ mode: 'new-package', quantityText: '' }))).toEqual({
      ok: false,
      issues: ['quantity-required'],
    });
  });
});

describe('buildStartTracking: nothing is invented', () => {
  it('creates nothing when neither choice was made', () => {
    expect(buildStartTracking(input({ mode: null }))).toEqual({
      ok: false,
      issues: ['mode-required'],
    });
  });

  it('reports a missing choice together with a missing quantity', () => {
    expect(buildStartTracking(input({ mode: null, quantityText: '' }))).toEqual({
      ok: false,
      issues: ['mode-required', 'quantity-required'],
    });
  });

  it('refuses a medication that already has a stock: it is not replaced here', () => {
    const tracked = makeMedication({
      stock: { quantity: 5, unit: 'tabletka', asOf: asTimestamp('2026-10-01T08:00:00Z') },
    });

    expect(buildStartTracking(input({ medication: tracked }))).toEqual({
      ok: false,
      issues: ['already-tracking'],
    });
  });

  it('refuses an ended medication', () => {
    const ended = makeMedication({ stock: null, endDate: asLocalDate('2026-10-14') });

    expect(buildStartTracking(input({ medication: ended }))).toEqual({
      ok: false,
      issues: ['medication-ended'],
    });
  });

  it('does not change the medication it is given, and changes nothing but the stock and updatedAt', () => {
    const before = JSON.stringify(untracked);

    const result = buildStartTracking(input());

    expect(JSON.stringify(untracked)).toBe(before);
    expect(
      result.ok && { ...result.medication, stock: null, updatedAt: untracked.updatedAt },
    ).toEqual(untracked);
  });

  it('keeps the unit of the dose as the unit of the stock, whatever the form, and never converts', () => {
    const drops = makeMedication({ doseUnit: 'kropla', stock: null });

    const result = buildStartTracking(input({ medication: drops, quantityText: '40' }));

    expect(result.ok && result.medication.stock?.unit).toBe('kropla');
  });
});

describe('the estimate after starting to track', () => {
  const schedule = makeMedication({
    id: 'm-1',
    doseUnit: 'tabletka',
    stock: null,
  });

  it('is unavailable until something is created (no-stock), and available from the baseline', () => {
    expect(estimateStock({ medication: schedule, doseLogs: [], today: TODAY })).toEqual({
      available: false,
      reason: 'no-stock',
    });
    const result = buildStartTracking(input({ medication: schedule, quantityText: '10' }));
    if (!result.ok) throw new Error('should be allowed');

    expect(estimateStock({ medication: result.medication, doseLogs: [], today: TODAY })).toEqual({
      available: true,
      remaining: 10,
      unit: 'tabletka',
      daysRemaining: 10,
    });
  });

  it('gives the same numbers for a counted baseline and a new-package one of the same size: only the wording differs', () => {
    const counted = buildStartTracking(input({ medication: schedule, quantityText: '10' }));
    const fresh = buildStartTracking(
      input({ medication: schedule, mode: 'new-package', quantityText: '10' }),
    );
    if (!counted.ok || !fresh.ok) throw new Error('should be allowed');

    expect(estimateStock({ medication: fresh.medication, doseLogs: [], today: TODAY })).toEqual(
      estimateStock({ medication: counted.medication, doseLogs: [], today: TODAY }),
    );
  });

  it('shows a counted zero as available and used up, which is not the same as no stock', () => {
    const result = buildStartTracking(input({ medication: schedule, quantityText: '0' }));
    if (!result.ok) throw new Error('should be allowed');

    expect(
      estimateStock({ medication: result.medication, doseLogs: [], today: TODAY }),
    ).toMatchObject({
      available: true,
      remaining: 0,
    });
  });
});
