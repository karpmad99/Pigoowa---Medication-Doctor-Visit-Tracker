import { describe, expect, it } from 'vitest';
import { makeAppointment } from '@/test/fixtures';
import { asTimestamp } from '@/utils/date';
import {
  appointmentTitle,
  appointmentToFormValues,
  emptyAppointmentForm,
  isAmbiguousLocalTime,
} from './appointmentForm';

const WARSAW = 'Europe/Warsaw';

describe('emptyAppointmentForm', () => {
  it('is empty: no date, time or doctor is ever pre-filled', () => {
    expect(emptyAppointmentForm()).toEqual({
      doctorName: '',
      specialty: '',
      date: '',
      time: '',
      location: '',
      notes: '',
    });
  });
});

describe('appointmentToFormValues', () => {
  it('shows missing optional values as empty text', () => {
    const values = appointmentToFormValues(
      makeAppointment({ doctorName: null, specialty: 'Okulista', location: null, notes: null }),
      WARSAW,
    );

    expect(values).toMatchObject({
      doctorName: '',
      specialty: 'Okulista',
      location: '',
      notes: '',
    });
  });

  it('shows the date and time as the wall clock in the zone shows them, not in UTC', () => {
    // 22:30 UTC on the 15th is 00:30 on the 16th in Warsaw (summer time, UTC+2).
    const appointment = makeAppointment({ scheduledAt: asTimestamp('2026-07-15T22:30:00Z') });

    expect(appointmentToFormValues(appointment, WARSAW)).toMatchObject({
      date: '2026-07-16',
      time: '00:30',
    });
    expect(appointmentToFormValues(appointment, 'UTC')).toMatchObject({
      date: '2026-07-15',
      time: '22:30',
    });
  });
});

describe('isAmbiguousLocalTime', () => {
  it('is true for a time that happens twice when the clocks go back', () => {
    expect(isAmbiguousLocalTime('2026-10-25', '02:30', WARSAW)).toBe(true);
  });

  it('is false for an ordinary time, a time that does not exist, and unusable input', () => {
    expect(isAmbiguousLocalTime('2026-10-15', '10:00', WARSAW)).toBe(false);
    expect(isAmbiguousLocalTime('2026-03-29', '02:30', WARSAW)).toBe(false); // skipped, not repeated
    expect(isAmbiguousLocalTime('', '10:00', WARSAW)).toBe(false);
    expect(isAmbiguousLocalTime('2026-10-25', '', WARSAW)).toBe(false);
    expect(isAmbiguousLocalTime('2026-02-30', '02:30', WARSAW)).toBe(false);
  });
});

describe('appointmentTitle', () => {
  it('names the appointment by its doctor, else its specialty', () => {
    expect(
      appointmentTitle(makeAppointment({ doctorName: 'dr Nowak', specialty: 'Kardiolog' })),
    ).toBe('dr Nowak');
    expect(appointmentTitle(makeAppointment({ doctorName: null, specialty: 'Kardiolog' }))).toBe(
      'Kardiolog',
    );
  });
});
