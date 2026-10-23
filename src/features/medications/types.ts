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
/**
 * How the stock came to be (PROJECT_SPEC DEC-52). Absent means `counted`, so data saved earlier is
 * unchanged. It is not used in the formula: it only changes what the screens say.
 * - `counted`: the person counted what they have.
 * - `new-package`: the stock is the size of a new package; what was left before is not counted.
 */
export type StockBasis = 'counted' | 'new-package';

export interface MedicationStock {
  /** >= 0. Zero means "none left" and is different from having no stock information. */
  quantity: number;
  unit: string;
  asOf: Timestamp;
  basis?: StockBasis;
}

/** What the product is, as printed on the package. It selects the unit lists of the form and nothing else. */
export type DosageForm =
  | 'tablet'
  | 'capsule'
  | 'liquid'
  | 'drops'
  | 'injection'
  | 'sachet'
  | 'patch'
  | 'suppository'
  | 'inhaler'
  | 'other';

/** The strength of a product ("500 mg"). Information only: never a dose, a stock unit or part of a calculation. */
export interface MedicationStrength {
  /** > 0, at most 3 decimals. */
  value: number;
  /** One of `STRENGTH_UNITS`. */
  unit: string;
}

/**
 * The person's own warning level for the stock, in the unit it was set in (stored next to the
 * quantity, like the stock's own unit, so a later change of unit cannot reinterpret an old number).
 */
export interface LowStockThreshold {
  /** >= 0, at most 3 decimals. */
  quantity: number;
  unit: string;
}

export interface Medication {
  id: Id;
  name: string;
  /** Free text such as "tabletka", "ml", "mg". Units are never converted into each other. */
  doseUnit: string;
  /**
   * The form of the product. Absent on medications saved before it existed and on those where it
   * was never chosen: it is never filled in for the user. It only decides which units the form offers.
   */
  dosageForm?: DosageForm;
  /** Absent or `null` when not given. Information only (DEC-45): no calculation reads it. */
  strength?: MedicationStrength | null;
  /**
   * Absent or `null` when there is no own threshold: then the 7-day rule applies (DEC-46). Only
   * meaningful together with a stock, in the stock's unit; in another unit it is not applied.
   */
  lowStockThreshold?: LowStockThreshold | null;
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
