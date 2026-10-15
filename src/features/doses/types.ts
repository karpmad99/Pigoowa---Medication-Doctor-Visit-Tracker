import type { Id, LocalDate, LocalTime, Timestamp } from '@/types/primitives';

/** What the user recorded for a dose. */
export type RecordedDoseStatus = 'taken' | 'skipped';

/** A dose's state: recorded as taken or skipped, or not recorded at all. */
export type DoseStatus = RecordedDoseStatus | 'unrecorded';

/**
 * Identifies one planned administration: a medication, a calendar day and a time of day.
 * This triple is the uniqueness rule for intake records (at most one record per slot).
 */
export interface DoseSlot {
  medicationId: Id;
  date: LocalDate;
  time: LocalTime;
}

/**
 * Intake record: a FACT. It states what the user recorded for one slot. It exists only after
 * the user acted; a planned dose without a record is "unrecorded", never assumed taken.
 */
export interface DoseLog {
  id: Id;
  medicationId: Id;
  scheduledDate: LocalDate;
  scheduledTime: LocalTime;
  status: RecordedDoseStatus;
  /** Amount at the moment of recording. Later schedule edits never change it. */
  doseAmount: number;
  /** Unit at the moment of recording. Later edits never change it. */
  doseUnit: string;
  /** When the user recorded (or last changed) it. */
  recordedAt: Timestamp;
}

/** A planned dose for one day. DERIVED from schedule rules, never stored. */
export interface ScheduledDose extends DoseSlot {
  medicationName: string;
  doseAmount: number;
  doseUnit: string;
  status: DoseStatus;
  /** The matching intake record, or `null` while unrecorded. */
  log: DoseLog | null;
}
