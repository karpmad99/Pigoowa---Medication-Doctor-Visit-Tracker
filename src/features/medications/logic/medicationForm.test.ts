import { describe, expect, it } from 'vitest';
import { asLocalDate, asTimestamp } from '@/utils/date';
import { makeMedication, scheduleTime } from '@/test/fixtures';
import {
  emptyMedicationForm,
  medicationToFormValues,
  readMedicationForm,
  validateMedicationForm,
  type MedicationFormValues,
} from './medicationForm';

const TODAY = asLocalDate('2026-10-15');

function valid(overrides: Partial<MedicationFormValues> = {}): MedicationFormValues {
  return {
    name: 'Lek A',
    dosageForm: '',
    doseUnit: 'tabletka',
    strengthValue: '',
    strengthUnit: '',
    notes: '',
    startDate: '2026-10-01',
    endDate: '',
    scheduleTimes: [{ scheduleTimeId: '', timeOfDay: '08:00', doseAmount: '1' }],
    stockQuantity: '',
    stockUnit: '',
    lowStockThreshold: '',
    lowStockThresholdUnit: '',
    ...overrides,
  };
}

const codesOf = (values: MedicationFormValues) =>
  validateMedicationForm(values).map((issue) => `${issue.path}:${issue.code}`);

describe('emptyMedicationForm', () => {
  it('starts today with one blank row, never pre-filling a time or a dose', () => {
    expect(emptyMedicationForm(TODAY)).toEqual({
      name: '',
      dosageForm: '',
      doseUnit: '',
      strengthValue: '',
      strengthUnit: '',
      notes: '',
      startDate: '2026-10-15',
      endDate: '',
      scheduleTimes: [{ scheduleTimeId: '', timeOfDay: '', doseAmount: '' }],
      stockQuantity: '',
      stockUnit: '',
      lowStockThreshold: '',
      lowStockThresholdUnit: '',
    });
  });

  it('is not valid until the user fills it in', () => {
    expect(codesOf(emptyMedicationForm(TODAY))).toEqual([
      'name:name-required',
      'doseUnit:unit-required',
      'scheduleTimes.0.timeOfDay:time-invalid',
      'scheduleTimes.0.doseAmount:amount-invalid',
    ]);
  });
});

describe('validateMedicationForm', () => {
  it('accepts a complete, valid form', () => {
    expect(validateMedicationForm(valid())).toEqual([]);
  });

  describe('name, unit and notes', () => {
    it.each(['', '   '])('requires a name (%j)', (name) => {
      expect(codesOf(valid({ name }))).toEqual(['name:name-required']);
    });

    it('limits the name to 120 characters, not counting surrounding spaces', () => {
      expect(codesOf(valid({ name: 'a'.repeat(120) }))).toEqual([]);
      expect(codesOf(valid({ name: `  ${'a'.repeat(120)}  ` }))).toEqual([]);
      expect(codesOf(valid({ name: 'a'.repeat(121) }))).toEqual(['name:name-too-long']);
    });

    it('requires a dose unit of at most 30 characters', () => {
      expect(codesOf(valid({ doseUnit: ' ' }))).toEqual(['doseUnit:unit-required']);
      expect(codesOf(valid({ doseUnit: 'u'.repeat(30) }))).toEqual([]);
      expect(codesOf(valid({ doseUnit: 'u'.repeat(31) }))).toEqual(['doseUnit:unit-too-long']);
    });

    it('limits notes to 1000 characters', () => {
      expect(codesOf(valid({ notes: 'n'.repeat(1000) }))).toEqual([]);
      expect(codesOf(valid({ notes: 'n'.repeat(1001) }))).toEqual(['notes:notes-too-long']);
    });
  });

  describe('dates', () => {
    it.each([
      ['empty', ''],
      ['impossible', '2026-02-30'],
      ['a non-leap 29 February', '2026-02-29'],
      ['in the wrong format', '15.10.2026'],
      ['with a time', '2026-10-15T08:00'],
    ])('rejects a start date that is %s', (_label, startDate) => {
      expect(codesOf(valid({ startDate }))).toEqual(['startDate:start-invalid']);
    });

    it('accepts 29 February in a leap year', () => {
      expect(codesOf(valid({ startDate: '2028-02-29' }))).toEqual([]);
    });

    it('treats the end date as optional but strict when given', () => {
      expect(codesOf(valid({ endDate: '' }))).toEqual([]);
      expect(codesOf(valid({ endDate: '2026-13-01' }))).toEqual(['endDate:end-invalid']);
      expect(codesOf(valid({ endDate: 'abc' }))).toEqual(['endDate:end-invalid']);
    });

    it('rejects an end date before the start date but accepts the same day', () => {
      expect(codesOf(valid({ startDate: '2026-10-10', endDate: '2026-10-09' }))).toEqual([
        'endDate:end-before-start',
      ]);
      expect(codesOf(valid({ startDate: '2026-10-10', endDate: '2026-10-10' }))).toEqual([]);
    });

    it('does not report the end date as "before the start" when the start itself is invalid', () => {
      expect(codesOf(valid({ startDate: '', endDate: '2026-10-09' }))).toEqual([
        'startDate:start-invalid',
      ]);
    });
  });

  describe('schedule', () => {
    it('requires at least one time', () => {
      expect(codesOf(valid({ scheduleTimes: [] }))).toEqual(['scheduleTimes:schedule-empty']);
    });

    it.each([
      ['empty', ''],
      ['hour 24', '24:00'],
      ['minute 60', '08:60'],
      ['without a leading zero', '8:00'],
      ['with seconds', '08:00:30'],
    ])('rejects a time that is %s', (_label, timeOfDay) => {
      expect(
        codesOf(valid({ scheduleTimes: [{ scheduleTimeId: '', timeOfDay, doseAmount: '1' }] })),
      ).toEqual(['scheduleTimes.0.timeOfDay:time-invalid']);
    });

    it.each([
      ['empty', ''],
      ['zero', '0'],
      ['negative', '-1'],
      ['text', 'dwie'],
      ['with text after it', '2 tabletki'],
      ['with four decimals', '1,2345'],
      ['in exponent notation', '1e3'],
    ])('rejects a dose amount that is %s', (_label, doseAmount) => {
      expect(
        codesOf(valid({ scheduleTimes: [{ scheduleTimeId: '', timeOfDay: '08:00', doseAmount }] })),
      ).toEqual(['scheduleTimes.0.doseAmount:amount-invalid']);
    });

    it.each(['1', '0,5', '0.5', '2,25', '0,001'])('accepts the dose amount %j', (doseAmount) => {
      expect(
        codesOf(valid({ scheduleTimes: [{ scheduleTimeId: '', timeOfDay: '08:00', doseAmount }] })),
      ).toEqual([]);
    });

    it('rejects the same time twice, pointing at the repeated row', () => {
      expect(
        codesOf(
          valid({
            scheduleTimes: [
              { scheduleTimeId: '', timeOfDay: '08:00', doseAmount: '1' },
              { scheduleTimeId: '', timeOfDay: '20:00', doseAmount: '1' },
              { scheduleTimeId: '', timeOfDay: '08:00', doseAmount: '2' },
            ],
          }),
        ),
      ).toEqual(['scheduleTimes.2.timeOfDay:time-duplicate']);
    });

    it('reports problems of several rows independently', () => {
      expect(
        codesOf(
          valid({
            scheduleTimes: [
              { scheduleTimeId: '', timeOfDay: '', doseAmount: '1' },
              { scheduleTimeId: '', timeOfDay: '20:00', doseAmount: '0' },
            ],
          }),
        ),
      ).toEqual([
        'scheduleTimes.0.timeOfDay:time-invalid',
        'scheduleTimes.1.doseAmount:amount-invalid',
      ]);
    });
  });

  describe('stock', () => {
    it('is optional, and zero ("none left") is valid', () => {
      expect(codesOf(valid({ stockQuantity: '' }))).toEqual([]);
      expect(codesOf(valid({ stockQuantity: '   ' }))).toEqual([]);
      expect(codesOf(valid({ stockQuantity: '0' }))).toEqual([]);
      expect(codesOf(valid({ stockQuantity: '28' }))).toEqual([]);
      expect(codesOf(valid({ stockQuantity: '12,5' }))).toEqual([]);
    });

    it.each(['-1', 'abc', '1,2345', '1e2', '1 000', '1,'])(
      'rejects the stock %j',
      (stockQuantity) => {
        expect(codesOf(valid({ stockQuantity }))).toEqual(['stockQuantity:stock-invalid']);
      },
    );
  });
});

describe('readMedicationForm', () => {
  it('returns typed, trimmed values for a valid form', () => {
    const fields = readMedicationForm(
      valid({
        name: '  Lek A ',
        doseUnit: ' tabletka ',
        notes: '  Po jedzeniu  ',
        endDate: '2026-12-31',
        scheduleTimes: [{ scheduleTimeId: 't-1', timeOfDay: '08:00', doseAmount: '0,5' }],
        stockQuantity: '12,5',
      }),
    );

    expect(fields).toEqual({
      name: 'Lek A',
      dosageForm: null,
      doseUnit: 'tabletka',
      doseUnitAsEntered: ' tabletka ',
      strength: null,
      notes: 'Po jedzeniu',
      startDate: '2026-10-01',
      endDate: '2026-12-31',
      scheduleTimes: [{ scheduleTimeId: 't-1', timeOfDay: '08:00', doseAmount: 0.5 }],
      stockQuantity: 12.5,
      stockUnit: null,
      lowStockThreshold: null,
      lowStockThresholdUnit: null,
    });
  });

  it('turns blank optional text into null', () => {
    const fields = readMedicationForm(valid({ notes: '   ', endDate: '', stockQuantity: '' }));

    expect(fields).toMatchObject({ notes: null, endDate: null, stockQuantity: null });
  });

  it('keeps a stock of zero as 0, not as "no stock"', () => {
    expect(readMedicationForm(valid({ stockQuantity: '0' }))?.stockQuantity).toBe(0);
  });

  it('returns null for an invalid form rather than a half-parsed result', () => {
    expect(readMedicationForm(valid({ name: '' }))).toBeNull();
    expect(readMedicationForm(valid({ startDate: '2026-02-30' }))).toBeNull();
    expect(
      readMedicationForm(
        valid({ scheduleTimes: [{ scheduleTimeId: '', timeOfDay: '08:00', doseAmount: 'x' }] }),
      ),
    ).toBeNull();
  });
});

describe('medicationToFormValues', () => {
  const medication = makeMedication({
    name: 'Lek A',
    notes: 'Notatka',
    endDate: asLocalDate('2026-12-31'),
    scheduleTimes: [scheduleTime('t-2', '20:00', 0.5), scheduleTime('t-1', '08:00', 1)],
    stock: { quantity: 12.5, unit: 'tabletka', asOf: asTimestamp('2026-10-01T08:00:00Z') },
  });

  it('shows the stored values as text, rows in time order, with the Polish decimal comma', () => {
    expect(medicationToFormValues(medication)).toEqual({
      name: 'Lek A',
      dosageForm: '',
      doseUnit: 'tabletka',
      strengthValue: '',
      strengthUnit: '',
      notes: 'Notatka',
      startDate: '2026-01-01',
      endDate: '2026-12-31',
      scheduleTimes: [
        { scheduleTimeId: 't-1', timeOfDay: '08:00', doseAmount: '1' },
        { scheduleTimeId: 't-2', timeOfDay: '20:00', doseAmount: '0,5' },
      ],
      stockQuantity: '12,5',
      stockUnit: 'tabletka',
      lowStockThreshold: '',
      lowStockThresholdUnit: '',
    });
  });

  it('shows missing optional values as empty text', () => {
    const plain = makeMedication({ notes: null, endDate: null, stock: null });

    expect(medicationToFormValues(plain)).toMatchObject({
      notes: '',
      endDate: '',
      stockQuantity: '',
    });
  });

  it('produces a form that is valid and reads back to the same values', () => {
    const values = medicationToFormValues(medication);

    expect(validateMedicationForm(values)).toEqual([]);
    expect(readMedicationForm(values)).toMatchObject({
      name: 'Lek A',
      stockQuantity: 12.5,
      scheduleTimes: [
        { scheduleTimeId: 't-1', timeOfDay: '08:00', doseAmount: 1 },
        { scheduleTimeId: 't-2', timeOfDay: '20:00', doseAmount: 0.5 },
      ],
    });
  });

  it('writes a large amount without a thousands separator, so it reads back', () => {
    const big = makeMedication({ scheduleTimes: [scheduleTime('t-1', '08:00', 12000)] });

    const values = medicationToFormValues(big);

    expect(values.scheduleTimes[0]?.doseAmount).toBe('12000');
    expect(validateMedicationForm(values)).toEqual([]);
  });
});

describe('the dosage form, the strength and the stock unit in the form', () => {
  it.each([
    '',
    'tablet',
    'capsule',
    'liquid',
    'drops',
    'injection',
    'sachet',
    'patch',
    'suppository',
    'inhaler',
    'other',
  ])('accepts the dosage form "%s"', (dosageForm) => {
    expect(codesOf(valid({ dosageForm }))).toEqual([]);
  });

  it.each(['powder', 'Tablet', ' tablet'])('refuses the unknown dosage form "%s"', (dosageForm) => {
    expect(codesOf(valid({ dosageForm }))).toEqual(['dosageForm:dosage-form-invalid']);
  });

  it('treats the strength as optional: both parts empty is valid and gives none', () => {
    expect(codesOf(valid())).toEqual([]);
    expect(readMedicationForm(valid())?.strength).toBeNull();
  });

  it('reads a strength with the Polish decimal comma', () => {
    const values = valid({ strengthValue: '0,5', strengthUnit: 'g' });

    expect(codesOf(values)).toEqual([]);
    expect(readMedicationForm(values)?.strength).toEqual({ value: 0.5, unit: 'g' });
  });

  it.each(['mg', 'mcg', 'g', 'IU', 'mg/ml', 'mcg/ml', '%'])(
    'accepts the strength unit "%s"',
    (unit) => {
      expect(codesOf(valid({ strengthValue: '5', strengthUnit: unit }))).toEqual([]);
    },
  );

  it('requires both parts: a number without a unit, and a unit without a number', () => {
    expect(codesOf(valid({ strengthValue: '500' }))).toEqual([
      'strengthUnit:strength-unit-required',
    ]);
    expect(codesOf(valid({ strengthUnit: 'mg' }))).toEqual([
      'strengthValue:strength-value-required',
    ]);
    expect(readMedicationForm(valid({ strengthValue: '500' }))).toBeNull();
  });

  it.each(['0', '0,0', '-1', 'abc', '1e3', '1,2345', '10000000', '1 000'])(
    'refuses the strength number "%s"',
    (strengthValue) => {
      expect(codesOf(valid({ strengthValue, strengthUnit: 'mg' }))).toEqual([
        'strengthValue:strength-value-invalid',
      ]);
    },
  );

  it('refuses a strength unit that is not on the list, including a dose unit', () => {
    expect(codesOf(valid({ strengthValue: '5', strengthUnit: 'tabletka' }))).toEqual([
      'strengthUnit:strength-unit-invalid',
    ]);
    expect(codesOf(valid({ strengthValue: '5', strengthUnit: 'ml' }))).toEqual([
      'strengthUnit:strength-unit-invalid',
    ]);
  });

  it('reads an untouched stock unit as typed, and an empty one as "the dose unit"', () => {
    expect(readMedicationForm(valid({ stockUnit: '' }))?.stockUnit).toBeNull();
    expect(readMedicationForm(valid({ stockUnit: '  ' }))?.stockUnit).toBeNull();
    expect(readMedicationForm(valid({ stockUnit: 'Tabletka ' }))?.stockUnit).toBe('Tabletka ');
  });

  it('refuses a stock unit longer than a unit may be', () => {
    expect(codesOf(valid({ stockUnit: 'x'.repeat(31) }))).toEqual([
      'stockUnit:stock-unit-too-long',
    ]);
    expect(codesOf(valid({ stockUnit: 'x'.repeat(30) }))).toEqual([]);
  });

  it('keeps the dose unit as entered next to the trimmed one', () => {
    const fields = readMedicationForm(valid({ doseUnit: ' Tabletka ' }));

    expect(fields).toMatchObject({ doseUnit: 'Tabletka', doseUnitAsEntered: ' Tabletka ' });
  });

  it('shows a stored form, strength and units as form text, and reads them back the same', () => {
    const medication = makeMedication({
      dosageForm: 'liquid',
      strength: { value: 2.5, unit: 'mg/ml' },
      doseUnit: 'ml',
      stock: { quantity: 120, unit: 'ml', asOf: asTimestamp('2026-09-01T08:00:00Z') },
    });

    const values = medicationToFormValues(medication);

    expect(values).toMatchObject({
      dosageForm: 'liquid',
      strengthValue: '2,5',
      strengthUnit: 'mg/ml',
      doseUnit: 'ml',
      stockQuantity: '120',
      stockUnit: 'ml',
    });
    expect(validateMedicationForm(values)).toEqual([]);
    expect(readMedicationForm(values)).toMatchObject({
      dosageForm: 'liquid',
      strength: { value: 2.5, unit: 'mg/ml' },
      stockUnit: 'ml',
    });
  });

  it('shows an older medication with an empty form and strength: nothing is assigned to it', () => {
    const values = medicationToFormValues(makeMedication());

    expect(values).toMatchObject({ dosageForm: '', strengthValue: '', strengthUnit: '' });
    expect(readMedicationForm(values)).toMatchObject({ dosageForm: null, strength: null });
  });

  it('shows a stored unit exactly as it is stored, without trimming', () => {
    const values = medicationToFormValues(
      makeMedication({
        doseUnit: 'Tabletka ',
        stock: { quantity: 1, unit: ' Opakowanie', asOf: asTimestamp('2026-09-01T08:00:00Z') },
      }),
    );

    expect(values.doseUnit).toBe('Tabletka ');
    expect(values.stockUnit).toBe(' Opakowanie');
  });
});

describe('the own low-stock threshold in the form', () => {
  const withStock = (overrides: Partial<MedicationFormValues> = {}) =>
    valid({ stockQuantity: '28', ...overrides });

  it('is optional: empty is valid and gives none', () => {
    expect(codesOf(withStock())).toEqual([]);
    expect(readMedicationForm(withStock())).toMatchObject({
      lowStockThreshold: null,
      lowStockThresholdUnit: null,
    });
  });

  it.each([
    ['5', 5],
    ['0', 0],
    ['0,5', 0.5],
    ['12.25', 12.25],
    [' 7 ', 7],
    ['9999999,999', 9_999_999.999],
  ])('reads the threshold "%s" as %s (zero is allowed)', (text, number) => {
    const values = withStock({ lowStockThreshold: text });

    expect(codesOf(values)).toEqual([]);
    expect(readMedicationForm(values)?.lowStockThreshold).toBe(number);
  });

  it.each(['-1', 'abc', '1e3', '1,2345', '10000000', '1 000', ',5'])(
    'refuses the threshold "%s"',
    (text) => {
      expect(codesOf(withStock({ lowStockThreshold: text }))).toEqual([
        'lowStockThreshold:threshold-invalid',
      ]);
      expect(readMedicationForm(withStock({ lowStockThreshold: text }))).toBeNull();
    },
  );

  it('needs a stock to be about: with no stock quantity it is refused', () => {
    expect(codesOf(valid({ lowStockThreshold: '5' }))).toEqual([
      'lowStockThreshold:threshold-needs-stock',
    ]);
    expect(codesOf(valid({ lowStockThreshold: '5', stockQuantity: '0' }))).toEqual([]);
  });

  it('keeps the unit of a stored threshold, empty meaning "the stock unit"', () => {
    expect(
      readMedicationForm(withStock({ lowStockThreshold: '5', lowStockThresholdUnit: 'ml' }))
        ?.lowStockThresholdUnit,
    ).toBe('ml');
    expect(
      readMedicationForm(withStock({ lowStockThreshold: '5', lowStockThresholdUnit: '' }))
        ?.lowStockThresholdUnit,
    ).toBeNull();
  });

  it('shows a stored threshold as text with its unit, and reads it back the same', () => {
    const medication = makeMedication({
      stock: { quantity: 28, unit: 'tabletka', asOf: asTimestamp('2026-09-01T08:00:00Z') },
      lowStockThreshold: { quantity: 4.5, unit: 'tabletka' },
    });

    const values = medicationToFormValues(medication);

    expect(values).toMatchObject({ lowStockThreshold: '4,5', lowStockThresholdUnit: 'tabletka' });
    expect(validateMedicationForm(values)).toEqual([]);
    expect(readMedicationForm(values)).toMatchObject({
      lowStockThreshold: 4.5,
      lowStockThresholdUnit: 'tabletka',
    });
  });

  it('shows an older medication with no threshold as empty, and a null one the same', () => {
    expect(medicationToFormValues(makeMedication())).toMatchObject({
      lowStockThreshold: '',
      lowStockThresholdUnit: '',
    });
    expect(medicationToFormValues(makeMedication({ lowStockThreshold: null }))).toMatchObject({
      lowStockThreshold: '',
      lowStockThresholdUnit: '',
    });
  });
});
