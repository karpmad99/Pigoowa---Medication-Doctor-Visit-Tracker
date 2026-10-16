import { describe, expect, it } from 'vitest';
import { asLocalDate, asTimestamp } from '@/utils/date';
import { makeMedication, scheduleTime } from '@/test/fixtures';
import type { MedicationFormFields } from './medicationForm';
import { applyMedicationEdit, createMedicationFromForm } from './saveMedication';
import { estimateStock } from './stock';

const TODAY = asLocalDate('2026-10-15');
const NOW = asTimestamp('2026-10-15T10:00:00Z');

function idSequence() {
  let counter = 0;
  return () => `new-${String((counter += 1))}`;
}

function context(overrides: Partial<{ today: typeof TODAY; now: typeof NOW }> = {}) {
  return { today: TODAY, now: NOW, createId: idSequence(), ...overrides };
}

/** The fields that exactly describe `makeMedication()`'s defaults, so tests change one thing at a time. */
function fieldsLike(overrides: Partial<MedicationFormFields> = {}): MedicationFormFields {
  return {
    name: 'Lek A',
    doseUnit: 'tabletka',
    notes: null,
    startDate: asLocalDate('2026-01-01'),
    endDate: null,
    scheduleTimes: [
      { scheduleTimeId: 't-1', timeOfDay: scheduleTime('x', '08:00').timeOfDay, doseAmount: 1 },
    ],
    stockQuantity: null,
    ...overrides,
  };
}

const time = (value: string) => scheduleTime('x', value).timeOfDay;

describe('createMedicationFromForm', () => {
  const fields = fieldsLike({
    notes: 'Notatka',
    startDate: asLocalDate('2026-10-01'),
    endDate: asLocalDate('2026-12-31'),
    scheduleTimes: [
      { scheduleTimeId: '', timeOfDay: time('08:00'), doseAmount: 1 },
      { scheduleTimeId: '', timeOfDay: time('20:00'), doseAmount: 0.5 },
    ],
    stockQuantity: 28,
  });

  it('builds a medication whose schedule takes effect from its start date', () => {
    const result = createMedicationFromForm(fields, { ...context(), id: 'med-new' });

    expect(result).toEqual({
      ok: true,
      medication: {
        id: 'med-new',
        name: 'Lek A',
        doseUnit: 'tabletka',
        notes: 'Notatka',
        startDate: '2026-10-01',
        endDate: '2026-12-31',
        scheduleEffectiveFrom: '2026-10-01',
        scheduleTimes: [
          { id: 'new-1', timeOfDay: '08:00', doseAmount: 1 },
          { id: 'new-2', timeOfDay: '20:00', doseAmount: 0.5 },
        ],
        stock: { quantity: 28, unit: 'tabletka', asOf: NOW },
        createdAt: NOW,
        updatedAt: NOW,
      },
    });
  });

  it('stores no stock when none was given, and a stock of zero when zero was given', () => {
    const none = createMedicationFromForm(fieldsLike({ stockQuantity: null }), {
      ...context(),
      id: 'a',
    });
    const zero = createMedicationFromForm(fieldsLike({ stockQuantity: 0 }), {
      ...context(),
      id: 'b',
    });

    expect(none.ok && none.medication.stock).toBeNull();
    expect(zero.ok && zero.medication.stock).toEqual({ quantity: 0, unit: 'tabletka', asOf: NOW });
  });

  it('writes the stock in the unit of the dose, trimmed, so the two always agree', () => {
    const result = createMedicationFromForm(fieldsLike({ doseUnit: 'ml', stockQuantity: 100 }), {
      ...context(),
      id: 'a',
    });

    expect(result.ok && result.medication.stock?.unit).toBe('ml');
  });
});

describe('applyMedicationEdit: scheduleEffectiveFrom', () => {
  const existing = makeMedication({
    startDate: asLocalDate('2026-01-01'),
    scheduleEffectiveFrom: asLocalDate('2026-03-01'),
    scheduleTimes: [scheduleTime('t-1', '08:00', 1)],
  });

  it('does not change when only the name is edited', () => {
    const result = applyMedicationEdit(existing, fieldsLike({ name: 'Nowa nazwa' }), context());

    expect(result.ok && result.medication.name).toBe('Nowa nazwa');
    expect(result.ok && result.medication.scheduleEffectiveFrom).toBe('2026-03-01');
  });

  it.each([
    ['notes', { notes: 'Nowa notatka' }],
    ['dose unit', { doseUnit: 'kapsułka' }],
    ['end date', { endDate: asLocalDate('2026-12-31') }],
  ])('does not change when only the %s is edited', (_label, change) => {
    const result = applyMedicationEdit(existing, fieldsLike(change), context());

    expect(result.ok && result.medication.scheduleEffectiveFrom).toBe('2026-03-01');
  });

  it('does not change when the schedule is saved again unchanged, even if a row has a new id or the order differs', () => {
    const two = makeMedication({
      scheduleEffectiveFrom: asLocalDate('2026-03-01'),
      scheduleTimes: [scheduleTime('t-1', '08:00', 1), scheduleTime('t-2', '20:00', 2)],
    });
    const reordered = fieldsLike({
      scheduleTimes: [
        { scheduleTimeId: '', timeOfDay: time('20:00'), doseAmount: 2 },
        { scheduleTimeId: 't-1', timeOfDay: time('08:00'), doseAmount: 1 },
      ],
    });

    const result = applyMedicationEdit(two, reordered, context());

    expect(result.ok && result.medication.scheduleEffectiveFrom).toBe('2026-03-01');
  });

  it.each([
    [
      'a time is added',
      [
        { scheduleTimeId: 't-1', timeOfDay: time('08:00'), doseAmount: 1 },
        { scheduleTimeId: '', timeOfDay: time('20:00'), doseAmount: 1 },
      ],
    ],
    ['a time is changed', [{ scheduleTimeId: 't-1', timeOfDay: time('09:00'), doseAmount: 1 }]],
    ['an amount is changed', [{ scheduleTimeId: 't-1', timeOfDay: time('08:00'), doseAmount: 2 }]],
  ])('moves to today when %s', (_label, scheduleTimes) => {
    const result = applyMedicationEdit(existing, fieldsLike({ scheduleTimes }), context());

    expect(result.ok && result.medication.scheduleEffectiveFrom).toBe('2026-10-15');
    expect(result.ok && result.medication.scheduleTimes).toHaveLength(scheduleTimes.length);
  });

  it('moves to the start date instead, if the medication has not started yet', () => {
    const future = makeMedication({
      startDate: asLocalDate('2026-11-01'),
      scheduleEffectiveFrom: asLocalDate('2026-11-01'),
      scheduleTimes: [scheduleTime('t-1', '08:00', 1)],
    });
    const result = applyMedicationEdit(
      future,
      fieldsLike({
        startDate: asLocalDate('2026-11-01'),
        scheduleTimes: [{ scheduleTimeId: 't-1', timeOfDay: time('09:00'), doseAmount: 1 }],
      }),
      context(),
    );

    expect(result.ok && result.medication.scheduleEffectiveFrom).toBe('2026-11-01');
  });

  it('keeps the ids of unchanged schedule rows and gives new rows fresh ids', () => {
    const result = applyMedicationEdit(
      existing,
      fieldsLike({
        scheduleTimes: [
          { scheduleTimeId: 't-1', timeOfDay: time('08:00'), doseAmount: 1 },
          { scheduleTimeId: '', timeOfDay: time('20:00'), doseAmount: 1 },
        ],
      }),
      context(),
    );

    expect(result.ok && result.medication.scheduleTimes.map((entry) => entry.id)).toEqual([
      't-1',
      'new-1',
    ]);
  });
});

describe('applyMedicationEdit: start date', () => {
  it('makes the effective date follow the start date when the schedule was never changed', () => {
    const untouched = makeMedication({
      startDate: asLocalDate('2026-10-10'),
      scheduleEffectiveFrom: asLocalDate('2026-10-10'),
    });

    const earlier = applyMedicationEdit(
      untouched,
      fieldsLike({ startDate: asLocalDate('2026-10-01') }),
      context(),
    );
    const later = applyMedicationEdit(
      untouched,
      fieldsLike({ startDate: asLocalDate('2026-10-12') }),
      context(),
    );

    expect(earlier.ok && earlier.medication.scheduleEffectiveFrom).toBe('2026-10-01');
    expect(later.ok && later.medication.scheduleEffectiveFrom).toBe('2026-10-12');
  });

  it('keeps a later effective date when the start date moves earlier (the schedule was changed since)', () => {
    const changedBefore = makeMedication({
      startDate: asLocalDate('2026-10-01'),
      scheduleEffectiveFrom: asLocalDate('2026-10-10'),
    });

    const result = applyMedicationEdit(
      changedBefore,
      fieldsLike({ startDate: asLocalDate('2026-09-20') }),
      context(),
    );

    expect(result.ok && result.medication.scheduleEffectiveFrom).toBe('2026-10-10');
  });

  it('never leaves the effective date before the start date', () => {
    const changedBefore = makeMedication({
      startDate: asLocalDate('2026-10-01'),
      scheduleEffectiveFrom: asLocalDate('2026-10-10'),
    });

    const result = applyMedicationEdit(
      changedBefore,
      fieldsLike({ startDate: asLocalDate('2026-10-14') }),
      context(),
    );

    expect(result.ok && result.medication.scheduleEffectiveFrom).toBe('2026-10-14');
  });
});

describe('applyMedicationEdit: stock', () => {
  const counted = asTimestamp('2026-09-01T08:00:00Z');
  const withStock = makeMedication({
    scheduleTimes: [scheduleTime('t-1', '08:00', 1)],
    stock: { quantity: 28, unit: 'tabletka', asOf: counted },
  });

  it('keeps the stock, including when it was counted, if its quantity is not changed', () => {
    const result = applyMedicationEdit(
      withStock,
      fieldsLike({ name: 'Inna', stockQuantity: 28 }),
      context(),
    );

    expect(result.ok && result.medication.stock).toEqual({
      quantity: 28,
      unit: 'tabletka',
      asOf: counted,
    });
  });

  it('starts counting afresh from now when the quantity is changed', () => {
    const result = applyMedicationEdit(withStock, fieldsLike({ stockQuantity: 20 }), context());

    expect(result.ok && result.medication.stock).toEqual({
      quantity: 20,
      unit: 'tabletka',
      asOf: NOW,
    });
  });

  it('removes the stock when the field is cleared', () => {
    const result = applyMedicationEdit(withStock, fieldsLike({ stockQuantity: null }), context());

    expect(result.ok && result.medication.stock).toBeNull();
  });

  it('does not silently reinterpret the stock when only the dose unit changes: the estimate becomes unavailable', () => {
    const result = applyMedicationEdit(
      withStock,
      fieldsLike({ doseUnit: 'ml', stockQuantity: 28 }),
      context(),
    );
    if (!result.ok) throw new Error('should be allowed');

    expect(result.medication.stock?.unit).toBe('tabletka');
    expect(estimateStock({ medication: result.medication, doseLogs: [], today: TODAY })).toEqual({
      available: false,
      reason: 'incompatible-units',
    });
  });

  it('gives usable stock again once the quantity is re-entered after a unit change', () => {
    const result = applyMedicationEdit(
      withStock,
      fieldsLike({ doseUnit: 'ml', stockQuantity: 100 }),
      context(),
    );
    if (!result.ok) throw new Error('should be allowed');

    expect(result.medication.stock).toEqual({ quantity: 100, unit: 'ml', asOf: NOW });
    expect(
      estimateStock({ medication: result.medication, doseLogs: [], today: TODAY }).available,
    ).toBe(true);
  });
});

describe('applyMedicationEdit: what never changes', () => {
  it('keeps the id and creation time, and records the time of the edit', () => {
    const existing = makeMedication({
      id: 'med-9',
      createdAt: asTimestamp('2026-01-01T08:00:00Z'),
    });

    const result = applyMedicationEdit(existing, fieldsLike({ name: 'Inna' }), context());

    expect(result.ok && result.medication).toMatchObject({
      id: 'med-9',
      createdAt: '2026-01-01T08:00:00.000Z',
      updatedAt: NOW,
    });
  });

  it('does not modify the medication it was given', () => {
    const existing = makeMedication();
    const before = JSON.stringify(existing);

    applyMedicationEdit(
      existing,
      fieldsLike({
        name: 'Inna',
        scheduleTimes: [{ scheduleTimeId: '', timeOfDay: time('21:00'), doseAmount: 3 }],
      }),
      context(),
    );

    expect(JSON.stringify(existing)).toBe(before);
  });
});
