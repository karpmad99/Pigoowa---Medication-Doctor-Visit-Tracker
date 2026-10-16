import type { Appointment } from '@/features/appointments/types';
import type { DoseLog, DoseSlot } from '@/features/doses/types';
import type { Medication } from '@/features/medications/types';
import type { Id, LocalDate } from '@/types/primitives';
import type { Clock } from '@/utils/clock';

// The contract between the application and wherever data lives. The UI and the data hooks know
// only these interfaces. Today the implementation keeps data in the browser (`./local`); stage 11
// adds a Supabase one that must pass the same contract tests (`./contract`).
//
// Rules shared by all repositories:
// - Every method is async and fails by rejecting with a `RepositoryError` (see ./errors).
// - Callers supply ids and timestamps (created with `createId()` and the clock), exactly as the
//   Stage 2 domain functions expect. Repositories store what they are given after validating it;
//   they contain no business rules.
// - Returned objects are copies. Changing one never changes what is stored.
// - A repository never "fixes" or silently overwrites data it cannot understand.

export interface MedicationRepository {
  /** All medications, ordered by name (Polish alphabet), then id. */
  list(): Promise<Medication[]>;
  /** Rejects with `not-found` if there is no such medication. */
  get(id: Id): Promise<Medication>;
  /** Rejects with `duplicate-id` if the id is taken, `invalid-input` if the medication is invalid. */
  create(medication: Medication): Promise<Medication>;
  /** Replaces the stored medication with the same id. Intake history is not touched. Rejects with `not-found`. */
  update(medication: Medication): Promise<Medication>;
  /**
   * Permanently deletes the medication AND its intake history (PROJECT_SPEC DEC-09). Ending a
   * medication with an end date, via `update`, is the way to keep the history. Rejects with `not-found`.
   */
  remove(id: Id): Promise<void>;
}

export interface DoseLogRepository {
  /** Records whose scheduled date lies in [from, to], both inclusive, ordered by date, time, medication id, id. */
  listByDateRange(from: LocalDate, to: LocalDate): Promise<DoseLog[]>;
  /**
   * Stores the record: inserts it, or replaces the record with the same id. There is at most one
   * record per slot (medication, date, time): a different record already in that slot rejects with
   * `duplicate-slot` instead of being overwritten. The medication must exist (`missing-reference`).
   */
  upsert(log: DoseLog): Promise<DoseLog>;
  /** Removes the record in this slot. Removing a slot that has no record succeeds and does nothing (undo is repeatable). */
  remove(slot: DoseSlot): Promise<void>;
}

export interface AppointmentRepository {
  /** All appointments, ordered by date and time, then id. */
  list(): Promise<Appointment[]>;
  /** Rejects with `not-found`. */
  get(id: Id): Promise<Appointment>;
  /** Rejects with `duplicate-id` or `invalid-input`. */
  create(appointment: Appointment): Promise<Appointment>;
  /** Replaces the appointment with the same id (this is also how its status changes). Rejects with `not-found`. */
  update(appointment: Appointment): Promise<Appointment>;
  /** Rejects with `not-found`. */
  remove(id: Id): Promise<void>;
}

export interface Repositories {
  medications: MedicationRepository;
  doseLogs: DoseLogRepository;
  appointments: AppointmentRepository;
}

/**
 * Explicit, never automatic, actions for filling storage with the fictional demo data
 * (src/services/demo). Reading or writing ordinary data never loads or resets anything.
 */
export interface DemoDataControls {
  /** Fills EMPTY storage with demo data. Rejects with `demo-data-not-empty` if anything is stored. */
  loadDemoData(): Promise<void>;
  /**
   * Replaces everything with demo data. The previous contents, even if corrupted, are first copied
   * to a backup (one slot: the most recent previous state). If the backup cannot be written,
   * nothing is changed.
   */
  resetDemoData(): Promise<void>;
}

/** Everything the application needs from the outside world, supplied once at the top (see ServicesProvider). */
export interface AppServices {
  clock: Clock;
  /** IANA time zone used to decide what "today" is (PROJECT_SPEC DEC-10). */
  timeZone: string;
  createId: () => Id;
  repositories: Repositories;
  demoData: DemoDataControls;
}
