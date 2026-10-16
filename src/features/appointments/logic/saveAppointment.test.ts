import { describe, expect, it } from 'vitest';
import { assertOk, makeAppointment } from '@/test/fixtures';
import { asTimestamp } from '@/utils/date';
import { emptyAppointmentForm, type AppointmentFormValues } from './appointmentForm';
import { applyAppointmentEdit, createAppointmentFromForm } from './saveAppointment';

const WARSAW = 'Europe/Warsaw';
const NOW = asTimestamp('2026-10-15T10:00:00Z');
const context = { now: NOW, timeZone: WARSAW };

const valid = (overrides: Partial<AppointmentFormValues> = {}): AppointmentFormValues => ({
  ...emptyAppointmentForm(),
  doctorName: 'dr Nowak',
  date: '2026-10-20',
  time: '10:00',
  ...overrides,
});

describe('createAppointmentFromForm', () => {
  it('creates a scheduled appointment with the given id, the instant of the typed date and time, and trimmed text', () => {
    const result = createAppointmentFromForm(
      valid({
        doctorName: '  dr Nowak ',
        specialty: ' Kardiolog',
        location: '',
        notes: ' Wyniki ',
      }),
      { ...context, id: 'a-1' },
    );

    assertOk(result);
    expect(result.appointment).toEqual({
      id: 'a-1',
      doctorName: 'dr Nowak',
      specialty: 'Kardiolog',
      scheduledAt: '2026-10-20T08:00:00.000Z', // 10:00 in Warsaw, summer time
      location: null,
      notes: 'Wyniki',
      status: 'scheduled',
      createdAt: NOW,
      updatedAt: NOW,
    });
  });

  it('never creates an appointment that is already completed or cancelled', () => {
    const result = createAppointmentFromForm(valid({ date: '2020-01-01' }), {
      ...context,
      id: 'a',
    });

    assertOk(result);
    expect(result.appointment.status).toBe('scheduled');
  });

  it('returns the validation problems and creates nothing for an invalid form', () => {
    const result = createAppointmentFromForm(emptyAppointmentForm(), { ...context, id: 'a-1' });

    expect(result.ok).toBe(false);
    const issues = result.ok ? [] : result.issues;
    expect(issues).toContainEqual({
      field: 'doctorOrSpecialty',
      code: 'doctor-or-specialty-required',
    });
    expect(issues).toContainEqual({ field: 'date', code: 'invalid-date' });
    expect(issues).toContainEqual({ field: 'time', code: 'invalid-time' });
  });
});

describe('applyAppointmentEdit', () => {
  const existing = makeAppointment({
    id: 'a-1',
    doctorName: 'dr Nowak',
    specialty: 'Kardiolog',
    scheduledAt: asTimestamp('2026-10-20T08:00:00.000Z'),
    location: 'Gabinet 1',
    notes: null,
    status: 'completed',
    createdAt: asTimestamp('2026-10-01T08:00:00Z'),
    updatedAt: asTimestamp('2026-10-02T08:00:00Z'),
  });
  const same = valid({ specialty: 'Kardiolog', location: 'Gabinet 1' });

  it('keeps the id, the status and the creation time, and sets only the edited fields and updatedAt', () => {
    const result = applyAppointmentEdit(
      existing,
      { ...same, location: 'Gabinet 2', notes: 'Nowa' },
      context,
    );

    assertOk(result);
    expect(result.changed).toBe(true);
    expect(result.appointment).toEqual({
      ...existing,
      location: 'Gabinet 2',
      notes: 'Nowa',
      updatedAt: NOW,
    });
    expect(result.appointment.status).toBe('completed');
  });

  it('changes the instant when the date or time changes', () => {
    const result = applyAppointmentEdit(
      existing,
      { ...same, date: '2026-10-21', time: '09:15' },
      context,
    );

    assertOk(result);
    expect(result.appointment.scheduledAt).toBe('2026-10-21T07:15:00.000Z');
  });

  it('reports no change, and returns the same object, when nothing differs', () => {
    const result = applyAppointmentEdit(existing, same, context);

    assertOk(result);
    expect(result.changed).toBe(false);
    expect(result.appointment).toBe(existing);
  });

  it('treats text that only differs by surrounding spaces as unchanged', () => {
    const result = applyAppointmentEdit(existing, { ...same, doctorName: '  dr Nowak  ' }, context);

    assertOk(result);
    expect(result.changed).toBe(false);
  });

  it('keeps the exact instant when the typed date and time are the ones it already has (second 02:30 of the night clocks go back)', () => {
    // 2026-10-25 02:30 happens twice in Warsaw. The appointment is at the LATER one (01:30 UTC).
    const later = makeAppointment({
      id: 'a-2',
      scheduledAt: asTimestamp('2026-10-25T01:30:00.000Z'),
      location: null,
    });

    const result = applyAppointmentEdit(
      later,
      valid({
        doctorName: later.doctorName ?? '',
        date: '2026-10-25',
        time: '02:30',
        location: 'Nowe miejsce',
      }),
      context,
    );

    assertOk(result);
    expect(result.appointment.location).toBe('Nowe miejsce');
    expect(result.appointment.scheduledAt).toBe('2026-10-25T01:30:00.000Z'); // not moved to 00:30Z
  });

  it('returns the validation problems and changes nothing for an invalid form', () => {
    const result = applyAppointmentEdit(
      existing,
      { ...same, doctorName: '', specialty: '' },
      context,
    );

    expect(result).toEqual({
      ok: false,
      issues: [{ field: 'doctorOrSpecialty', code: 'doctor-or-specialty-required' }],
    });
  });

  it('does not modify the original appointment', () => {
    const snapshot = structuredClone(existing);
    applyAppointmentEdit(existing, { ...same, notes: 'x' }, context);
    expect(existing).toEqual(snapshot);
  });
});
