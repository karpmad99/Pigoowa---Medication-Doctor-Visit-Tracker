import type { DoseLog } from '@/features/doses/types';
import type { StockEvent } from '@/features/stock/types';
import type { LocalDate } from '@/types/primitives';
import type { Medication } from '../types';
import { getMedicationStatus } from './status';
import { estimateStock, type StockEstimate } from './stock';

type AvailableEstimate = Extract<StockEstimate, { available: true }>;

export interface StockOverviewItem {
  medication: Medication;
  estimate: AvailableEstimate;
}

export interface StockOverview {
  /** Only medications whose estimate CAN be computed, soonest to run out first. */
  items: StockOverviewItem[];
  /**
   * How many medications that are still in use (or not started yet) have no estimate: no stock
   * entered, units that differ, no schedule, unusable data. Medications that have ended are not counted.
   */
  unavailableCount: number;
}

const nameCollator = new Intl.Collator('pl');

/**
 * The stock summary for the dashboard. It does no arithmetic of its own: every figure comes from
 * `estimateStock`. A medication without a computable estimate is never listed (and so never shown
 * as "0" or as low); it only adds to `unavailableCount`. Order: fewest days of stock first, then
 * by name (Polish collation) and id, so the list is always the same for the same data.
 */
export function summarizeStock(input: {
  medications: readonly Medication[];
  doseLogs: readonly DoseLog[];
  /** The stock events (refills, waste); omitted means none. */
  stockEvents?: readonly StockEvent[];
  today: LocalDate;
}): StockOverview {
  const { medications, doseLogs, stockEvents, today } = input;
  const items: StockOverviewItem[] = [];
  let unavailableCount = 0;

  for (const medication of medications) {
    // An ended medication has nothing to estimate and nothing to warn about. This is decided by the
    // medication's status, not by the estimate's reason: without stock the estimate says "no
    // stock" before it says "ended".
    if (getMedicationStatus(medication, today) === 'ended') continue;
    const estimate = estimateStock({ medication, doseLogs, stockEvents, today });
    if (estimate.available) items.push({ medication, estimate });
    else unavailableCount += 1;
  }

  items.sort(
    (a, b) =>
      a.estimate.daysRemaining - b.estimate.daysRemaining ||
      nameCollator.compare(a.medication.name, b.medication.name) ||
      compareText(a.medication.id, b.medication.id),
  );
  return { items, unavailableCount };
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
