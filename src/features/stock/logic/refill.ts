import type { Medication } from '@/features/medications/types';
import { getMedicationStatus } from '@/features/medications/logic/status';
import type { Id, LocalDate, Timestamp } from '@/types/primitives';
import { isValidQuantity, parseQuantityInput } from '@/utils/quantity';
import type { StockEvent, StockEventKind } from '../types';
import { STOCK_EVENT_NOTE_MAX } from './limits';

export type RefillIssueCode =
  /** The amount is empty, not a number, not above zero, or has more than three decimals. */
  | 'amount-invalid'
  | 'note-too-long'
  /** The medication has no stock to add to (PROJECT_SPEC DEC-52): tracking must be started first. */
  | 'no-baseline'
  /** An ended medication gets no stock changes (decided in F6, kept for waste in F7). */
  | 'medication-ended';

export interface RefillIssue {
  field: 'amount' | 'note' | 'medication';
  code: RefillIssueCode;
}

export type RefillAvailability = 'available' | 'no-baseline' | 'ended';

/**
 * Whether a stock change (a refill, or a waste event) can be recorded for this medication at all,
 * so the screens can offer or explain it. Both kinds need a stock to change (a baseline, DEC-52)
 * and neither is offered for an ended medication.
 */
export function refillAvailability(medication: Medication, today: LocalDate): RefillAvailability {
  if (getMedicationStatus(medication, today) === 'ended') return 'ended';
  return medication.stock === null ? 'no-baseline' : 'available';
}

export interface BuildRefillInput {
  medication: Medication;
  /** As typed ("30", "0,5"). */
  amountText: string;
  noteText: string;
  /** Created when the dialog was opened: a second submit with it can never record a second event. */
  id: Id;
  now: Timestamp;
  today: LocalDate;
}

export type BuildRefillResult =
  { ok: true; event: StockEvent } | { ok: false; issues: RefillIssue[] };

/** The same input and result for a waste event. */
export type BuildWasteInput = BuildRefillInput;
export type BuildWasteResult = BuildRefillResult;

/**
 * A refill event from what was typed. Pure: it creates nothing and stores nothing.
 * - It needs a stock to add to (a baseline) and uses ITS unit: the amount is never converted, and
 *   there is no unit to choose.
 * - The amount must be above zero (at most three decimals). Zero or an empty field is refused.
 * - It is recorded at `now`: no back-dating in the first version.
 * - The note belongs to the event (at most `STOCK_EVENT_NOTE_MAX` characters after trimming).
 */
export function buildRefill(input: BuildRefillInput): BuildRefillResult {
  return buildStockChange('refill', input);
}

/**
 * A waste event (wasted, dropped or lost medicine, PROJECT_SPEC F-7) from what was typed. The same
 * rules as a refill, by the same code: a stock to change, in ITS unit, an amount above zero, the
 * moment of the confirmation, a note that belongs to the event. It is NOT a dose: it has no slot,
 * marks nothing as taken or skipped and touches no schedule. It may exceed the estimate (an
 * estimate must not block a fact): the estimate is then shown as used up and the dialog warns.
 */
export function buildWaste(input: BuildWasteInput): BuildWasteResult {
  return buildStockChange('waste', input);
}

function buildStockChange(kind: StockEventKind, input: BuildRefillInput): BuildRefillResult {
  const { medication, amountText, noteText, id, now, today } = input;
  const issues: RefillIssue[] = [];

  const availability = refillAvailability(medication, today);
  if (availability === 'ended') issues.push({ field: 'medication', code: 'medication-ended' });
  if (availability === 'no-baseline') issues.push({ field: 'medication', code: 'no-baseline' });

  const amount = parseQuantityInput(amountText);
  if (amount === null || !isValidQuantity(amount, { allowZero: false })) {
    issues.push({ field: 'amount', code: 'amount-invalid' });
  }
  const note = noteText.trim();
  if (note.length > STOCK_EVENT_NOTE_MAX) issues.push({ field: 'note', code: 'note-too-long' });

  if (issues.length > 0 || medication.stock === null || amount === null) {
    return { ok: false, issues };
  }
  return {
    ok: true,
    event: {
      id,
      medicationId: medication.id,
      kind,
      amount,
      unit: medication.stock.unit,
      recordedAt: now,
      note: note === '' ? null : note,
      reversedAt: null,
    },
  };
}
