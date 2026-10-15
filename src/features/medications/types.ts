import type { Id, LocalDate, LocalTime, Timestamp } from '@/types/primitives';

/** One administration time of the daily schedule, with its own dose amount. Part of the schedule *rule*. */
export interface ScheduleTime {
  id: Id;
  timeOfDay: LocalTime;
  /** In the medication's `doseUnit`. Must be > 0. */
  doseAmount: number;
}

/**
 * How much of a medication the user said they have, valid as of a moment.
 * `unit` is stored explicitly (not assumed to be the dose unit) so that changing the
 * medication's dose unit later can never silently reinterpret an old quantity.
 */
export interface MedicationStock {
  /** >= 0. Zero means "none left" and is different from having no stock information. */
  quantity: number;
  unit: string;
  asOf: Timestamp;
}

export interface Medication {
  id: Id;
  name: string;
  /** Free text such as "tabletka", "ml", "mg". Units are never converted into each other. */
  doseUnit: string;
  notes: string | null;
  startDate: LocalDate;
  /** Last day of use (inclusive). Ending a medication sets this; history is kept. */
  endDate: LocalDate | null;
  /** Doses are generated only from this date on, so editing the schedule cannot rewrite the past. */
  scheduleEffectiveFrom: LocalDate;
  /** The daily schedule rule. */
  scheduleTimes: ScheduleTime[];
  stock: MedicationStock | null;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}
