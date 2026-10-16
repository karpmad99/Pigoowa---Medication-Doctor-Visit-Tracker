import type { LocalDate, LocalTime } from '@/types/primitives';
import { parseLocalDate, parseLocalTime } from '@/utils/date';
import { getLocalDateInZone, getLocalTimeInZone, localDateTimeToTimestamp } from '@/utils/timeZone';
import type { Appointment } from '../types';
import type { AppointmentDraft } from './validation';

// The appointment form works with TEXT, exactly as typed: it is the Stage 2 `AppointmentDraft`.
// The rules (required fields, limits, real dates, daylight-saving handling) live in
// `validateAppointmentDraft`; the Polish messages are attached in ../schemas.ts.

export type AppointmentFormValues = AppointmentDraft;

/** A new, empty form. No date or time is pre-filled: the user chooses them. */
export function emptyAppointmentForm(): AppointmentFormValues {
  return { doctorName: '', specialty: '', date: '', time: '', location: '', notes: '' };
}

/** The form values for an existing appointment, with its date and time as the wall clock in `timeZone` shows them. */
export function appointmentToFormValues(
  appointment: Appointment,
  timeZone: string,
): AppointmentFormValues {
  return {
    doctorName: appointment.doctorName ?? '',
    specialty: appointment.specialty ?? '',
    date: getLocalDateInZone(appointment.scheduledAt, timeZone),
    time: getLocalTimeInZone(appointment.scheduledAt, timeZone),
    location: appointment.location ?? '',
    notes: appointment.notes ?? '',
  };
}

/**
 * True when the date and time exist twice in `timeZone` (the night clocks go back). The earlier
 * occurrence is then used (Stage 2 rule); the form says so instead of choosing silently.
 * False for anything that is not a valid date and time.
 */
export function isAmbiguousLocalTime(date: string, time: string, timeZone: string): boolean {
  const day: LocalDate | null = parseLocalDate(date);
  const clock: LocalTime | null = parseLocalTime(time);
  if (day === null || clock === null) return false;
  const conversion = localDateTimeToTimestamp(day, clock, timeZone);
  return conversion.ok && conversion.ambiguous;
}

/** What to call an appointment in a list or a sentence: the doctor, else the specialty. */
export function appointmentTitle(appointment: Appointment): string {
  return appointment.doctorName ?? appointment.specialty ?? 'Wizyta';
}
