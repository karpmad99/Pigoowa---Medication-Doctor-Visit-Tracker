import type { DoseLog, DoseSlot } from '../types';

/** A stable string for a slot, usable as a Map key or a React `key`. */
export function doseSlotKey(slot: DoseSlot): string {
  return `${slot.medicationId}|${slot.date}|${slot.time}`;
}

/** The slot an intake record belongs to. */
export function doseLogSlot(log: DoseLog): DoseSlot {
  return { medicationId: log.medicationId, date: log.scheduledDate, time: log.scheduledTime };
}

/** All records for a slot. More than one means corrupt data (storage must prevent it). */
export function findLogsForSlot(logs: readonly DoseLog[], slot: DoseSlot): DoseLog[] {
  const key = doseSlotKey(slot);
  return logs.filter((log) => doseSlotKey(doseLogSlot(log)) === key);
}
