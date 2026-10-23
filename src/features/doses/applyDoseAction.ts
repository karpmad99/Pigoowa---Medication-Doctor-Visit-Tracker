import type { AppServices } from '@/services/repositories';
import type { Id, Timestamp } from '@/types/primitives';
import { RepositoryError } from '@/services/errors';
import type { DoseChange, DoseActionError } from './logic/recording';
import {
  adjustTakenAmount,
  changeDoseStatus,
  recordDose,
  undoDose,
  type TakenDetails,
} from './logic/recording';
import type { DoseLog, RecordedDoseStatus, ScheduledDose } from './types';

/** What the user asked for: record the dose as taken or skipped, or clear its record. */
export type DoseTarget = RecordedDoseStatus | 'clear';

export type DoseActionOutcome =
  | { ok: true; change: DoseChange; log: DoseLog | null }
  /** The Stage 2 rules refused the action; nothing was written. */
  | { ok: false; error: DoseActionError };

export interface ApplyDoseActionInput {
  repositories: AppServices['repositories'];
  /** The dose as the screen shows it. Its status decides whether this is a first record or a correction. */
  dose: ScheduledDose;
  target: DoseTarget;
  now: Timestamp;
  timeZone: string;
  createId: () => Id;
}

/**
 * Applies one dose action against the stored data, using the Stage 2 rules and the slot-based
 * repository operations.
 *
 * It does not trust what the screen shows. The slot's records are read from storage first and the
 * pure rules run on THAT, so a screen that is out of date (the dose was changed in another tab)
 * cannot overwrite or resurrect a record by accident:
 * - unrecorded on screen: `recordDose`. If a record with another status exists meanwhile, the rules
 *   refuse with `already-recorded` and nothing is overwritten.
 * - recorded on screen: `changeDoseStatus` updates that same record (same id); if it is gone,
 *   the rules refuse with `record-not-found` and nothing is created.
 * - clear: `undoDose`, then `remove(slot)`, which affects this one slot only. Nothing to clear is
 *   a successful no-op.
 * Nothing is written unless the rules allow it, and a `change` of `unchanged` or `none` writes
 * nothing. Storage failures reject with a `RepositoryError`; a write that was refused or failed is
 * never reported as done.
 */
export async function applyDoseAction(input: ApplyDoseActionInput): Promise<DoseActionOutcome> {
  const { repositories, dose, target, now, timeZone, createId } = input;
  const slot = { medicationId: dose.medicationId, date: dose.date, time: dose.time };
  const context = { now, timeZone };

  // Every record of that day, from storage (not from the screen).
  const stored = await repositories.doseLogs.listByDateRange(dose.date, dose.date);

  if (target === 'clear') {
    const result = undoDose({ slot, logs: stored });
    if (!result.ok) return result;
    if (result.change === 'removed') await repositories.doseLogs.remove(slot);
    return { ok: true, change: result.change, log: null };
  }

  const isCorrection = dose.status !== 'unrecorded';
  const result = isCorrection
    ? changeDoseStatus({ slot, status: target, logs: stored, context })
    : recordDose({ dose, status: target, newLogId: createId(), logs: stored, context });
  if (!result.ok) return result;

  if ((result.change === 'created' || result.change === 'updated') && result.log !== null) {
    // The repository refuses a different record in the same slot (`duplicate-slot`), so even a
    // race between two tabs cannot leave two records or silently replace another one.
    const saved = await repositories.doseLogs.upsert(result.log);
    return { ok: true, change: result.change, log: saved };
  }
  return { ok: true, change: result.change, log: result.log };
}

export interface ApplyTakenDetailsInput {
  repositories: AppServices['repositories'];
  /** The dose as the screen shows it, with the record the person saw (`dose.log`) if there is one. */
  dose: ScheduledDose;
  /** What was typed and checked: the amount actually taken, and an optional note. */
  details: TakenDetails;
  now: Timestamp;
  timeZone: string;
  createId: () => Id;
}

/**
 * Records a dose as taken together with the amount actually taken and a note, or edits those two on
 * a record that is already taken (PROJECT_SPEC DEC-48), against the stored data:
 * - unrecorded on screen: `recordDose` with the details. If the slot got a record meanwhile, the
 *   rules refuse (`already-recorded`) and nothing is merged into it.
 * - taken on screen: `adjustTakenAmount`, which checks that the stored record is still the one the
 *   person saw (`record-changed` otherwise), never moves `recordedAt` and never touches the plan.
 * - skipped on screen: refused (`details-need-taken`).
 * The same amount and note again write nothing. Neither the schedule nor any other record is
 * touched, and a larger or smaller amount than the plan is never a reason to refuse.
 */
export async function applyTakenDetails(input: ApplyTakenDetailsInput): Promise<DoseActionOutcome> {
  const { repositories, dose, details, now, timeZone, createId } = input;
  const slot = { medicationId: dose.medicationId, date: dose.date, time: dose.time };
  const stored = await repositories.doseLogs.listByDateRange(dose.date, dose.date);

  let result: ReturnType<typeof recordDose>;
  if (dose.status === 'unrecorded') {
    result = recordDose({
      dose,
      status: 'taken',
      details,
      newLogId: createId(),
      logs: stored,
      context: { now, timeZone },
    });
  } else if (dose.status === 'taken' && dose.log !== null) {
    result = adjustTakenAmount({ slot, seen: dose.log, details, logs: stored });
  } else {
    return { ok: false, error: 'details-need-taken' };
  }
  if (!result.ok) return result;
  if ((result.change === 'created' || result.change === 'updated') && result.log !== null) {
    const saved = await repositories.doseLogs.upsert(result.log);
    return { ok: true, change: result.change, log: saved };
  }
  return { ok: true, change: result.change, log: result.log };
}

/** True for the refusals that mean "the screen was out of date": the caller should reload it. */
export function isStaleScreenError(error: DoseActionError): boolean {
  return (
    error === 'already-recorded' ||
    error === 'record-not-found' ||
    error === 'conflicting-records' ||
    error === 'record-changed'
  );
}

/** Repository errors that mean the stored data is not what the screen assumed. */
export function isConflictRepositoryError(error: RepositoryError): boolean {
  return error.code === 'duplicate-slot' || error.code === 'missing-reference';
}

/** Polish text for a refusal of the Stage 2 rules. */
export const doseActionErrorMessages: Record<DoseActionError, string> = {
  'future-date': 'Nie można zapisać dawki z przyszłego dnia.',
  'invalid-dose':
    'Ta dawka ma nieprawidłową ilość lub jednostkę, więc nie można jej zapisać. Popraw lek i spróbuj ponownie.',
  'already-recorded':
    'Ta dawka ma już zapis z innym statusem (być może zmieniony w innej karcie). Nic nie zostało nadpisane, a widok został odświeżony.',
  'record-not-found':
    'Zapis tej dawki już nie istnieje (być może został cofnięty w innej karcie). Nic nie zostało zmienione, a widok został odświeżony.',
  'conflicting-records':
    'Dla tej dawki zapisano kilka wpisów. Aplikacja niczego nie zmieniła, żeby nie usunąć niewłaściwego.',
  'invalid-amount':
    'Wpisz ilość większą od zera, na przykład 1 lub 0,5 (do 3 miejsc po przecinku).',
  'note-too-long': 'Notatka może mieć najwyżej 500 znaków.',
  'details-need-taken': 'Ilość i notatkę można zapisać tylko przy dawce przyjętej.',
  'record-changed':
    'Zapis tej dawki zmienił się w międzyczasie (być może w innej karcie). Nic nie zostało nadpisane, a widok został odświeżony.',
};
