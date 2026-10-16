import type { ScheduledDose } from '../types';

export interface DaySummary {
  total: number;
  taken: number;
  skipped: number;
  /** Planned but with no record. Not "missed": the app only knows nothing was recorded. */
  unrecorded: number;
}

/** Counts a day's planned doses by status. */
export function summarizeDay(doses: readonly ScheduledDose[]): DaySummary {
  const summary: DaySummary = { total: doses.length, taken: 0, skipped: 0, unrecorded: 0 };
  for (const dose of doses) summary[dose.status] += 1;
  return summary;
}
