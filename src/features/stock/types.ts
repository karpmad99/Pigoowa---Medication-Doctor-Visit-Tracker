import type { Id, Timestamp } from '@/types/primitives';

/** What changed the stock: more arrived (`refill`), or some was thrown away (`waste`, stage F7). */
export type StockEventKind = 'refill' | 'waste';

/**
 * One change of a medication's stock, recorded as a FACT in an append-only ledger (PROJECT_SPEC
 * DEC-47). The stock itself stays the snapshot on the medication; an event never edits it. An
 * event is never deleted by the application: reversing it sets `reversedAt`, so it stays in the
 * history but no longer counts.
 */
export interface StockEvent {
  id: Id;
  medicationId: Id;
  kind: StockEventKind;
  /** > 0, at most 3 decimals. In `unit`. */
  amount: number;
  /** The unit of the stock when the event was recorded. Events are never converted. */
  unit: string;
  /** The moment of entry. Events are not back-dated in the first version. */
  recordedAt: Timestamp;
  /** Belongs to the event (at most `STOCK_EVENT_NOTE_MAX` characters). */
  note: string | null;
  /** `null` while the event counts; the moment it was reversed otherwise. */
  reversedAt: Timestamp | null;
}
