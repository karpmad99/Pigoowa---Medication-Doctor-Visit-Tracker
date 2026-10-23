import type { MedicationStock } from '@/features/medications/types';
import type { Id } from '@/types/primitives';
import { compareTimestamps } from '@/utils/date';
import type { StockEvent } from '../types';

/**
 * What an event does to the estimate now, in the terms of the rule that decides it (PROJECT_SPEC
 * §7.6): an event counts when it is not reversed and was recorded at or after the stock's `asOf`.
 * - `counted`: it counts.
 * - `reversed`: it was reversed; it stays in the history and does not count.
 * - `before-count`: it is older than the last count of the stock, which already includes it.
 * - `not-tracked`: the medication has no stock now.
 */
export type StockEventState = 'counted' | 'reversed' | 'before-count' | 'not-tracked';

export interface StockHistoryRow {
  event: StockEvent;
  state: StockEventState;
}

export function stockEventState(event: StockEvent, stock: MedicationStock | null): StockEventState {
  if (event.reversedAt !== null) return 'reversed';
  if (stock === null) return 'not-tracked';
  return compareTimestamps(event.recordedAt, stock.asOf) >= 0 ? 'counted' : 'before-count';
}

/** The events of one medication, newest first, each with what it does now. Pure; the input is not changed. */
export function buildStockHistory(
  events: readonly StockEvent[],
  medicationId: Id,
  stock: MedicationStock | null,
): StockHistoryRow[] {
  return events
    .filter((event) => event.medicationId === medicationId)
    .toSorted(
      (a, b) =>
        compareTimestamps(b.recordedAt, a.recordedAt) || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0),
    )
    .map((event) => ({ event, state: stockEventState(event, stock) }));
}
