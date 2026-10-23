import type { Appointment } from '@/features/appointments/types';
import type { DoseLog, DoseSlot } from '@/features/doses/types';
import type { Medication, ScheduleTime } from '@/features/medications/types';
import type { StockEvent } from '@/features/stock/types';
import type { Id, LocalDate, Timestamp } from '@/types/primitives';
import { compareLocalDates, compareLocalTimes, compareTimestamps } from '@/utils/date';
import { RepositoryError, toRepositoryError } from '../errors';
import {
  validateAppointment,
  validateDoseLog,
  validateMedication,
  validateStockEvent,
  type Validated,
} from '../local/validation';
import type {
  AppointmentRepository,
  DoseLogRepository,
  MedicationRepository,
  Repositories,
  StockEventRepository,
} from '../repositories';
import type { PigoowaClient } from './client';
import {
  appointmentFromRow,
  appointmentToRow,
  doseLogFromRow,
  doseLogToRow,
  medicationFromRows,
  medicationToRow,
  scheduleTimeToRow,
  stockEventFromRow,
  stockEventToRow,
} from './mappers';
import { assertOk, toRepositoryErrorFromResponse, unwrap, type RestResponse } from './responses';

// The Supabase implementation of the repository interfaces (src/services/repositories.ts). It talks to the
// REST API with the signed-in user's session, so Row Level Security decides what each user can see and
// change: nothing here filters by user, and nothing here uses a privileged key (the client is created with
// the public key only, src/lib/supabaseClient.ts). Business rules stay out, exactly as in the local
// implementation (PROJECT_SPEC DEC-20); the same validators check what goes in and what comes out.
//
// Not atomic: PostgREST runs one statement per request, so an operation that spans two tables (a
// medication and its schedule times) is a short sequence of requests with a best-effort undo. A failed
// undo is reported (see `isRollbackFailure`), never hidden. Deleting a medication is ONE statement, and the
// database cascades to its history and stock events.

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** An id the database could possibly hold. Anything else cannot exist there (and would be a SQL type error). */
function isStoredId(id: string): boolean {
  return UUID_PATTERN.test(id);
}

function accept<T>(result: Validated<T>): T {
  if (!result.ok) {
    throw new RepositoryError('invalid-input', { detail: `invalid field: ${result.path}` });
  }
  return result.value;
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

const nameCollator = new Intl.Collator('pl');

/** PostgREST returns at most `max_rows` (1000 by default) per request, silently. Read page by page until the count is reached. */
const PAGE_SIZE = 1000;

async function selectAll<T>(
  page: (from: number, to: number) => PromiseLike<RestResponse<T[]>>,
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const response = await page(from, from + PAGE_SIZE - 1);
    const chunk = unwrap(response);
    rows.push(...chunk);
    const total = response.count ?? null;
    if (chunk.length === 0 || (total !== null && rows.length >= total)) return rows;
    if (total === null && chunk.length < PAGE_SIZE) return rows;
  }
}

/** Puts back what an operation had already changed. True when every step worked. */
async function undoAll(steps: (() => PromiseLike<RestResponse<unknown>>)[]): Promise<boolean> {
  let allWorked = true;
  for (const step of steps) {
    try {
      const response = await step();
      if (response.error !== null) allWorked = false;
    } catch {
      allWorked = false;
    }
  }
  return allWorked;
}

function failedAfterPartialWrite(error: unknown, restored: boolean): RepositoryError {
  return new RepositoryError(toRepositoryError(error).code, {
    cause: error,
    detail: restored ? 'rolled back' : 'rollback failed: data may be inconsistent',
  });
}

// ----- medications -----

function createMedicationRepository(client: PigoowaClient): MedicationRepository {
  async function readOne(id: Id): Promise<Medication | null> {
    const response = await client
      .from('medications')
      .select('*, medication_schedule_times(*)')
      .eq('id', id)
      .maybeSingle();
    if (response.error !== null) throw toRepositoryErrorFromResponse(response);
    const row = response.data;
    return row === null ? null : medicationFromRows(row, row.medication_schedule_times);
  }

  function scheduleKey(times: ScheduleTime[]): string {
    return JSON.stringify(
      [...times]
        .sort((a, b) => compareText(a.id, b.id))
        .map((time) => [time.id, time.timeOfDay, time.doseAmount]),
    );
  }

  return {
    list: async () => {
      const rows = await selectAll((from, to) =>
        client
          .from('medications')
          .select('*, medication_schedule_times(*)', { count: 'exact' })
          .order('id')
          .range(from, to),
      );
      return rows
        .map((row) => medicationFromRows(row, row.medication_schedule_times))
        .sort((a, b) => nameCollator.compare(a.name, b.name) || compareText(a.id, b.id));
    },

    get: async (id) => {
      if (!isStoredId(id)) throw new RepositoryError('not-found');
      const found = await readOne(id);
      if (found === null) throw new RepositoryError('not-found');
      return found;
    },

    create: async (input) => {
      const medication = accept(validateMedication(input));
      assertOk(await client.from('medications').insert(medicationToRow(medication)));
      if (medication.scheduleTimes.length === 0) return medication;
      const inserted = await client
        .from('medication_schedule_times')
        .insert(medication.scheduleTimes.map((time) => scheduleTimeToRow(medication.id, time)));
      if (inserted.error !== null) {
        // The medication exists without its schedule: take it away again rather than leave half of it.
        const restored = await undoAll([
          () => client.from('medications').delete().eq('id', medication.id),
        ]);
        throw failedAfterPartialWrite(toRepositoryErrorFromResponse(inserted), restored);
      }
      return medication;
    },

    update: async (input) => {
      const medication = accept(validateMedication(input));
      if (!isStoredId(medication.id)) throw new RepositoryError('not-found');
      const before = await readOne(medication.id);
      if (before === null) throw new RepositoryError('not-found');

      const updated = unwrap(
        await client
          .from('medications')
          .update(medicationToRow(medication))
          .eq('id', medication.id)
          .select('id'),
      );
      if (updated.length === 0) throw new RepositoryError('not-found');

      if (scheduleKey(before.scheduleTimes) === scheduleKey(medication.scheduleTimes)) {
        return medication;
      }
      // All rows are replaced (not merged): two rows may swap their times, which a row-by-row update
      // would refuse because of the unique key on (medication, time).
      const restoreMedicationRow = () =>
        client.from('medications').update(medicationToRow(before)).eq('id', medication.id);
      const undo = [
        () => client.from('medication_schedule_times').delete().eq('medication_id', medication.id),
        () =>
          client
            .from('medication_schedule_times')
            .insert(before.scheduleTimes.map((time) => scheduleTimeToRow(medication.id, time))),
        restoreMedicationRow,
      ];
      const removed = await client
        .from('medication_schedule_times')
        .delete()
        .eq('medication_id', medication.id);
      if (removed.error !== null) {
        // Nothing but possibly the medication row itself changed.
        const restored = await undoAll([restoreMedicationRow]);
        throw failedAfterPartialWrite(toRepositoryErrorFromResponse(removed), restored);
      }
      if (medication.scheduleTimes.length > 0) {
        const inserted = await client
          .from('medication_schedule_times')
          .insert(medication.scheduleTimes.map((time) => scheduleTimeToRow(medication.id, time)));
        if (inserted.error !== null) {
          const restored = await undoAll(undo);
          throw failedAfterPartialWrite(toRepositoryErrorFromResponse(inserted), restored);
        }
      }
      return medication;
    },

    remove: async (id) => {
      if (!isStoredId(id)) throw new RepositoryError('not-found');
      const deleted = unwrap(await client.from('medications').delete().eq('id', id).select('id'));
      if (deleted.length === 0) throw new RepositoryError('not-found');
    },
  };
}

// ----- intake records -----

function compareDoseLogs(a: DoseLog, b: DoseLog): number {
  return (
    compareLocalDates(a.scheduledDate, b.scheduledDate) ||
    compareLocalTimes(a.scheduledTime, b.scheduledTime) ||
    compareText(a.medicationId, b.medicationId) ||
    compareText(a.id, b.id)
  );
}

function createDoseLogRepository(client: PigoowaClient): DoseLogRepository {
  return {
    listByDateRange: async (from: LocalDate, to: LocalDate) => {
      if (compareLocalDates(from, to) > 0) {
        throw new RepositoryError('invalid-input', { detail: 'range start is after its end' });
      }
      const rows = await selectAll((start, end) =>
        client
          .from('dose_logs')
          .select('*', { count: 'exact' })
          .gte('scheduled_date', from)
          .lte('scheduled_date', to)
          .order('id')
          .range(start, end),
      );
      return rows.map(doseLogFromRow).sort(compareDoseLogs);
    },

    upsert: async (input) => {
      const log = accept(validateDoseLog(input));
      if (!isStoredId(log.medicationId)) throw new RepositoryError('missing-reference');
      // Inserts, or replaces the record with the same id. A different record in the same slot violates the
      // unique key and is reported as `duplicate-slot` instead of being overwritten.
      assertOk(await client.from('dose_logs').upsert(doseLogToRow(log), { onConflict: 'id' }));
      return log;
    },

    countForMedication: async (medicationId: Id) => {
      if (!isStoredId(medicationId)) return 0;
      const response = await client
        .from('dose_logs')
        .select('id', { count: 'exact', head: true })
        .eq('medication_id', medicationId);
      if (response.error !== null) throw toRepositoryErrorFromResponse(response);
      return response.count ?? 0;
    },

    remove: async (slot: DoseSlot) => {
      if (!isStoredId(slot.medicationId)) return;
      // Removing a slot that has no record succeeds and does nothing, so undo can be repeated.
      assertOk(
        await client
          .from('dose_logs')
          .delete()
          .eq('medication_id', slot.medicationId)
          .eq('scheduled_date', slot.date)
          .eq('scheduled_time', slot.time),
      );
    },
  };
}

// ----- appointments -----

function compareAppointments(a: Appointment, b: Appointment): number {
  return compareTimestamps(a.scheduledAt, b.scheduledAt) || compareText(a.id, b.id);
}

function createAppointmentRepository(client: PigoowaClient): AppointmentRepository {
  return {
    list: async () => {
      const rows = await selectAll((from, to) =>
        client.from('appointments').select('*', { count: 'exact' }).order('id').range(from, to),
      );
      return rows.map(appointmentFromRow).sort(compareAppointments);
    },

    get: async (id) => {
      if (!isStoredId(id)) throw new RepositoryError('not-found');
      const response = await client.from('appointments').select('*').eq('id', id).maybeSingle();
      if (response.error !== null) throw toRepositoryErrorFromResponse(response);
      if (response.data === null) throw new RepositoryError('not-found');
      return appointmentFromRow(response.data);
    },

    create: async (input) => {
      const appointment = accept(validateAppointment(input));
      assertOk(await client.from('appointments').insert(appointmentToRow(appointment)));
      return appointment;
    },

    update: async (input) => {
      const appointment = accept(validateAppointment(input));
      if (!isStoredId(appointment.id)) throw new RepositoryError('not-found');
      const updated = unwrap(
        await client
          .from('appointments')
          .update(appointmentToRow(appointment))
          .eq('id', appointment.id)
          .select('id'),
      );
      if (updated.length === 0) throw new RepositoryError('not-found');
      return appointment;
    },

    remove: async (id) => {
      if (!isStoredId(id)) throw new RepositoryError('not-found');
      const deleted = unwrap(await client.from('appointments').delete().eq('id', id).select('id'));
      if (deleted.length === 0) throw new RepositoryError('not-found');
    },
  };
}

// ----- stock events -----

function compareStockEvents(a: StockEvent, b: StockEvent): number {
  return compareTimestamps(a.recordedAt, b.recordedAt) || compareText(a.id, b.id);
}

function createStockEventRepository(client: PigoowaClient): StockEventRepository {
  return {
    list: async () => {
      const rows = await selectAll((from, to) =>
        client.from('stock_events').select('*', { count: 'exact' }).order('id').range(from, to),
      );
      return rows.map(stockEventFromRow).sort(compareStockEvents);
    },

    listForMedication: async (medicationId: Id) => {
      if (!isStoredId(medicationId)) return [];
      const rows = await selectAll((from, to) =>
        client
          .from('stock_events')
          .select('*', { count: 'exact' })
          .eq('medication_id', medicationId)
          .order('id')
          .range(from, to),
      );
      return rows.map(stockEventFromRow).sort(compareStockEvents);
    },

    append: async (input) => {
      const event = accept(validateStockEvent(input));
      if (!isStoredId(event.medicationId)) throw new RepositoryError('missing-reference');
      // The primary key makes a repeated id (a double submit) fail as `duplicate-id`: one row at most.
      assertOk(await client.from('stock_events').insert(stockEventToRow(event)));
      return event;
    },

    reverse: async (id: Id, reversedAt: Timestamp) => {
      if (!isStoredId(id)) throw new RepositoryError('not-found');
      const found = await client.from('stock_events').select('*').eq('id', id).maybeSingle();
      if (found.error !== null) throw toRepositoryErrorFromResponse(found);
      if (found.data === null) throw new RepositoryError('not-found');
      const current = stockEventFromRow(found.data);
      // Already reversed: nothing changes, not even the moment.
      if (current.reversedAt !== null) return current;
      const reversed = accept(validateStockEvent({ ...current, reversedAt }));
      // `is null` makes a reversal made meanwhile (another tab) win: this one then changes nothing.
      const updated = unwrap(
        await client
          .from('stock_events')
          .update({ reversed_at: reversed.reversedAt })
          .eq('id', id)
          .is('reversed_at', null)
          .select('*'),
      );
      const [row] = updated;
      if (row === undefined) {
        const again = await client.from('stock_events').select('*').eq('id', id).maybeSingle();
        if (again.error !== null) throw toRepositoryErrorFromResponse(again);
        if (again.data === null) throw new RepositoryError('not-found');
        return stockEventFromRow(again.data);
      }
      return stockEventFromRow(row);
    },

    countForMedication: async (medicationId: Id) => {
      if (!isStoredId(medicationId)) return 0;
      const response = await client
        .from('stock_events')
        .select('id', { count: 'exact', head: true })
        .eq('medication_id', medicationId);
      if (response.error !== null) throw toRepositoryErrorFromResponse(response);
      return response.count ?? 0;
    },
  };
}

export interface SupabaseRepositoryOptions {
  /**
   * Called when an operation failed because there is no valid session (`not-signed-in`), so the application
   * can send the user to sign in again. The error is still thrown to the caller.
   */
  onSessionLost?: () => void;
}

/** Wraps every method so that a `not-signed-in` failure is announced before it is rethrown. */
function watchSession<T extends object>(repository: T, onSessionLost: () => void): T {
  const wrapped: Record<string, unknown> = {};
  for (const [name, method] of Object.entries(repository)) {
    wrapped[name] =
      typeof method === 'function'
        ? async (...args: unknown[]) => {
            try {
              return await (method as (...a: unknown[]) => Promise<unknown>)(...args);
            } catch (error) {
              if (error instanceof RepositoryError && error.code === 'not-signed-in') {
                onSessionLost();
              }
              throw error;
            }
          }
        : method;
  }
  return wrapped as T;
}

/** The repositories of one signed-in user. The client must hold that user's session (or none: then every call fails with `not-signed-in`). */
export function createSupabaseRepositories(
  client: PigoowaClient,
  options: SupabaseRepositoryOptions = {},
): Repositories {
  const { onSessionLost } = options;
  const guard = <T extends object>(repository: T): T =>
    onSessionLost === undefined ? repository : watchSession(repository, onSessionLost);
  return {
    medications: guard(createMedicationRepository(client)),
    doseLogs: guard(createDoseLogRepository(client)),
    appointments: guard(createAppointmentRepository(client)),
    stockEvents: guard(createStockEventRepository(client)),
  };
}
