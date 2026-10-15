import { describe, expect, it } from 'vitest';
import { assertOk } from '@/test/fixtures';
import { APPOINTMENT_LIMITS, validateAppointmentDraft, type AppointmentDraft } from './validation';

const WARSAW = 'Europe/Warsaw';

function draft(overrides: Partial<AppointmentDraft> = {}): AppointmentDraft {
  return {
    doctorName: 'dr Anna Nowak',
    specialty: 'Kardiolog',
    date: '2026-10-20',
    time: '09:30',
    location: 'Przychodnia, ul. Długa 5',
    notes: 'Zabrać wyniki badań',
    ...overrides,
  };
}

describe('validateAppointmentDraft', () => {
  it("accepts a complete draft and converts date and time into an instant in the user's zone", () => {
    const result = validateAppointmentDraft(draft(), WARSAW);

    assertOk(result);
    expect(result.value).toEqual({
      doctorName: 'dr Anna Nowak',
      specialty: 'Kardiolog',
      // 09:30 in Warsaw on 20 October is UTC+2 -> 07:30Z.
      scheduledAt: '2026-10-20T07:30:00.000Z',
      location: 'Przychodnia, ul. Długa 5',
      notes: 'Zabrać wyniki badań',
      ambiguousTime: false,
    });
  });

  it('accepts only a doctor, or only a specialty, and turns blank optional text into null', () => {
    const onlyDoctor = validateAppointmentDraft(
      draft({ specialty: '  ', location: '', notes: '\n' }),
      WARSAW,
    );
    const onlySpecialty = validateAppointmentDraft(draft({ doctorName: '' }), WARSAW);

    assertOk(onlyDoctor);
    expect(onlyDoctor.value).toMatchObject({
      doctorName: 'dr Anna Nowak',
      specialty: null,
      location: null,
      notes: null,
    });
    assertOk(onlySpecialty);
    expect(onlySpecialty.value).toMatchObject({ doctorName: null, specialty: 'Kardiolog' });
  });

  it('trims surrounding whitespace', () => {
    const result = validateAppointmentDraft(draft({ doctorName: '  dr Nowak  ' }), WARSAW);

    assertOk(result);
    expect(result.value.doctorName).toBe('dr Nowak');
  });

  it('requires a doctor or a specialty', () => {
    const result = validateAppointmentDraft(draft({ doctorName: ' ', specialty: '' }), WARSAW);

    expect(result).toEqual({
      ok: false,
      issues: [{ field: 'doctorOrSpecialty', code: 'doctor-or-specialty-required' }],
    });
  });

  it.each([
    ['impossible day', '2026-02-30'],
    ['29 February in a non-leap year', '2026-02-29'],
    ['month 13', '2026-13-01'],
    ['wrong format', '20.10.2026'],
    ['empty', ''],
  ])('rejects an invalid date: %s', (_label, date) => {
    expect(validateAppointmentDraft(draft({ date }), WARSAW)).toEqual({
      ok: false,
      issues: [{ field: 'date', code: 'invalid-date' }],
    });
  });

  it.each([
    ['hour 24', '24:00'],
    ['minute 60', '10:60'],
    ['no leading zero', '9:30'],
    ['empty', ''],
  ])('rejects an invalid time: %s', (_label, time) => {
    expect(validateAppointmentDraft(draft({ time }), WARSAW)).toEqual({
      ok: false,
      issues: [{ field: 'time', code: 'invalid-time' }],
    });
  });

  it('accepts 29 February in a leap year', () => {
    const result = validateAppointmentDraft(draft({ date: '2028-02-29' }), WARSAW);

    assertOk(result);
    expect(result.value.scheduledAt).toBe('2028-02-29T08:30:00.000Z');
  });

  it('rejects a time skipped by the spring clock change instead of shifting it', () => {
    const result = validateAppointmentDraft(draft({ date: '2026-03-29', time: '02:30' }), WARSAW);

    expect(result).toEqual({
      ok: false,
      issues: [{ field: 'time', code: 'nonexistent-time' }],
    });
  });

  it('accepts a time repeated by the autumn clock change, using the earlier one, and says so', () => {
    const result = validateAppointmentDraft(draft({ date: '2026-10-25', time: '02:30' }), WARSAW);

    assertOk(result);
    expect(result.value.scheduledAt).toBe('2026-10-25T00:30:00.000Z');
    expect(result.value.ambiguousTime).toBe(true);
  });

  it('enforces the length limits of the database columns, accepting text exactly at the limit', () => {
    const atLimit = validateAppointmentDraft(
      draft({ notes: 'n'.repeat(APPOINTMENT_LIMITS.notes) }),
      WARSAW,
    );
    const tooLong = validateAppointmentDraft(
      draft({
        doctorName: 'd'.repeat(APPOINTMENT_LIMITS.doctorName + 1),
        location: 'l'.repeat(APPOINTMENT_LIMITS.location + 1),
      }),
      WARSAW,
    );

    expect(atLimit.ok).toBe(true);
    expect(tooLong).toEqual({
      ok: false,
      issues: [
        { field: 'doctorName', code: 'too-long' },
        { field: 'location', code: 'too-long' },
      ],
    });
  });

  it('reports all problems at once', () => {
    const result = validateAppointmentDraft(
      draft({ doctorName: '', specialty: '', date: 'x', time: 'y' }),
      WARSAW,
    );

    expect(result).toEqual({
      ok: false,
      issues: [
        { field: 'doctorOrSpecialty', code: 'doctor-or-specialty-required' },
        { field: 'date', code: 'invalid-date' },
        { field: 'time', code: 'invalid-time' },
      ],
    });
  });
});
