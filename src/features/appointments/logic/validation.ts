import type { Timestamp } from '@/types/primitives';
import { parseLocalDate, parseLocalTime } from '@/utils/date';
import { localDateTimeToTimestamp } from '@/utils/timeZone';

/** Matches the database column limits (see docs/DATABASE.md). */
export const APPOINTMENT_LIMITS = {
  doctorName: 120,
  specialty: 120,
  location: 200,
  notes: 1000,
} as const;

/** Raw values as typed into a form: all strings, nothing trusted yet. */
export interface AppointmentDraft {
  doctorName: string;
  specialty: string;
  /** `YYYY-MM-DD`, in the user's time zone. */
  date: string;
  /** `HH:mm`, in the user's time zone. */
  time: string;
  location: string;
  notes: string;
}

export type AppointmentField =
  'doctorOrSpecialty' | 'doctorName' | 'specialty' | 'date' | 'time' | 'location' | 'notes';

export type AppointmentIssueCode =
  /** Neither a doctor nor a specialty was given. */
  | 'doctor-or-specialty-required'
  | 'too-long'
  | 'invalid-date'
  | 'invalid-time'
  /** The wall-clock time does not exist on that day because clocks jump forward. */
  | 'nonexistent-time';

export interface AppointmentIssue {
  field: AppointmentField;
  code: AppointmentIssueCode;
}

export interface ValidAppointmentFields {
  doctorName: string | null;
  specialty: string | null;
  scheduledAt: Timestamp;
  location: string | null;
  notes: string | null;
  /** The chosen time occurs twice that day (clocks go back); the earlier occurrence was used. */
  ambiguousTime: boolean;
}

export type AppointmentValidation =
  { ok: true; value: ValidAppointmentFields } | { ok: false; issues: AppointmentIssue[] };

/**
 * Validates and cleans an appointment form. Text is trimmed and empty text becomes `null`;
 * a doctor or a specialty is required; the date must be a real calendar date and the time a
 * valid `HH:mm`; the date and time together are converted to an instant in `timeZone`.
 * Impossible values are rejected, never silently corrected.
 */
export function validateAppointmentDraft(
  draft: AppointmentDraft,
  timeZone: string,
): AppointmentValidation {
  const issues: AppointmentIssue[] = [];
  const doctorName = cleanText(draft.doctorName);
  const specialty = cleanText(draft.specialty);
  const location = cleanText(draft.location);
  const notes = cleanText(draft.notes);

  if (doctorName === null && specialty === null) {
    issues.push({ field: 'doctorOrSpecialty', code: 'doctor-or-specialty-required' });
  }
  const optionalTexts = { doctorName, specialty, location, notes };
  for (const field of ['doctorName', 'specialty', 'location', 'notes'] as const) {
    if ((optionalTexts[field]?.length ?? 0) > APPOINTMENT_LIMITS[field]) {
      issues.push({ field, code: 'too-long' });
    }
  }

  const date = parseLocalDate(draft.date);
  const time = parseLocalTime(draft.time);
  if (date === null) issues.push({ field: 'date', code: 'invalid-date' });
  if (time === null) issues.push({ field: 'time', code: 'invalid-time' });

  let scheduledAt: Timestamp | null = null;
  let ambiguousTime = false;
  if (date !== null && time !== null) {
    const conversion = localDateTimeToTimestamp(date, time, timeZone);
    if (conversion.ok) {
      scheduledAt = conversion.timestamp;
      ambiguousTime = conversion.ambiguous;
    } else {
      issues.push({ field: 'time', code: 'nonexistent-time' });
    }
  }

  if (issues.length > 0 || scheduledAt === null) return { ok: false, issues };
  return {
    ok: true,
    value: { doctorName, specialty, scheduledAt, location, notes, ambiguousTime },
  };
}

function cleanText(value: string): string | null {
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}
