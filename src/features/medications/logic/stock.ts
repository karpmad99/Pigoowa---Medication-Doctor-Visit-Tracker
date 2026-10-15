import type { LocalDate, Timestamp } from '@/types/primitives';
import { compareLocalDates, compareTimestamps } from '@/utils/date';
import { fromThousandths, isValidQuantity, toThousandths } from '@/utils/quantity';
import type { DoseLog } from '@/features/doses/types';
import type { Medication, MedicationStock } from '../types';
import { normalizeScheduleTimes } from './schedule';
import { unitsMatch } from './units';

/** Stock lasting fewer days than this is highlighted in the UI. A display threshold, not medical guidance. */
export const LOW_STOCK_THRESHOLD_DAYS = 7;

const MAX_UNIT_LENGTH = 30;

export type StockUnavailableReason =
  /** The user has not entered any stock information. */
  | 'no-stock'
  /** The stock quantity or a dose record holds an unusable number (negative, NaN, ...). */
  | 'invalid-data'
  /** The medication's end date is before today; nothing is left to estimate. */
  | 'ended'
  /** There are no usable schedule times, so days remaining cannot be computed. */
  | 'no-schedule'
  /** The stock unit differs from the dose unit, so the numbers cannot be combined. */
  | 'incompatible-units';

/**
 * Either a number or a reason why there is none. `available: true` with `remaining: 0` ("none
 * left") is deliberately a different thing from `available: false` ("cannot tell").
 */
export type StockEstimate =
  | { available: true; remaining: number; unit: string; daysRemaining: number }
  | { available: false; reason: StockUnavailableReason };

export interface EstimateStockInput {
  medication: Medication;
  /** May contain records of other medications; only this medication's are used. */
  doseLogs: readonly DoseLog[];
  today: LocalDate;
}

/**
 * Estimates how much of a medication is left and for how many days.
 *
 * Assumptions (also shown to the user):
 * 1. Stock is the quantity the user entered, in `stock.unit`, valid as of `stock.asOf`.
 * 2. Only records with status `taken`, recorded at or after `asOf`, reduce it. Skipped and
 *    unrecorded doses use nothing, so forgetting to record a dose makes the estimate optimistic.
 * 3. Daily use = the sum of the current schedule's dose amounts (daily schedules only).
 * 4. Units are never converted. If the stock unit, the dose unit, or a counted record's unit
 *    differ, the result is unavailable (`incompatible-units`).
 * 5. The result never goes below zero.
 */
export function estimateStock(input: EstimateStockInput): StockEstimate {
  const { medication, doseLogs, today } = input;
  const { stock } = medication;

  if (stock === null) return { available: false, reason: 'no-stock' };
  if (!isValidQuantity(stock.quantity, { allowZero: true })) {
    return { available: false, reason: 'invalid-data' };
  }
  if (medication.endDate !== null && compareLocalDates(medication.endDate, today) < 0) {
    return { available: false, reason: 'ended' };
  }

  const schedule = normalizeScheduleTimes(medication.scheduleTimes);
  if (schedule.length === 0) return { available: false, reason: 'no-schedule' };
  if (!unitsMatch(stock.unit, medication.doseUnit)) {
    return { available: false, reason: 'incompatible-units' };
  }

  const countedLogs = doseLogs.filter(
    (log) =>
      log.medicationId === medication.id &&
      log.status === 'taken' &&
      compareTimestamps(log.recordedAt, stock.asOf) >= 0,
  );
  if (countedLogs.some((log) => !unitsMatch(log.doseUnit, stock.unit))) {
    return { available: false, reason: 'incompatible-units' };
  }
  if (countedLogs.some((log) => !isValidQuantity(log.doseAmount, { allowZero: false }))) {
    return { available: false, reason: 'invalid-data' };
  }

  const consumed = sum(countedLogs.map((log) => toThousandths(log.doseAmount)));
  const dailyUse = sum(schedule.map((entry) => toThousandths(entry.doseAmount)));
  const remaining = Math.max(0, toThousandths(stock.quantity) - consumed);

  return {
    available: true,
    remaining: fromThousandths(remaining),
    unit: stock.unit,
    daysRemaining: Math.floor(remaining / dailyUse),
  };
}

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

/** True only for an available estimate that lasts fewer than `LOW_STOCK_THRESHOLD_DAYS` days. Unavailable is never "low". */
export function isLowStock(estimate: StockEstimate): boolean {
  return estimate.available && estimate.daysRemaining < LOW_STOCK_THRESHOLD_DAYS;
}

export type StockIssueCode = 'invalid-quantity' | 'invalid-unit';

export type StockValidation =
  { ok: true; stock: MedicationStock } | { ok: false; issues: StockIssueCode[] };

/**
 * Validates stock entered in a form and stamps it with the moment it was entered.
 * Rejects negative, non-finite or over-precise quantities and blank or over-long units.
 * Zero is a valid quantity ("I have none").
 */
export function buildMedicationStock(
  input: { quantity: number; unit: string },
  asOf: Timestamp,
): StockValidation {
  const unit = input.unit.trim();
  const issues: StockIssueCode[] = [];
  if (!isValidQuantity(input.quantity, { allowZero: true })) issues.push('invalid-quantity');
  if (unit === '' || unit.length > MAX_UNIT_LENGTH) issues.push('invalid-unit');
  return issues.length > 0
    ? { ok: false, issues }
    : { ok: true, stock: { quantity: input.quantity, unit, asOf } };
}
