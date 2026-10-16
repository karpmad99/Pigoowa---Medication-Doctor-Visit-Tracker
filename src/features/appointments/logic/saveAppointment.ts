import type { Id, Timestamp } from '@/types/primitives';
import { getLocalDateInZone, getLocalTimeInZone } from '@/utils/timeZone';
import type { Appointment } from '../types';
import type { AppointmentFormValues } from './appointmentForm';
import {
  validateAppointmentDraft,
  type AppointmentIssue,
  type ValidAppointmentFields,
} from './validation';

export interface SaveAppointmentContext {
  now: Timestamp;
  /** IANA zone in which the typed date and time are meant. */
  timeZone: string;
}

export type SaveAppointmentResult =
  /** `changed: false` (edit only): nothing differs from what is stored, so there is nothing to write. */
  | { ok: true; appointment: Appointment; changed: boolean }
  | { ok: false; issues: AppointmentIssue[] };

/** A new appointment from a form. It starts as `scheduled`: only the user marks it completed or cancelled. */
export function createAppointmentFromForm(
  values: AppointmentFormValues,
  context: SaveAppointmentContext & { id: Id },
): SaveAppointmentResult {
  const validation = validateAppointmentDraft(values, context.timeZone);
  if (!validation.ok) return validation;
  const fields = validation.value;
  return {
    ok: true,
    changed: true,
    appointment: {
      id: context.id,
      doctorName: fields.doctorName,
      specialty: fields.specialty,
      scheduledAt: fields.scheduledAt,
      location: fields.location,
      notes: fields.notes,
      status: 'scheduled',
      createdAt: context.now,
      updatedAt: context.now,
    },
  };
}

/**
 * The appointment as it should be stored after editing it with a form. Rules:
 * - `id`, `status` and `createdAt` never change: editing the details does not complete, cancel or
 *   restore anything (that is `changeAppointmentStatus`).
 * - If the date and time typed are the ones the appointment already has (as the wall clock in the
 *   user's zone shows them), its instant is kept exactly. This matters on the night clocks go
 *   back: the later of the two 02:30s would otherwise silently become the earlier one when
 *   something unrelated, like the location, is edited.
 * - If nothing differs, `changed` is false and the same appointment is returned (no write, and
 *   `updatedAt` stays).
 */
export function applyAppointmentEdit(
  existing: Appointment,
  values: AppointmentFormValues,
  context: SaveAppointmentContext,
): SaveAppointmentResult {
  const validation = validateAppointmentDraft(values, context.timeZone);
  if (!validation.ok) return validation;

  const unchangedWallClock =
    values.date === getLocalDateInZone(existing.scheduledAt, context.timeZone) &&
    values.time === getLocalTimeInZone(existing.scheduledAt, context.timeZone);
  const fields: ValidAppointmentFields = {
    ...validation.value,
    scheduledAt: unchangedWallClock ? existing.scheduledAt : validation.value.scheduledAt,
  };

  const same =
    fields.doctorName === existing.doctorName &&
    fields.specialty === existing.specialty &&
    fields.scheduledAt === existing.scheduledAt &&
    fields.location === existing.location &&
    fields.notes === existing.notes;
  if (same) return { ok: true, appointment: existing, changed: false };

  return {
    ok: true,
    changed: true,
    appointment: {
      ...existing,
      doctorName: fields.doctorName,
      specialty: fields.specialty,
      scheduledAt: fields.scheduledAt,
      location: fields.location,
      notes: fields.notes,
      updatedAt: context.now,
    },
  };
}
