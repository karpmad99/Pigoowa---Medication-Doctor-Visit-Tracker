import type { Timestamp } from '@/types/primitives';
import { compareTimestamps } from '@/utils/date';
import type { Appointment, AppointmentStatus } from '../types';

/**
 * Where an appointment belongs, derived from its stored status and the time. Nothing here is
 * ever written back: the stored status changes only when the user acts.
 * - `upcoming`: status `scheduled` and the visit has not started yet. An appointment starting
 *   at exactly `now` still counts as upcoming.
 * - `needs-confirmation`: status `scheduled` but its time has passed; the user should mark it
 *   completed or cancelled. It is listed with past appointments.
 * - `past`: marked `completed` or `cancelled` (whatever its time, e.g. cancelled in advance).
 */
export type AppointmentPhase = 'upcoming' | 'needs-confirmation' | 'past';

export function classifyAppointment(appointment: Appointment, now: Timestamp): AppointmentPhase {
  if (appointment.status !== 'scheduled') return 'past';
  return compareTimestamps(appointment.scheduledAt, now) >= 0 ? 'upcoming' : 'needs-confirmation';
}

export interface SplitAppointments {
  /** Soonest first. */
  upcoming: Appointment[];
  /** Includes `needs-confirmation`. Most recent first. */
  past: Appointment[];
}

/** Splits into the "upcoming" and "past" lists, each in a deterministic order (ties: by id). */
export function splitAppointments(
  appointments: readonly Appointment[],
  now: Timestamp,
): SplitAppointments {
  const byTime = (a: Appointment, b: Appointment) =>
    compareTimestamps(a.scheduledAt, b.scheduledAt) || compareText(a.id, b.id);

  const upcoming = appointments.filter((a) => classifyAppointment(a, now) === 'upcoming');
  const past = appointments.filter((a) => classifyAppointment(a, now) !== 'upcoming');
  return {
    upcoming: upcoming.sort(byTime),
    past: past.sort(
      (a, b) => -compareTimestamps(a.scheduledAt, b.scheduledAt) || compareText(a.id, b.id),
    ),
  };
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export type AppointmentStatusError =
  /** Only `scheduled` -> `completed`/`cancelled` and back to `scheduled` are allowed. */
  'invalid-transition';

export type AppointmentStatusResult =
  | { ok: true; appointment: Appointment; changed: boolean }
  | { ok: false; error: AppointmentStatusError };

/**
 * Changes the status of an appointment.
 * Allowed: scheduled -> completed, scheduled -> cancelled, and completed/cancelled -> scheduled
 * (to correct a mistake). Going straight between completed and cancelled is refused, so a
 * correction is always an explicit step through `scheduled`. Asking for the status it already
 * has succeeds with `changed: false`. The date and time are never touched; marking an
 * appointment completed before its time is allowed.
 */
export function changeAppointmentStatus(
  appointment: Appointment,
  status: AppointmentStatus,
  now: Timestamp,
): AppointmentStatusResult {
  if (appointment.status === status) return { ok: true, appointment, changed: false };
  if (appointment.status !== 'scheduled' && status !== 'scheduled') {
    return { ok: false, error: 'invalid-transition' };
  }
  return { ok: true, appointment: { ...appointment, status, updatedAt: now }, changed: true };
}
