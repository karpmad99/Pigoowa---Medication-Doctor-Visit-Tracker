import type { Medication } from '@/features/medications/types';
import type { Id, LocalDate } from '@/types/primitives';
import { compareLocalDates, compareLocalTimes } from '@/utils/date';
import type { DoseLog, RecordedDoseStatus } from '../types';
import { generateScheduledDoses } from './scheduledDoses';

// Pure helpers for the intake history. Records are FACTS: nothing here changes or removes one.

/** Why a record is not part of the schedule the medication has today (PROJECT_SPEC D-9). */
export type OutsideScheduleReason =
  /** The medication no longer exists (deleted). Its records were left behind. */
  | 'medication-removed'
  /** The record's day is before the medication's start date. */
  | 'before-start'
  /** The record's day is after the medication's end date. */
  | 'after-end'
  /** The record's day is before the current schedule took effect (the schedule was changed later). */
  | 'before-schedule-change'
  /** The medication was active that day, but its current schedule has no dose at that time. */
  | 'time-not-in-schedule';

/**
 * `null` when the record belongs to a dose the current schedule generates for that day. Otherwise
 * the reason. "Belongs" is decided by `generateScheduledDoses` itself, so this can never disagree
 * with what the day view shows; the reason is then worked out from the medication's own dates,
 * which is exact (no guessing).
 */
export function outsideScheduleReason(
  medication: Medication | undefined,
  log: DoseLog,
): OutsideScheduleReason | null {
  if (medication === undefined) return 'medication-removed';
  const day = generateScheduledDoses({
    medications: [medication],
    doseLogs: [log],
    date: log.scheduledDate,
  });
  if (day.outsideSchedule.length === 0) return null;

  if (compareLocalDates(log.scheduledDate, medication.startDate) < 0) return 'before-start';
  if (medication.endDate !== null && compareLocalDates(log.scheduledDate, medication.endDate) > 0) {
    return 'after-end';
  }
  if (compareLocalDates(log.scheduledDate, medication.scheduleEffectiveFrom) < 0) {
    return 'before-schedule-change';
  }
  return 'time-not-in-schedule';
}

/** The reason for every record that is outside the current schedule, keyed by record id. */
export function findOutsideScheduleReasons(
  medications: readonly Medication[],
  logs: readonly DoseLog[],
): Map<Id, OutsideScheduleReason> {
  const byId = new Map(medications.map((medication) => [medication.id, medication]));
  const result = new Map<Id, OutsideScheduleReason>();
  for (const log of logs) {
    const reason = outsideScheduleReason(byId.get(log.medicationId), log);
    if (reason !== null) result.set(log.id, reason);
  }
  return result;
}

export interface HistoryFilters {
  /** First day to include, or `null` for no lower limit. */
  from: LocalDate | null;
  /** Last day to include, or `null` for no upper limit. */
  to: LocalDate | null;
  medicationId: Id | null;
  status: RecordedDoseStatus | null;
}

export const NO_HISTORY_FILTERS: HistoryFilters = {
  from: null,
  to: null,
  medicationId: null,
  status: null,
};

/** True when the range is given at both ends and ends before it starts: nothing can match. */
export function isRangeReversed(filters: Pick<HistoryFilters, 'from' | 'to'>): boolean {
  return (
    filters.from !== null && filters.to !== null && compareLocalDates(filters.from, filters.to) > 0
  );
}

/** The records that match every given filter. Does not modify the input. */
export function filterHistory(logs: readonly DoseLog[], filters: HistoryFilters): DoseLog[] {
  return logs.filter(
    (log) =>
      (filters.from === null || compareLocalDates(log.scheduledDate, filters.from) >= 0) &&
      (filters.to === null || compareLocalDates(log.scheduledDate, filters.to) <= 0) &&
      (filters.medicationId === null || log.medicationId === filters.medicationId) &&
      (filters.status === null || log.status === filters.status),
  );
}

const nameCollator = new Intl.Collator('pl');

/**
 * Newest day first; within a day from the earliest time, as in the day view; then by medication
 * name (Polish collation), medication id and record id, so the order is always the same.
 * `nameOf` gives a medication's display name ('' when unknown).
 */
export function sortHistory(logs: readonly DoseLog[], nameOf: (id: Id) => string): DoseLog[] {
  return [...logs].sort(
    (a, b) =>
      compareLocalDates(b.scheduledDate, a.scheduledDate) ||
      compareLocalTimes(a.scheduledTime, b.scheduledTime) ||
      nameCollator.compare(nameOf(a.medicationId), nameOf(b.medicationId)) ||
      compareStrings(a.medicationId, b.medicationId) ||
      compareStrings(a.id, b.id),
  );
}

function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export interface HistoryDay {
  date: LocalDate;
  logs: DoseLog[];
}

/** Splits an already sorted list into consecutive days, keeping the order. */
export function groupByDate(sortedLogs: readonly DoseLog[]): HistoryDay[] {
  const days: HistoryDay[] = [];
  for (const log of sortedLogs) {
    const last = days.at(-1);
    if (last?.date === log.scheduledDate) last.logs.push(log);
    else days.push({ date: log.scheduledDate, logs: [log] });
  }
  return days;
}
