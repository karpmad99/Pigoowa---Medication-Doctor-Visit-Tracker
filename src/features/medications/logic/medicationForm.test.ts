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
    doseUnit: 'tabletka',
    notes: '',
    startDate: '2026-10-01',
    endDate: '',
    scheduleTimes: [{ scheduleTimeId: '', timeOfDay: '08:00', doseAmount: '1' }],
    stockQuantity: '',
    ...overrides,
  };
}

const codesOf = (values: MedicationFormValues) =>
  validateMedicationForm(values).map((issue) => `${issue.path}:${issue.code}`);

describe('emptyMedicationForm', () => {
  it('starts today with one blank row, never pre-filling a time or a dose', () => {
    expect(emptyMedicationForm(TODAY)).toEqual({
      name: '',
      doseUnit: '',
      notes: '',
      startDate: '2026-10-15',
      endDate: '',
      scheduleTimes: [{ scheduleTimeId: '', timeOfDay: '', doseAmount: '' }],
      stockQuantity: '',
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
      doseUnit: 'tabletka',
      notes: 'Po jedzeniu',
      startDate: '2026-10-01',
      endDate: '2026-12-31',
      scheduleTimes: [{ scheduleTimeId: 't-1', timeOfDay: '08:00', doseAmount: 0.5 }],
      stockQuantity: 12.5,
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
      doseUnit: 'tabletka',
      notes: 'Notatka',
      startDate: '2026-01-01',
      endDate: '2026-12-31',
      scheduleTimes: [
        { scheduleTimeId: 't-1', timeOfDay: '08:00', doseAmount: '1' },
        { scheduleTimeId: 't-2', timeOfDay: '20:00', doseAmount: '0,5' },
      ],
      stockQuantity: '12,5',
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
