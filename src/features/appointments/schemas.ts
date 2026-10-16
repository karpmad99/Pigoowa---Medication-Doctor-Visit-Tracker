import { z } from 'zod';
import type { AppointmentFormValues } from './logic/appointmentForm';
import {
  APPOINTMENT_LIMITS,
  validateAppointmentDraft,
  type AppointmentField,
  type AppointmentIssue,
} from './logic/validation';

/** The Polish message for a problem found in the appointment form. */
export function appointmentIssueMessage(issue: AppointmentIssue): string {
  switch (issue.code) {
    case 'doctor-or-specialty-required':
      return 'Wpisz lekarza lub specjalizację (wystarczy jedno z nich).';
    case 'invalid-date':
      return 'Wybierz poprawną datę wizyty.';
    case 'invalid-time':
      return 'Wybierz poprawną godzinę wizyty.';
    case 'nonexistent-time':
      return 'Tej godziny nie ma w wybranym dniu z powodu zmiany czasu. Wybierz inną godzinę.';
    case 'too-long':
      switch (issue.field) {
        case 'doctorName':
          return `Nazwa lekarza może mieć najwyżej ${String(APPOINTMENT_LIMITS.doctorName)} znaków.`;
        case 'specialty':
          return `Specjalizacja może mieć najwyżej ${String(APPOINTMENT_LIMITS.specialty)} znaków.`;
        case 'location':
          return `Miejsce może mieć najwyżej ${String(APPOINTMENT_LIMITS.location)} znaków.`;
        default:
          return `Notatki mogą mieć najwyżej ${String(APPOINTMENT_LIMITS.notes)} znaków.`;
      }
  }
}

/**
 * Which form fields show a problem. "Doctor or specialty" is about two fields at once, so both
 * are marked and both say what is needed.
 */
function fieldsOf(field: AppointmentField): (keyof AppointmentFormValues)[] {
  return field === 'doctorOrSpecialty' ? ['doctorName', 'specialty'] : [field];
}

/**
 * Zod's view of the appointment form. It only checks the SHAPE (everything is text, as typed)
 * and hands the values to `validateAppointmentDraft` (Stage 2), which holds the actual rules;
 * this adds the Polish message and the field to each problem. The rules live in one place. The
 * schema depends on the time zone because "10:00" only means an instant in a zone (and a time
 * that does not exist on a clock-change day is refused).
 */
export function createAppointmentFormSchema(
  timeZone: string,
): z.ZodType<AppointmentFormValues, AppointmentFormValues> {
  return z
    .object({
      doctorName: z.string(),
      specialty: z.string(),
      date: z.string(),
      time: z.string(),
      location: z.string(),
      notes: z.string(),
    })
    .superRefine((values, context) => {
      const validation = validateAppointmentDraft(values, timeZone);
      if (validation.ok) return;
      for (const issue of validation.issues) {
        for (const field of fieldsOf(issue.field)) {
          context.addIssue({
            code: 'custom',
            path: [field],
            message: appointmentIssueMessage(issue),
          });
        }
      }
    });
}
