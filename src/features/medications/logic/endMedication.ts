import type { LocalDate, Timestamp } from '@/types/primitives';
import { compareLocalDates } from '@/utils/date';
import type { Medication } from '../types';

export type EndMedicationResult =
  | { ok: true; medication: Medication }
  /** The last day of use cannot be before the day the medication was started. */
  | { ok: false; error: 'before-start' };

/**
 * Ends a medication by setting its end date, the last day it is still planned. This is the
 * preferred way to stop a medication (PROJECT_SPEC DEC-09): nothing is deleted. From the day
 * after `endDate` no doses are planned any more (`isMedicationActiveOn`), while every intake
 * record, with the amount and unit it was recorded with, stays as it was.
 */
export function endMedication(
  medication: Medication,
  endDate: LocalDate,
  now: Timestamp,
): EndMedicationResult {
  if (compareLocalDates(endDate, medication.startDate) < 0) {
    return { ok: false, error: 'before-start' };
  }
  return { ok: true, medication: { ...medication, endDate, updatedAt: now } };
}
