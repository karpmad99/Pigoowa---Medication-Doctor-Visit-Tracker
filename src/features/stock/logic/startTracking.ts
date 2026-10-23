import type { Medication, StockBasis } from '@/features/medications/types';
import { getMedicationStatus } from '@/features/medications/logic/status';
import { buildMedicationStock } from '@/features/medications/logic/stock';
import type { LocalDate, Timestamp } from '@/types/primitives';
import { parseQuantityInput } from '@/utils/quantity';

export type StartTrackingIssueCode =
  /** Neither "counted" nor "new package" was chosen: nothing is created. */
  | 'mode-required'
  /** The field is empty. An empty field is NEVER zero. */
  | 'quantity-required'
  | 'quantity-invalid'
  /** A new package of size zero is not a package. (A counted zero is allowed.) */
  | 'package-size-zero'
  | 'already-tracking'
  | 'medication-ended';

export interface StartTrackingInput {
  medication: Medication;
  /** The explicit choice of DEC-52; `null` while the person has chosen neither. */
  mode: StockBasis | null;
  /** As typed. */
  quantityText: string;
  now: Timestamp;
  today: LocalDate;
}

export type StartTrackingResult =
  { ok: true; medication: Medication } | { ok: false; issues: StartTrackingIssueCode[] };

/**
 * The medication with a stock baseline, for a medication that has none (PROJECT_SPEC DEC-52).
 * - "counted": the typed quantity is what the person has now; a typed 0 is allowed.
 * - "new-package": the typed quantity is the size of a new package, above zero; what was left
 *   from before is not counted, and the screens say so (`basis` only changes the wording).
 * Nothing is invented: with no choice, an empty field or an invalid number nothing is created, and
 * the estimate stays unavailable. The unit is the medication's dose unit; nothing is converted.
 * Pure: the caller stores the result.
 */
export function buildStartTracking(input: StartTrackingInput): StartTrackingResult {
  const { medication, mode, quantityText, now, today } = input;
  const issues: StartTrackingIssueCode[] = [];

  if (medication.stock !== null) issues.push('already-tracking');
  if (getMedicationStatus(medication, today) === 'ended') issues.push('medication-ended');
  if (mode === null) issues.push('mode-required');

  let quantity: number | null = null;
  if (quantityText.trim() === '') {
    issues.push('quantity-required');
  } else {
    quantity = parseQuantityInput(quantityText);
    if (quantity === null) issues.push('quantity-invalid');
    else if (mode === 'new-package' && quantity === 0) issues.push('package-size-zero');
  }

  if (issues.length > 0 || mode === null || quantity === null) return { ok: false, issues };

  const built = buildMedicationStock({ quantity, unit: medication.doseUnit }, now);
  if (!built.ok) return { ok: false, issues: ['quantity-invalid'] };
  return {
    ok: true,
    medication: {
      ...medication,
      stock: { ...built.stock, basis: mode },
      updatedAt: now,
    },
  };
}
