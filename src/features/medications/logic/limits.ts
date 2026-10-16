import { MAX_UNIT_LENGTH } from './stock';

/** Field limits for a medication. They mirror the database columns (docs/DATABASE.md). */
export const MEDICATION_LIMITS = {
  name: 120,
  doseUnit: MAX_UNIT_LENGTH,
  notes: 1000,
} as const;
