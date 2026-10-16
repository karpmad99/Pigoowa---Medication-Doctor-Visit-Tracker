import type { AppServices } from '@/services/repositories';
import type { Id, Timestamp } from '@/types/primitives';
import { changeAppointmentStatus, type AppointmentStatusError } from './logic/status';
import { applyAppointmentEdit, type SaveAppointmentResult } from './logic/saveAppointment';
import type { AppointmentFormValues } from './logic/appointmentForm';
import type { Appointment, AppointmentStatus } from './types';

// Writes for appointments. Like `applyDoseAction`, each one reads the appointment from STORAGE
// first and applies the Stage 2 rule to that, so a screen that is out of date (the appointment
// was changed in another tab) cannot overwrite a newer status or details. The rules themselves
// stay in `logic/`; this file only joins them to the repository.

type Repositories = AppServices['repositories'];

export type StatusChangeOutcome =
  | { ok: true; change: 'changed' | 'unchanged'; appointment: Appointment }
  | { ok: false; error: AppointmentStatusError };

/**
 * Changes the status of the stored appointment. Asking for the status it already has succeeds
 * without writing. Going straight between completed and cancelled is refused by the Stage 2 rule
 * (`invalid-transition`). Rejects with a `RepositoryError` (`not-found`, storage problems).
 */
export async function applyAppointmentStatusChange(input: {
  repositories: Repositories;
  id: Id;
  status: AppointmentStatus;
  now: Timestamp;
}): Promise<StatusChangeOutcome> {
  const { repositories, id, status, now } = input;
  const current = await repositories.appointments.get(id);
  const result = changeAppointmentStatus(current, status, now);
  if (!result.ok) return result;
  if (!result.changed) return { ok: true, change: 'unchanged', appointment: current };
  const saved = await repositories.appointments.update(result.appointment);
  return { ok: true, change: 'changed', appointment: saved };
}

/**
 * Saves an edit onto the STORED appointment (not onto the copy the form was opened with), so the
 * status or details changed elsewhere meanwhile are not undone by fields the user never touched.
 * Nothing is written when nothing differs. Rejects with a `RepositoryError`.
 */
export async function saveAppointmentEdit(input: {
  repositories: Repositories;
  id: Id;
  values: AppointmentFormValues;
  now: Timestamp;
  timeZone: string;
}): Promise<SaveAppointmentResult> {
  const { repositories, id, values, now, timeZone } = input;
  const current = await repositories.appointments.get(id);
  const result = applyAppointmentEdit(current, values, { now, timeZone });
  if (!result.ok || !result.changed) return result;
  const saved = await repositories.appointments.update(result.appointment);
  return { ok: true, changed: true, appointment: saved };
}

/** Polish text for a refused status change. */
export const statusChangeRefusalMessages: Record<AppointmentStatusError, string> = {
  'invalid-transition':
    'Status tej wizyty został w międzyczasie zmieniony (być może w innej karcie), a z odbytej od razu na odwołaną nie można przejść. Nic nie zmieniono, a widok został odświeżony.',
};
