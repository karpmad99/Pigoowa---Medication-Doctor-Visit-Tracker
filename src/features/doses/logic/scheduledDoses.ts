import type { Medication } from '@/features/medications/types';
import {
  isMedicationActiveOn,
  normalizeScheduleTimes,
} from '@/features/medications/logic/schedule';
import type { Id, LocalDate } from '@/types/primitives';
import { compareLocalTimes, compareTimestamps } from '@/utils/date';
import type { DoseLog, ScheduledDose } from '../types';
import { doseLogSlot, doseSlotKey } from './slots';

export interface GenerateScheduledDosesInput {
  medications: readonly Medication[];
  /** Any records; only those for `date` are looked at. */
  doseLogs: readonly DoseLog[];
  date: LocalDate;
}

export interface DailyDoses {
  /** The planned doses for `date`, each carrying its record (if any). */
  doses: ScheduledDose[];
  /**
   * Records for `date` that match no planned dose: the schedule changed after they were
   * recorded, the medication ended, or it no longer exists. They stay visible as history.
   */
  outsideSchedule: DoseLog[];
}

const nameCollator = new Intl.Collator('pl');

/**
 * Computes the planned doses for one calendar day from the schedule rules.
 *
 * Rules:
 * - A medication contributes doses only if it is active on `date`: not before its start date
 *   or its `scheduleEffectiveFrom`, and not after its end date.
 * - Each usable schedule time gives one dose. Unusable amounts are skipped and repeated times
 *   of day collapse to one (see `normalizeScheduleTimes`), so a slot can never appear twice.
 * - A dose's status comes from the intake record of the same medication, date and time.
 *   There is at most one such record in valid data; if corrupt data holds several, the most
 *   recently recorded one is shown (ties: highest id), so the output is still deterministic.
 * - Order: time of day, then medication name (Polish collation), then medication id.
 *
 * Pure: no clock, no storage, inputs are not modified. Generated doses are never stored.
 */
export function generateScheduledDoses(input: GenerateScheduledDosesInput): DailyDoses {
  const { medications, doseLogs, date } = input;
  const logsForDate = doseLogs.filter((log) => log.scheduledDate === date);
  const logBySlot = latestLogBySlot(logsForDate);

  const doses: ScheduledDose[] = [];
  for (const medication of medications) {
    if (!isMedicationActiveOn(medication, date)) continue;
    for (const entry of normalizeScheduleTimes(medication.scheduleTimes)) {
      const slot = { medicationId: medication.id, date, time: entry.timeOfDay };
      const log = logBySlot.get(doseSlotKey(slot)) ?? null;
      doses.push({
        ...slot,
        medicationName: medication.name,
        doseAmount: entry.doseAmount,
        doseUnit: medication.doseUnit,
        status: log?.status ?? 'unrecorded',
        log,
      });
    }
  }
  doses.sort(compareDoses);

  const plannedKeys = new Set(doses.map((dose) => doseSlotKey(dose)));
  const outsideSchedule = logsForDate
    .filter((log) => !plannedKeys.has(doseSlotKey(doseLogSlot(log))))
    .sort(compareLogs);

  return { doses, outsideSchedule };
}

function latestLogBySlot(logs: readonly DoseLog[]): Map<string, DoseLog> {
  const result = new Map<string, DoseLog>();
  for (const log of logs) {
    const key = doseSlotKey(doseLogSlot(log));
    const current = result.get(key);
    if (current === undefined || isMoreRecent(log, current)) result.set(key, log);
  }
  return result;
}

function isMoreRecent(a: DoseLog, b: DoseLog): boolean {
  const byTime = compareTimestamps(a.recordedAt, b.recordedAt);
  return byTime !== 0 ? byTime > 0 : a.id > b.id;
}

function compareIds(a: Id, b: Id): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function compareDoses(a: ScheduledDose, b: ScheduledDose): number {
  return (
    compareLocalTimes(a.time, b.time) ||
    nameCollator.compare(a.medicationName, b.medicationName) ||
    compareIds(a.medicationId, b.medicationId)
  );
}

function compareLogs(a: DoseLog, b: DoseLog): number {
  return (
    compareLocalTimes(a.scheduledTime, b.scheduledTime) ||
    compareIds(a.medicationId, b.medicationId) ||
    compareIds(a.id, b.id)
  );
}
