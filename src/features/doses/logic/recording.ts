import type { Id, Timestamp } from '@/types/primitives';
import { compareLocalDates } from '@/utils/date';
import { isValidQuantity } from '@/utils/quantity';
import { getLocalDateInZone } from '@/utils/timeZone';
import type { DoseLog, DoseSlot, RecordedDoseStatus, ScheduledDose } from '../types';
import { doseLogSlot, doseSlotKey, findLogsForSlot } from './slots';

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

export interface RecordDoseInput {
  dose: ScheduledDose;
  status: RecordedDoseStatus;
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
  const { dose, status, newLogId, logs, context } = input;

  if (isAfterToday(dose.date, context)) return { ok: false, error: 'future-date' };
  const existing = findLogsForSlot(logs, dose);
  if (existing.length > 1) return { ok: false, error: 'conflicting-records' };

  const [current] = existing;
  if (current !== undefined) {
    return current.status === status
      ? unchanged(current, logs)
      : { ok: false, error: 'already-recorded' };
  }

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

  const updated: DoseLog = { ...current, status, recordedAt: context.now };
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
