import { describe, expect, it } from 'vitest';
import type { MedicationFormValues } from './logic/medicationForm';
import { medicationFormMessages, medicationFormSchema } from './schemas';

function values(overrides: Partial<MedicationFormValues> = {}): MedicationFormValues {
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

function problems(input: unknown) {
  const result = medicationFormSchema.safeParse(input);
  if (result.success) return [];
  return result.error.issues.map((issue) => ({
    path: issue.path.join('.'),
    message: issue.message,
  }));
}

describe('medicationFormSchema', () => {
  it('accepts a valid form and returns the values unchanged', () => {
    const input = values({ endDate: '2026-12-31', stockQuantity: '12,5' });

    const result = medicationFormSchema.safeParse(input);

    expect(result.success).toBe(true);
    expect(result.data).toEqual(input);
  });

  it('puts the Polish message on the field that has the problem', () => {
    expect(problems(values({ name: '', startDate: '2026-02-30' }))).toEqual([
      { path: 'name', message: 'Wpisz nazwę leku.' },
      { path: 'startDate', message: 'Wybierz poprawną datę rozpoczęcia.' },
    ]);
  });

  it('addresses problems inside the schedule by row, in the notation React Hook Form uses', () => {
    expect(
      problems(
        values({
          scheduleTimes: [
            { scheduleTimeId: '', timeOfDay: '08:00', doseAmount: '1' },
            { scheduleTimeId: '', timeOfDay: '08:00', doseAmount: '0' },
          ],
        }),
      ),
    ).toEqual([
      { path: 'scheduleTimes.1.timeOfDay', message: medicationFormMessages['time-duplicate'] },
      { path: 'scheduleTimes.1.doseAmount', message: medicationFormMessages['amount-invalid'] },
    ]);
  });

  it('reports an empty schedule on the schedule itself', () => {
    expect(problems(values({ scheduleTimes: [] }))).toEqual([
      { path: 'scheduleTimes', message: 'Dodaj co najmniej jedną godzinę przyjmowania.' },
    ]);
  });

  it('rejects values that are not text at all, instead of coercing them', () => {
    expect(problems({ ...values(), name: 42 }).length).toBeGreaterThan(0);
    expect(problems({ ...values(), scheduleTimes: 'nope' }).length).toBeGreaterThan(0);
    expect(problems({}).length).toBeGreaterThan(0);
  });

  it('has a non-empty Polish message for every kind of problem, with the limits filled in', () => {
    for (const message of Object.values(medicationFormMessages)) {
      expect(message.length).toBeGreaterThan(10);
      expect(message).not.toContain('undefined');
    }
    expect(medicationFormMessages['name-too-long']).toContain('120');
    expect(medicationFormMessages['unit-too-long']).toContain('30');
    expect(medicationFormMessages['notes-too-long']).toContain('1000');
  });
});
