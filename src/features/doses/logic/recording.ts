import type { Id, Timestamp } from '@/types/primitives';
import { compareLocalDates } from '@/utils/date';
import { isValidQuantity } from '@/utils/quantity';
import { getLocalDateInZone } from '@/utils/timeZone';
import type { DoseLog, DoseSlot, RecordedDoseStatus, ScheduledDose } from '../types';
import { DOSE_NOTE_MAX } from './limits';
import { doseLogSlot, doseSlotKey, findLogsForSlot } from './slots';
import { isPlannedAmount } from './takenDetails';

// Pure functions for changing intake records. They never write anywhere: they take the
// current records, and return the full new list plus what happened. The caller (a repository
// or a React state update) decides how to persist it. Inputs are never mutated.
//
// By construction no function here can leave two records for one slot: a slot is either
// created once, or its single record is changed or removed.

export interface RecordingContext {
  now: Timestamp;
  /** IANA time zone of the user; decides what "today" is. */
  timeZone: string;
}

export type DoseActionError =
  /** The dose is on a day after today. Future doses cannot be recorded. */
  | 'future-date'
  /** The dose amount or unit is unusable, so a faithful record cannot be made. */
  | 'invalid-dose'
  /** The slot already has a record with a different status. Use `changeDoseStatus` to change it deliberately. */
  | 'already-recorded'
  /** The slot has no record to change. */
  | 'record-not-found'
  /** The amount actually taken is not a quantity above zero with at most three decimals. */
  | 'invalid-amount'
  | 'note-too-long'
  /** An amount or a note was given for a dose that is not (being recorded as) taken. */
  | 'details-need-taken'
  /** The stored record is not the one the person was looking at (it changed meanwhile). Nothing is changed. */
  | 'record-changed'
  /** The data holds several records for one slot (should be impossible). Nothing is touched. */
  | 'conflicting-records';

export type DoseChange =
  /** A new record was added. */
  | 'created'
  /** The existing record's status was changed. */
  | 'updated'
  /** The record already was as requested; nothing changed. */
  | 'unchanged'
  /** The record was removed. */
  | 'removed'
  /** There was nothing to remove; nothing changed. */
  | 'none';

export type DoseActionResult =
  | {
      ok: true;
      change: DoseChange;
      /** The slot's record after the action, or `null` if the slot has none. */
      log: DoseLog | null;
      /** The complete new list of records. */
      logs: DoseLog[];
    }
  | { ok: false; error: DoseActionError };

/** What a person says about a dose they took: how much, and an optional note. */
export interface TakenDetails {
  /** In the dose's unit. May differ from the plan in either direction. */
  takenAmount: number;
  /** Already trimmed; `null` for none. */
  note: string | null;
}

export interface RecordDoseInput {
  dose: ScheduledDose;
  status: RecordedDoseStatus;
  /**
   * The amount actually taken and a note, recorded together with the dose. Only for `taken`. Given
   * for a slot that already has a record, nothing is written (`already-recorded`): the screen was
   * out of date, and the details are never merged into somebody else's record.
   */
  details?: TakenDetails;
  /** Id to use if a record has to be created. Passed in so this function stays deterministic. */
  newLogId: Id;
  logs: readonly DoseLog[];
  context: RecordingContext;
}

/**
 * Records a dose as taken or skipped for the first time.
 * - No record yet: creates one, copying the dose amount and unit as they are now.
 * - Already recorded with the same status: succeeds with `unchanged` (safe to repeat, e.g.
 *   a double click).
 * - Already recorded with a different status: fails with `already-recorded`. A record is never
 *   silently overwritten; changing it is a separate, explicit action.
 */
export function recordDose(input: RecordDoseInput): DoseActionResult {
  const { dose, status, newLogId, logs, context, details } = input;

  if (isAfterToday(dose.date, context)) return { ok: false, error: 'future-date' };
  if (details !== undefined && status !== 'taken')
    return { ok: false, error: 'details-need-taken' };
  const existing = findLogsForSlot(logs, dose);
  if (existing.length > 1) return { ok: false, error: 'conflicting-records' };

  const [current] = existing;
  if (current !== undefined) {
    if (details !== undefined) return { ok: false, error: 'already-recorded' };
    return current.status === status
      ? unchanged(current, logs)
      : { ok: false, error: 'already-recorded' };
  }
  const detailsError = checkDetails(details);
  if (detailsError !== null) return { ok: false, error: detailsError };

  if (!isValidQuantity(dose.doseAmount, { allowZero: false }) || dose.doseUnit.trim() === '') {
    return { ok: false, error: 'invalid-dose' };
  }
  const created: DoseLog = {
    id: newLogId,
    medicationId: dose.medicationId,
    scheduledDate: dose.date,
    scheduledTime: dose.time,
    status,
    doseAmount: dose.doseAmount,
    doseUnit: dose.doseUnit,
    recordedAt: context.now,
    ...(details === undefined ? {} : detailFields(details, dose.doseAmount)),
  };
  return { ok: true, change: 'created', log: created, logs: [...logs, created] };
}

export interface ChangeDoseStatusInput {
  slot: DoseSlot;
  status: RecordedDoseStatus;
  logs: readonly DoseLog[];
  context: RecordingContext;
}

/**
 * Changes an existing record between taken and skipped, updating that same record (same id,
 * so still exactly one record for the slot). The originally recorded amount and unit are kept.
 * Fails with `record-not-found` if the slot has no record, so a stale screen cannot bring back
 * a record that was undone elsewhere. Same status: `unchanged`.
 */
export function changeDoseStatus(input: ChangeDoseStatusInput): DoseActionResult {
  const { slot, status, logs, context } = input;

  if (isAfterToday(slot.date, context)) return { ok: false, error: 'future-date' };
  const existing = findLogsForSlot(logs, slot);
  if (existing.length > 1) return { ok: false, error: 'conflicting-records' };

  const [current] = existing;
  if (current === undefined) return { ok: false, error: 'record-not-found' };
  if (current.status === status) return unchanged(current, logs);

  // A skipped dose has no amount taken and no note: both go. Back to taken starts from the plan
  // again (the fields are simply not there). The plan (`doseAmount`) and the unit are kept.
  const withoutDetails: DoseLog = { ...current };
  delete withoutDetails.takenAmount;
  delete withoutDetails.note;
  const updated: DoseLog = { ...withoutDetails, status, recordedAt: context.now };
  return {
    ok: true,
    change: 'updated',
    log: updated,
    logs: logs.map((log) => (log.id === current.id ? updated : log)),
  };
}

export interface AdjustTakenAmountInput {
  slot: DoseSlot;
  /** The record exactly as the person saw it. The stored one must still be this one. */
  seen: DoseLog;
  details: TakenDetails;
  logs: readonly DoseLog[];
}

/**
 * Edits the amount actually taken and the note of a TAKEN record (PROJECT_SPEC DEC-48).
 * - The record is the one the person saw: if the stored record differs in anything (it was changed
 *   or replaced in another tab) nothing is written (`record-changed`).
 * - `recordedAt`, the plan (`doseAmount`, `doseUnit`), the id and the slot never change. The
 *   amount may be larger or smaller than the plan; that is never a reason to refuse it.
 * - An amount equal to the plan is stored as "as planned" (no `takenAmount`).
 * - The same amount and note again: `unchanged`, nothing is written.
 * - A skipped record has neither: `details-need-taken`.
 * Pure: the caller stores the result. Nothing here knows the schedule or suggests a dose.
 */
export function adjustTakenAmount(input: AdjustTakenAmountInput): DoseActionResult {
  const { slot, seen, details, logs } = input;

  const existing = findLogsForSlot(logs, slot);
  if (existing.length > 1) return { ok: false, error: 'conflicting-records' };
  const [current] = existing;
  if (current === undefined) return { ok: false, error: 'record-not-found' };
  if (current.status !== 'taken') return { ok: false, error: 'details-need-taken' };
  if (!sameRecord(current, seen)) return { ok: false, error: 'record-changed' };
  const detailsError = checkDetails(details);
  if (detailsError !== null) return { ok: false, error: detailsError };

  const base: DoseLog = { ...current };
  delete base.takenAmount;
  delete base.note;
  const updated: DoseLog = { ...base, ...detailFields(details, current.doseAmount) };
  if (sameRecord(updated, current)) return unchanged(current, logs);
  return {
    ok: true,
    change: 'updated',
    log: updated,
    logs: logs.map((log) => (log.id === current.id ? updated : log)),
  };
}

export interface UndoDoseInput {
  slot: DoseSlot;
  logs: readonly DoseLog[];
}

/**
 * Undoes a recorded action by removing the slot's record, which returns the dose to
 * "unrecorded". Undoing a dose that has no record succeeds with `none` and creates nothing, so
 * repeating undo is harmless. Other slots' records are untouched.
 */
export function undoDose(input: UndoDoseInput): DoseActionResult {
  const { slot, logs } = input;

  const existing = findLogsForSlot(logs, slot);
  if (existing.length > 1) return { ok: false, error: 'conflicting-records' };

  const [current] = existing;
  if (current === undefined) return { ok: true, change: 'none', log: null, logs: [...logs] };

  const key = doseSlotKey(doseLogSlot(current));
  return {
    ok: true,
    change: 'removed',
    log: null,
    logs: logs.filter((log) => doseSlotKey(doseLogSlot(log)) !== key),
  };
}

function unchanged(current: DoseLog, logs: readonly DoseLog[]): DoseActionResult {
  return { ok: true, change: 'unchanged', log: current, logs: [...logs] };
}

function isAfterToday(date: DoseSlot['date'], context: RecordingContext): boolean {
  return compareLocalDates(date, getLocalDateInZone(context.now, context.timeZone)) > 0;
}

function checkDetails(details: TakenDetails | undefined): DoseActionError | null {
  if (details === undefined) return null;
  if (!isValidQuantity(details.takenAmount, { allowZero: false })) return 'invalid-amount';
  if ((details.note?.trim().length ?? 0) > DOSE_NOTE_MAX) return 'note-too-long';
  return null;
}

/** The optional fields to store: none for the planned amount, none for an empty note. */
function detailFields(
  details: TakenDetails,
  plannedAmount: number,
): Pick<DoseLog, 'takenAmount' | 'note'> {
  const note = details.note?.trim() ?? '';
  return {
    ...(isPlannedAmount(details.takenAmount, plannedAmount)
      ? {}
      : { takenAmount: details.takenAmount }),
    ...(note === '' ? {} : { note }),
  };
}

/** Whether two records are the same in every stored field (an absent field equals an absent field). */
function sameRecord(a: DoseLog, b: DoseLog): boolean {
  return (
    a.id === b.id &&
    a.medicationId === b.medicationId &&
    a.scheduledDate === b.scheduledDate &&
    a.scheduledTime === b.scheduledTime &&
    a.status === b.status &&
    a.doseAmount === b.doseAmount &&
    a.doseUnit === b.doseUnit &&
    a.recordedAt === b.recordedAt &&
    a.takenAmount === b.takenAmount &&
    (a.note ?? null) === (b.note ?? null)
  );
}
