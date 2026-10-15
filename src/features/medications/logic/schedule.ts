import type { LocalDate, LocalTime, Timestamp } from '@/types/primitives';
import { compareLocalDates, compareLocalTimes, parseLocalTime } from '@/utils/date';
import { isValidQuantity } from '@/utils/quantity';
import type { Medication, ScheduleTime } from '../types';

/**
 * Cleans a stored schedule so that every consumer (dose generation, stock estimates) reads it
 * the same way:
 * - entries with an unusable dose amount (not a positive, finite number with at most 3 decimals)
 *   are dropped;
 * - if several entries share the same time of day, only one is kept: the one with the smallest
 *   `id`. (Amounts are never merged: adding them up would invent a dose nobody configured.)
 * - the result is sorted by time of day.
 * The input is not modified. Forms should prevent such data; this is the safety net for data
 * that arrives from elsewhere.
 */
export function normalizeScheduleTimes(times: readonly ScheduleTime[]): ScheduleTime[] {
  const sorted = times
    .filter((entry) => isValidQuantity(entry.doseAmount, { allowZero: false }))
    .toSorted((a, b) => compareLocalTimes(a.timeOfDay, b.timeOfDay) || compareText(a.id, b.id));

  const result: ScheduleTime[] = [];
  for (const entry of sorted) {
    if (result.at(-1)?.timeOfDay !== entry.timeOfDay) result.push(entry);
  }
  return result;
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Whether the medication can have doses on `date`: the date is within
 * [startDate, endDate] and not before `scheduleEffectiveFrom`.
 */
export function isMedicationActiveOn(medication: Medication, date: LocalDate): boolean {
  if (compareLocalDates(date, medication.startDate) < 0) return false;
  if (compareLocalDates(date, medication.scheduleEffectiveFrom) < 0) return false;
  return medication.endDate === null || compareLocalDates(date, medication.endDate) <= 0;
}

export type ScheduleIssueCode = 'empty' | 'invalid-time' | 'invalid-amount' | 'duplicate-time';

export interface ScheduleIssue {
  code: ScheduleIssueCode;
  /** Position in the submitted list, or `null` for problems with the list as a whole. */
  index: number | null;
}

export interface ScheduleTimeInput {
  timeOfDay: string;
  doseAmount: number;
}

export type ScheduleValidation =
  | { ok: true; times: { timeOfDay: LocalTime; doseAmount: number }[] }
  | { ok: false; issues: ScheduleIssue[] };

/** Strictly validates a schedule submitted from a form: at least one time, valid `HH:mm`, positive amounts, no repeated time. */
export function validateScheduleTimes(input: readonly ScheduleTimeInput[]): ScheduleValidation {
  if (input.length === 0) return { ok: false, issues: [{ code: 'empty', index: null }] };

  const issues: ScheduleIssue[] = [];
  const times: { timeOfDay: LocalTime; doseAmount: number }[] = [];
  const seen = new Set<string>();

  input.forEach((entry, index) => {
    const timeOfDay = parseLocalTime(entry.timeOfDay);
    let valid = true;
    if (timeOfDay === null) {
      issues.push({ code: 'invalid-time', index });
      valid = false;
    } else if (seen.has(timeOfDay)) {
      issues.push({ code: 'duplicate-time', index });
      valid = false;
    } else {
      seen.add(timeOfDay);
    }
    if (!isValidQuantity(entry.doseAmount, { allowZero: false })) {
      issues.push({ code: 'invalid-amount', index });
      valid = false;
    }
    if (valid && timeOfDay !== null) times.push({ timeOfDay, doseAmount: entry.doseAmount });
  });

  return issues.length > 0 ? { ok: false, issues } : { ok: true, times };
}

/**
 * Replaces a medication's schedule. If the effective schedule really changes (a time or an
 * amount differs), `scheduleEffectiveFrom` moves to today (or to the start date, if that is
 * later) so that past days keep their recorded history and gain no phantom "unrecorded" doses.
 * If nothing changes, the same medication object is returned untouched.
 *
 * `newTimes` must already be validated (see `validateScheduleTimes`) and carry their own ids.
 */
export function applyScheduleChange(
  medication: Medication,
  newTimes: readonly ScheduleTime[],
  today: LocalDate,
  now: Timestamp,
): Medication {
  if (sameSchedule(medication.scheduleTimes, newTimes)) return medication;

  const effectiveFrom =
    compareLocalDates(today, medication.startDate) < 0 ? medication.startDate : today;
  return {
    ...medication,
    scheduleTimes: [...newTimes],
    scheduleEffectiveFrom: effectiveFrom,
    updatedAt: now,
  };
}

function sameSchedule(a: readonly ScheduleTime[], b: readonly ScheduleTime[]): boolean {
  const left = normalizeScheduleTimes(a);
  const right = normalizeScheduleTimes(b);
  return (
    left.length === right.length &&
    left.every(
      (entry, i) =>
        entry.timeOfDay === right[i]?.timeOfDay && entry.doseAmount === right[i].doseAmount,
    )
  );
}
