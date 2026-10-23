import { describe, expect, it } from 'vitest';
import { asLocalDate, asTimestamp } from '@/utils/date';
import { makeMedication, scheduleTime } from '@/test/fixtures';
import type { MedicationFormFields } from './medicationForm';
import { applyMedicationEdit, createMedicationFromForm } from './saveMedication';
import { estimateStock, thresholdUnitDiffers } from './stock';

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
    dosageForm: null,
    doseUnit: 'tabletka',
    doseUnitAsEntered: overrides.doseUnit ?? 'tabletka',
    strength: null,
    notes: null,
    startDate: asLocalDate('2026-01-01'),
    endDate: null,
    scheduleTimes: [
      { scheduleTimeId: 't-1', timeOfDay: scheduleTime('x', '08:00').timeOfDay, doseAmount: 1 },
    ],
    stockQuantity: null,
    stockUnit: null,
    lowStockThreshold: null,
    lowStockThresholdUnit: null,
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
      fieldsLike({ doseUnit: 'ml', stockQuantity: 28, stockUnit: 'tabletka' }),
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

describe('the dosage form and the strength when saving', () => {
  const strength = { value: 500, unit: 'mg' };

  it('creates a medication with the form and the strength that were given', () => {
    const result = createMedicationFromForm(fieldsLike({ dosageForm: 'tablet', strength }), {
      ...context(),
      id: 'new-med',
    });

    expect(result.ok && result.medication).toMatchObject({ dosageForm: 'tablet', strength });
  });

  it('creates a medication WITHOUT the fields when none were given: absent, not null', () => {
    const result = createMedicationFromForm(fieldsLike(), { ...context(), id: 'new-med' });

    expect(result.ok && 'dosageForm' in result.medication).toBe(false);
    expect(result.ok && 'strength' in result.medication).toBe(false);
  });

  it('edits an older medication without adding the fields it never had', () => {
    const existing = makeMedication();

    const result = applyMedicationEdit(existing, fieldsLike({ name: 'Inna' }), context());

    expect(result.ok && 'dosageForm' in result.medication).toBe(false);
    expect(result.ok && 'strength' in result.medication).toBe(false);
  });

  it('adds, changes and removes the form and the strength as the form says', () => {
    const existing = makeMedication();
    const added = applyMedicationEdit(
      existing,
      fieldsLike({ dosageForm: 'capsule', strength }),
      context(),
    );
    if (!added.ok) throw new Error('should be allowed');
    expect(added.medication).toMatchObject({ dosageForm: 'capsule', strength });

    const changed = applyMedicationEdit(
      added.medication,
      fieldsLike({ dosageForm: 'tablet', strength: { value: 1, unit: 'g' } }),
      context(),
    );
    expect(changed.ok && changed.medication).toMatchObject({
      dosageForm: 'tablet',
      strength: { value: 1, unit: 'g' },
    });

    const removed = applyMedicationEdit(added.medication, fieldsLike(), context());
    expect(removed.ok && 'dosageForm' in removed.medication).toBe(false);
    expect(removed.ok && 'strength' in removed.medication).toBe(false);
  });

  it('changing only the strength does not touch the schedule, the stock or when it was counted', () => {
    const counted = asTimestamp('2026-09-01T08:00:00Z');
    const existing = makeMedication({
      stock: { quantity: 28, unit: 'tabletka', asOf: counted },
    });

    const result = applyMedicationEdit(
      existing,
      fieldsLike({ strength, stockQuantity: 28, stockUnit: 'tabletka' }),
      context(),
    );

    expect(result.ok && result.medication.stock).toEqual(existing.stock);
    expect(result.ok && result.medication.scheduleTimes).toEqual(existing.scheduleTimes);
    expect(result.ok && result.medication.scheduleEffectiveFrom).toBe(
      existing.scheduleEffectiveFrom,
    );
  });
});

describe('units when saving: nothing is rewritten, converted or replaced', () => {
  it('keeps the stored dose unit byte for byte when the form held it unchanged', () => {
    const existing = makeMedication({ doseUnit: 'Tabletka ' });

    const result = applyMedicationEdit(
      existing,
      fieldsLike({ name: 'Inna', doseUnit: 'Tabletka', doseUnitAsEntered: 'Tabletka ' }),
      context(),
    );

    expect(result.ok && result.medication.doseUnit).toBe('Tabletka ');
  });

  it('stores the new dose unit, trimmed, when the person changed it', () => {
    const existing = makeMedication({ doseUnit: 'Tabletka ' });

    const result = applyMedicationEdit(
      existing,
      fieldsLike({ doseUnit: 'ml', doseUnitAsEntered: ' ml ' }),
      context(),
    );

    expect(result.ok && result.medication.doseUnit).toBe('ml');
  });

  it('keeps a stock whose unit is outside every list, unchanged, with its counting moment', () => {
    const counted = asTimestamp('2026-09-01T08:00:00Z');
    const existing = makeMedication({
      stock: { quantity: 3, unit: 'opakowanie ', asOf: counted },
    });

    const result = applyMedicationEdit(
      existing,
      fieldsLike({ stockQuantity: 3, stockUnit: 'opakowanie ' }),
      context(),
    );

    expect(result.ok && result.medication.stock).toEqual(existing.stock);
  });

  it('counts the stock again from now when its unit is changed, even with the same quantity', () => {
    const counted = asTimestamp('2026-09-01T08:00:00Z');
    const existing = makeMedication({
      stock: { quantity: 20, unit: 'kropla', asOf: counted },
    });

    const result = applyMedicationEdit(
      existing,
      fieldsLike({ doseUnit: 'kropla', stockQuantity: 20, stockUnit: 'ml' }),
      context(),
    );

    expect(result.ok && result.medication.stock).toEqual({ quantity: 20, unit: 'ml', asOf: NOW });
    expect(
      result.ok && estimateStock({ medication: result.medication, doseLogs: [], today: TODAY }),
    ).toEqual({ available: false, reason: 'incompatible-units' });
  });

  it('stores a stock in the dose unit when the stock unit is left empty', () => {
    const result = createMedicationFromForm(
      fieldsLike({ doseUnit: 'ml', stockQuantity: 100, stockUnit: null }),
      { ...context(), id: 'new-med' },
    );

    expect(result.ok && result.medication.stock).toEqual({ quantity: 100, unit: 'ml', asOf: NOW });
  });

  it('does not convert or substitute anything between drops and millilitres', () => {
    const result = createMedicationFromForm(
      fieldsLike({ doseUnit: 'kropla', stockQuantity: 10, stockUnit: 'ml' }),
      { ...context(), id: 'new-med' },
    );

    expect(result.ok && result.medication).toMatchObject({
      doseUnit: 'kropla',
      stock: { quantity: 10, unit: 'ml' },
    });
  });
});

describe('the own low-stock threshold when saving', () => {
  const counted = asTimestamp('2026-09-01T08:00:00Z');
  const withStock = makeMedication({ stock: { quantity: 28, unit: 'tabletka', asOf: counted } });

  it('creates a medication with a threshold in the unit the stock is saved in', () => {
    const result = createMedicationFromForm(
      fieldsLike({ stockQuantity: 28, lowStockThreshold: 5 }),
      { ...context(), id: 'new-med' },
    );

    expect(result.ok && result.medication.lowStockThreshold).toEqual({
      quantity: 5,
      unit: 'tabletka',
    });
  });

  it('counts a new threshold in the stock unit that was chosen, not the dose unit', () => {
    const result = createMedicationFromForm(
      fieldsLike({
        doseUnit: 'kropla',
        stockQuantity: 10,
        stockUnit: 'ml',
        lowStockThreshold: 2,
      }),
      { ...context(), id: 'new-med' },
    );

    expect(result.ok && result.medication.lowStockThreshold).toEqual({ quantity: 2, unit: 'ml' });
  });

  it('creates a medication without the field when there is no threshold: absent, not null', () => {
    const result = createMedicationFromForm(fieldsLike({ stockQuantity: 28 }), {
      ...context(),
      id: 'new-med',
    });

    expect(result.ok && 'lowStockThreshold' in result.medication).toBe(false);
  });

  it('stores no threshold when there is no stock, whatever was typed', () => {
    const result = createMedicationFromForm(fieldsLike({ lowStockThreshold: 5 }), {
      ...context(),
      id: 'new-med',
    });

    expect(result.ok && 'lowStockThreshold' in result.medication).toBe(false);
  });

  it('edits an older medication without adding a threshold it never had', () => {
    const result = applyMedicationEdit(
      withStock,
      fieldsLike({ name: 'Inna', stockQuantity: 28, stockUnit: 'tabletka' }),
      context(),
    );

    expect(result.ok && 'lowStockThreshold' in result.medication).toBe(false);
  });

  it('adds, changes and removes the threshold as the form says', () => {
    const base = { stockQuantity: 28, stockUnit: 'tabletka' };
    const added = applyMedicationEdit(
      withStock,
      fieldsLike({ ...base, lowStockThreshold: 5 }),
      context(),
    );
    if (!added.ok) throw new Error('should be allowed');
    expect(added.medication.lowStockThreshold).toEqual({ quantity: 5, unit: 'tabletka' });

    const changed = applyMedicationEdit(
      added.medication,
      fieldsLike({ ...base, lowStockThreshold: 8, lowStockThresholdUnit: 'tabletka' }),
      context(),
    );
    expect(changed.ok && changed.medication.lowStockThreshold).toEqual({
      quantity: 8,
      unit: 'tabletka',
    });

    const removed = applyMedicationEdit(added.medication, fieldsLike(base), context());
    expect(removed.ok && 'lowStockThreshold' in removed.medication).toBe(false);
  });

  it('keeps an unchanged threshold as it is, the same object and the same stock', () => {
    const existing = { ...withStock, lowStockThreshold: { quantity: 5, unit: 'tabletka' } };

    const result = applyMedicationEdit(
      existing,
      fieldsLike({
        name: 'Inna',
        stockQuantity: 28,
        stockUnit: 'tabletka',
        lowStockThreshold: 5,
        lowStockThresholdUnit: 'tabletka',
      }),
      context(),
    );

    expect(result.ok && result.medication.lowStockThreshold).toBe(existing.lowStockThreshold);
    expect(result.ok && result.medication.stock).toEqual(existing.stock);
  });

  it('does not change the unit of a stored threshold when the stock unit changes: it is kept, and not applied', () => {
    const existing = { ...withStock, lowStockThreshold: { quantity: 5, unit: 'tabletka' } };

    const result = applyMedicationEdit(
      existing,
      fieldsLike({
        doseUnit: 'ml',
        stockQuantity: 100,
        stockUnit: 'ml',
        lowStockThreshold: 5,
        lowStockThresholdUnit: 'tabletka',
      }),
      context(),
    );

    if (!result.ok) throw new Error('should be allowed');
    expect(result.medication.lowStockThreshold).toEqual({ quantity: 5, unit: 'tabletka' });
    expect(result.medication.stock?.unit).toBe('ml');
    expect(thresholdUnitDiffers(result.medication)).toBe(true);
  });

  it('counts the threshold in the stock unit when the person asks for it (the stored unit is cleared)', () => {
    const existing = { ...withStock, lowStockThreshold: { quantity: 5, unit: 'tabletka' } };

    const result = applyMedicationEdit(
      existing,
      fieldsLike({
        doseUnit: 'ml',
        stockQuantity: 100,
        stockUnit: 'ml',
        lowStockThreshold: 5,
        lowStockThresholdUnit: null,
      }),
      context(),
    );

    expect(result.ok && result.medication.lowStockThreshold).toEqual({ quantity: 5, unit: 'ml' });
  });

  it('removes the threshold together with the stock', () => {
    const existing = { ...withStock, lowStockThreshold: { quantity: 5, unit: 'tabletka' } };

    const result = applyMedicationEdit(
      existing,
      fieldsLike({ stockQuantity: null, lowStockThreshold: 5 }),
      context(),
    );

    expect(result.ok && result.medication.stock).toBeNull();
    expect(result.ok && 'lowStockThreshold' in result.medication).toBe(false);
  });

  it('does not touch the schedule, the effective date or the intake rules', () => {
    const result = applyMedicationEdit(
      withStock,
      fieldsLike({ stockQuantity: 28, stockUnit: 'tabletka', lowStockThreshold: 3 }),
      context(),
    );

    expect(result.ok && result.medication.scheduleTimes).toEqual(withStock.scheduleTimes);
    expect(result.ok && result.medication.scheduleEffectiveFrom).toBe(
      withStock.scheduleEffectiveFrom,
    );
  });
});
