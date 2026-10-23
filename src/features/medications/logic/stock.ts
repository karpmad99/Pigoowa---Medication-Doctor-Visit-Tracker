import type { LocalDate, Timestamp } from '@/types/primitives';
import { compareLocalDates, compareTimestamps } from '@/utils/date';
import { fromThousandths, isValidQuantity, toThousandths } from '@/utils/quantity';
import type { DoseLog } from '@/features/doses/types';
import type { StockEvent } from '@/features/stock/types';
import type { LowStockThreshold, Medication, MedicationStock } from '../types';
import { normalizeScheduleTimes } from './schedule';
import { unitsMatch } from './units';

/** Stock lasting fewer days than this is highlighted in the UI. A display threshold, not medical guidance. */
export const LOW_STOCK_THRESHOLD_DAYS = 7;

export const MAX_UNIT_LENGTH = 30;

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
  | {
      available: true;
      remaining: number;
      unit: string;
      daysRemaining: number;
      /**
       * Present (and true) only when the sum of the counted changes went below zero and the shown
       * amount was held at zero: the stock may have run out earlier than the records say.
       */
      wentBelowZero?: true;
    }
  | { available: false; reason: StockUnavailableReason };

export interface EstimateStockInput {
  medication: Medication;
  /** May contain records of other medications; only this medication's are used. */
  doseLogs: readonly DoseLog[];
  /**
   * The stock events (refills, waste), any medication's. Counted exactly like taken doses: those
   * not reversed and recorded at or after the stock's `asOf`. Omitted means none.
   */
  stockEvents?: readonly StockEvent[];
  today: LocalDate;
}

/**
 * Estimates how much of a medication is left and for how many days.
 *
 * Assumptions (also shown to the user):
 * 1. Stock is the quantity the user entered, in `stock.unit`, valid as of `stock.asOf`.
 * 2. Only records with status `taken`, recorded at or after `asOf`, reduce it, each by the amount
 *    actually taken (`takenAmount`) or, when none was recorded, the planned `doseAmount`; refills recorded
 *    at or after `asOf` (and not reversed) add to it, and waste (not reversed) reduces it. Skipped and
 *    unrecorded doses use nothing, so forgetting to record a dose makes the estimate optimistic.
 * 3. Daily use = the sum of the current schedule's dose amounts (daily schedules only).
 * 4. Units are never converted. If the stock unit, the dose unit, or a counted record's or
 *    event's unit differ, the result is unavailable (`incompatible-units`).
 * 5. The result never goes below zero.
 */
export function estimateStock(input: EstimateStockInput): StockEstimate {
  const { medication, doseLogs, today, stockEvents = [] } = input;
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
  // What a taken dose uses is the amount ACTUALLY taken when one was recorded, otherwise the plan.
  const amountOf = (log: DoseLog): number => log.takenAmount ?? log.doseAmount;
  if (countedLogs.some((log) => !isValidQuantity(amountOf(log), { allowZero: false }))) {
    return { available: false, reason: 'invalid-data' };
  }

  const countedEvents = stockEvents.filter(
    (event) =>
      event.medicationId === medication.id &&
      event.reversedAt === null &&
      compareTimestamps(event.recordedAt, stock.asOf) >= 0,
  );
  if (countedEvents.some((event) => !unitsMatch(event.unit, stock.unit))) {
    return { available: false, reason: 'incompatible-units' };
  }
  if (countedEvents.some((event) => !isValidQuantity(event.amount, { allowZero: false }))) {
    return { available: false, reason: 'invalid-data' };
  }

  const consumed = sum(countedLogs.map((log) => toThousandths(amountOf(log))));
  const added = sum(
    countedEvents
      .filter((event) => event.kind === 'refill')
      .map((event) => toThousandths(event.amount)),
  );
  const wasted = sum(
    countedEvents
      .filter((event) => event.kind === 'waste')
      .map((event) => toThousandths(event.amount)),
  );
  const dailyUse = sum(schedule.map((entry) => toThousandths(entry.doseAmount)));
  const total = toThousandths(stock.quantity) + added - wasted - consumed;
  const remaining = Math.max(0, total);

  return {
    available: true,
    remaining: fromThousandths(remaining),
    unit: stock.unit,
    // The days still use the PLANNED daily amount, not what was taken (PROJECT_SPEC §7.6).
    daysRemaining: Math.floor(remaining / dailyUse),
    ...(total < 0 ? { wentBelowZero: true as const } : {}),
  };
}

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

/**
 * True when the person's own threshold is used for this estimate: it is set, the estimate is
 * available, and the threshold is in the unit the stock is counted in. A threshold in another unit
 * is NOT applied and nothing is converted (DEC-46).
 */
export function thresholdApplies(
  threshold: LowStockThreshold | null | undefined,
  estimate: StockEstimate,
): boolean {
  return (
    threshold !== null &&
    threshold !== undefined &&
    estimate.available &&
    unitsMatch(threshold.unit, estimate.unit)
  );
}

/**
 * True when the stock is low (PROJECT_SPEC DEC-46):
 * - an own threshold that applies: the estimated amount is AT or below it (`remaining <= threshold`);
 * - otherwise the 7-day rule: fewer than `LOW_STOCK_THRESHOLD_DAYS` days.
 * An unavailable estimate is never "low". The comparison is done in whole thousandths.
 */
export function isLowStock(estimate: StockEstimate, threshold?: LowStockThreshold | null): boolean {
  if (!estimate.available) return false;
  if (thresholdApplies(threshold, estimate) && threshold !== null && threshold !== undefined) {
    return toThousandths(estimate.remaining) <= toThousandths(threshold.quantity);
  }
  return estimate.daysRemaining < LOW_STOCK_THRESHOLD_DAYS;
}

/** Which rule decides for this estimate: the own threshold, the 7-day rule, or none (no estimate). */
export function lowStockRule(
  estimate: StockEstimate,
  threshold?: LowStockThreshold | null,
): 'threshold' | 'days' | null {
  if (!estimate.available) return null;
  return thresholdApplies(threshold, estimate) ? 'threshold' : 'days';
}

/**
 * True when an own threshold is set but is in another unit than the stock, so it is not applied.
 * Decided from the stored stock, so it can be said even when the estimate itself is unavailable.
 */
export function thresholdUnitDiffers(medication: Medication): boolean {
  const { lowStockThreshold: threshold, stock } = medication;
  return (
    threshold !== null &&
    threshold !== undefined &&
    stock !== null &&
    !unitsMatch(threshold.unit, stock.unit)
  );
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
