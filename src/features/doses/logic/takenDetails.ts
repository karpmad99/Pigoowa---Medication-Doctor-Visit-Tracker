import { isValidQuantity, parseQuantityInput, toThousandths } from '@/utils/quantity';
import { DOSE_NOTE_MAX } from './limits';

export type TakenDetailsIssue = 'amount-invalid' | 'note-too-long';

export type ParsedTakenDetails =
  | {
      ok: true;
      /** The amount actually taken, as a number. */
      takenAmount: number;
      /** Trimmed; `null` when there is none. */
      note: string | null;
    }
  | { ok: false; issues: TakenDetailsIssue[] };

/**
 * Reads what was typed about a taken dose. The amount is any quantity above zero with at most
 * three decimals: it may be LARGER or SMALLER than the plan, and a difference from the plan is
 * never a reason to refuse it. An empty amount is refused (it is not "zero" and not "as planned":
 * the person types what they took). The note is trimmed and may be empty.
 * Pure; the plan is not even a parameter, so it cannot influence what is accepted.
 */
export function parseTakenDetails(input: {
  amountText: string;
  noteText: string;
}): ParsedTakenDetails {
  const issues: TakenDetailsIssue[] = [];
  const amount = parseQuantityInput(input.amountText);
  if (amount === null || !isValidQuantity(amount, { allowZero: false })) {
    issues.push('amount-invalid');
  }
  const note = input.noteText.trim();
  if (note.length > DOSE_NOTE_MAX) issues.push('note-too-long');
  if (issues.length > 0 || amount === null) return { ok: false, issues };
  return { ok: true, takenAmount: amount, note: note === '' ? null : note };
}

/** True when the amount taken is the planned one, by whole thousandths: then "as planned" is stored (no field). */
export function isPlannedAmount(takenAmount: number, plannedAmount: number): boolean {
  return toThousandths(takenAmount) === toThousandths(plannedAmount);
}
