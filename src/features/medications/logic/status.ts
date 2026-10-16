import type { LocalDate } from '@/types/primitives';
import { compareLocalDates } from '@/utils/date';
import type { Medication } from '../types';

/**
 * Where a medication stands today, for labelling it in lists:
 * - `ended`: its end date (the last day of use) is before today;
 * - `planned`: its start date is still ahead;
 * - `active`: otherwise.
 * Ending a medication never deletes anything: its intake history stays.
 */
export type MedicationStatus = 'planned' | 'active' | 'ended';

export function getMedicationStatus(medication: Medication, today: LocalDate): MedicationStatus {
  if (medication.endDate !== null && compareLocalDates(medication.endDate, today) < 0) {
    return 'ended';
  }
  return compareLocalDates(medication.startDate, today) > 0 ? 'planned' : 'active';
}
