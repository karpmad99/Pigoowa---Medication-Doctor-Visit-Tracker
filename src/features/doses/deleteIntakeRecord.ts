import type { AppServices } from '@/services/repositories';
import { outsideScheduleReason } from './logic/history';
import { doseLogSlot, findLogsForSlot } from './logic/slots';
import type { DoseLog } from './types';

/** Why a record was NOT deleted although the user asked for it. Nothing was changed in any case. */
export type DeleteRecordRefusal =
  /** The slot's record is not the one the user saw (replaced, or its status was changed meanwhile). */
  | 'changed-meanwhile'
  /** The record now belongs to the current schedule; it is corrected in the day view instead. */
  | 'now-in-schedule'
  /** The slot holds several records (should be impossible). Guessing which to remove could destroy the wrong one. */
  | 'conflicting-records';

export type DeleteRecordOutcome =
  { ok: true; change: 'removed' | 'none' } | { ok: false; error: DeleteRecordRefusal };

/**
 * Deletes one intake record that lies OUTSIDE the current schedule, on the user's explicit request
 * (the history page). It exists because such a record cannot be corrected anywhere else: the day
 * view only offers the doses the schedule plans.
 *
 * Deleting is "clearing" in the sense of PROJECT_SPEC D-4 (`remove(slot)`: that one slot, nothing
 * else), made safe by checking, against STORAGE and not against the screen, immediately before:
 * - the slot's record is the very record the user confirmed (same id and same status), otherwise
 *   `changed-meanwhile`: another tab changed it and the user decided about something else;
 * - the record is still outside the current schedule, otherwise `now-in-schedule`;
 * - the slot holds exactly one record (`conflicting-records` otherwise).
 * A record that is already gone succeeds as `none` (repeating is harmless). Other records, the
 * medication and its schedule are never touched. Storage failures reject with a `RepositoryError`.
 * There is no compare-and-delete in the repository API, so a change made by another tab in the
 * few milliseconds between the check and the removal cannot be excluded.
 */
export async function deleteOutsideScheduleRecord(input: {
  repositories: AppServices['repositories'];
  /** The record as the user saw and confirmed it. */
  log: DoseLog;
}): Promise<DeleteRecordOutcome> {
  const { repositories, log } = input;
  const slot = doseLogSlot(log);

  const stored = await repositories.doseLogs.listByDateRange(log.scheduledDate, log.scheduledDate);
  const existing = findLogsForSlot(stored, slot);
  if (existing.length > 1) return { ok: false, error: 'conflicting-records' };

  const [current] = existing;
  if (current === undefined) return { ok: true, change: 'none' };
  if (current.id !== log.id || current.status !== log.status) {
    return { ok: false, error: 'changed-meanwhile' };
  }

  const medications = await repositories.medications.list();
  const medication = medications.find((candidate) => candidate.id === current.medicationId);
  if (outsideScheduleReason(medication, current) === null) {
    return { ok: false, error: 'now-in-schedule' };
  }

  await repositories.doseLogs.remove(slot);
  return { ok: true, change: 'removed' };
}

/** Polish text for a refusal. */
export const deleteRecordRefusalMessages: Record<DeleteRecordRefusal, string> = {
  'changed-meanwhile':
    'Ten zapis został w międzyczasie zmieniony (być może w innej karcie), więc nic nie usunięto. Widok został odświeżony.',
  'now-in-schedule':
    'Ten zapis należy teraz do aktualnego harmonogramu, więc nic nie usunięto. Cofnij go w widoku dnia.',
  'conflicting-records':
    'Dla tej dawki zapisano kilka wpisów. Aplikacja niczego nie usunęła, żeby nie skasować niewłaściwego.',
};
