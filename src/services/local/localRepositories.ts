import type { Appointment } from '@/features/appointments/types';
import type { DoseLog, DoseSlot } from '@/features/doses/types';
import { doseLogSlot, doseSlotKey } from '@/features/doses/logic/slots';
import type { StockEvent } from '@/features/stock/types';
import type { Id, LocalDate, Timestamp } from '@/types/primitives';
import { compareLocalDates, compareLocalTimes, compareTimestamps } from '@/utils/date';
import { RepositoryError, toRepositoryError } from '../errors';
import type {
  AppointmentRepository,
  DoseLogRepository,
  MedicationRepository,
  Repositories,
  StockEventRepository,
} from '../repositories';
import { assertWritable, readCollection, restoreRaw, writeCollection } from './collection';
import {
  appointmentCollection,
  doseLogCollection,
  medicationCollection,
  stockEventCollection,
} from './collections';
import type { KeyValueStorage } from './storage';
import type { Validated } from './validation';
import {
  validateAppointment,
  validateDoseLog,
  validateMedication,
  validateStockEvent,
} from './validation';

// Every operation reads the CURRENT stored state, changes it, and writes it back, all in one
// synchronous step with nothing awaited in between. So within this tab operations cannot
// interleave, nothing is cached that could go stale, and records an operation did not mean to
// touch are written back exactly as they were read. (Other browser tabs are not coordinated:
// the last write wins.) A collection that is still in the old storage format (version 1) can be
// read but not written: see `assertWritable` and ./migration.ts.

/** Runs a synchronous operation and turns its result or failure into a Promise of the right shape. */
function run<T>(operation: () => T): Promise<T> {
  try {
    return Promise.resolve(operation());
  } catch (error) {
    return Promise.reject(toRepositoryError(error));
  }
}

function accept<T>(result: Validated<T>): T {
  if (!result.ok) {
    throw new RepositoryError('invalid-input', { detail: `invalid field: ${result.path}` });
  }
  return result.value;
}

const nameCollator = new Intl.Collator('pl');

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function createMedicationRepository(storage: KeyValueStorage): MedicationRepository {
  return {
    list: () =>
      run(() =>
        readCollection(storage, medicationCollection).items.sort(
          (a, b) => nameCollator.compare(a.name, b.name) || compareText(a.id, b.id),
        ),
      ),

    get: (id) =>
      run(() => {
        const found = readCollection(storage, medicationCollection).items.find(
          (medication) => medication.id === id,
        );
        if (!found) throw new RepositoryError('not-found');
        return found;
      }),

    create: (input) =>
      run(() => {
        const medication = accept(validateMedication(input));
        const current = readCollection(storage, medicationCollection);
        const { items } = current;
        if (items.some((existing) => existing.id === medication.id)) {
          throw new RepositoryError('duplicate-id');
        }
        writeCollection(storage, medicationCollection, [...items, medication], current);
        return medication;
      }),

    update: (input) =>
      run(() => {
        const medication = accept(validateMedication(input));
        const current = readCollection(storage, medicationCollection);
        const { items } = current;
        if (!items.some((existing) => existing.id === medication.id)) {
          throw new RepositoryError('not-found');
        }
        writeCollection(
          storage,
          medicationCollection,
          items.map((existing) => (existing.id === medication.id ? medication : existing)),
          current,
        );
        return medication;
      }),

    remove: (id) =>
      run(() => {
        // Read and check everything BEFORE changing anything.
        const medications = readCollection(storage, medicationCollection);
        const logs = readCollection(storage, doseLogCollection);
        const events = readCollection(storage, stockEventCollection);
        if (!medications.items.some((medication) => medication.id === id)) {
          throw new RepositoryError('not-found');
        }
        const remainingLogs = logs.items.filter((log) => log.medicationId !== id);
        const remainingEvents = events.items.filter((event) => event.medicationId !== id);
        // No collection to be written may still be version 1: check all of them before the first
        // write, so a refusal never leaves the medication gone but its history still stored.
        assertWritable(medications, medicationCollection.name);
        if (remainingLogs.length !== logs.items.length) {
          assertWritable(logs, doseLogCollection.name);
        }
        if (remainingEvents.length !== events.items.length) {
          assertWritable(events, stockEventCollection.name);
        }

        // The keys cannot be changed atomically. Each write that succeeded is remembered, so a
        // failure of a later one puts every earlier one back: a failure never leaves the
        // medication gone but its history (or its stock events) still stored, or the reverse.
        const done: { key: string; raw: string | null }[] = [];
        try {
          writeCollection(
            storage,
            medicationCollection,
            medications.items.filter((medication) => medication.id !== id),
            medications,
          );
          done.push({ key: medicationCollection.key, raw: medications.raw });
          if (remainingLogs.length !== logs.items.length) {
            writeCollection(storage, doseLogCollection, remainingLogs, logs);
            done.push({ key: doseLogCollection.key, raw: logs.raw });
          }
          if (remainingEvents.length !== events.items.length) {
            writeCollection(storage, stockEventCollection, remainingEvents, events);
            done.push({ key: stockEventCollection.key, raw: events.raw });
          }
        } catch (error) {
          // A write that throws leaves its own key as it was, so only the writes that succeeded
          // are undone. If the first write failed, nothing changed and the error is passed on.
          if (done.length === 0) throw error;
          const restored = done.reduceRight(
            (allRestored, entry) => restoreRaw(storage, entry.key, entry.raw) && allRestored,
            true,
          );
          throw new RepositoryError(toRepositoryError(error).code, {
            cause: error,
            detail: restored ? 'rolled back' : 'rollback failed: data may be inconsistent',
          });
        }
      }),
  };
}

function compareDoseLogs(a: DoseLog, b: DoseLog): number {
  return (
    compareLocalDates(a.scheduledDate, b.scheduledDate) ||
    compareLocalTimes(a.scheduledTime, b.scheduledTime) ||
    compareText(a.medicationId, b.medicationId) ||
    compareText(a.id, b.id)
  );
}

function createDoseLogRepository(storage: KeyValueStorage): DoseLogRepository {
  return {
    listByDateRange: (from: LocalDate, to: LocalDate) =>
      run(() => {
        if (compareLocalDates(from, to) > 0) {
          throw new RepositoryError('invalid-input', { detail: 'range start is after its end' });
        }
        return readCollection(storage, doseLogCollection)
          .items.filter(
            (log) =>
              compareLocalDates(log.scheduledDate, from) >= 0 &&
              compareLocalDates(log.scheduledDate, to) <= 0,
          )
          .sort(compareDoseLogs);
      }),

    upsert: (input) =>
      run(() => {
        const log = accept(validateDoseLog(input));
        const medications = readCollection(storage, medicationCollection).items;
        if (!medications.some((medication) => medication.id === log.medicationId)) {
          throw new RepositoryError('missing-reference');
        }
        const current = readCollection(storage, doseLogCollection);
        const { items } = current;
        const slotKey = doseSlotKey(doseLogSlot(log));
        const occupant = items.find(
          (existing) => doseSlotKey(doseLogSlot(existing)) === slotKey && existing.id !== log.id,
        );
        if (occupant) throw new RepositoryError('duplicate-slot');

        const exists = items.some((existing) => existing.id === log.id);
        writeCollection(
          storage,
          doseLogCollection,
          exists
            ? items.map((existing) => (existing.id === log.id ? log : existing))
            : [...items, log],
          current,
        );
        return log;
      }),

    countForMedication: (medicationId: Id) =>
      run(
        () =>
          readCollection(storage, doseLogCollection).items.filter(
            (log) => log.medicationId === medicationId,
          ).length,
      ),

    remove: (slot: DoseSlot) =>
      run(() => {
        const current = readCollection(storage, doseLogCollection);
        const { items } = current;
        const slotKey = doseSlotKey(slot);
        const remaining = items.filter((log) => doseSlotKey(doseLogSlot(log)) !== slotKey);
        // Nothing to remove: succeed without touching storage, so undo can be repeated freely.
        if (remaining.length === items.length) return;
        writeCollection(storage, doseLogCollection, remaining, current);
      }),
  };
}

function compareAppointments(a: Appointment, b: Appointment): number {
  return compareTimestamps(a.scheduledAt, b.scheduledAt) || compareText(a.id, b.id);
}

function createAppointmentRepository(storage: KeyValueStorage): AppointmentRepository {
  return {
    list: () =>
      run(() => readCollection(storage, appointmentCollection).items.sort(compareAppointments)),

    get: (id: Id) =>
      run(() => {
        const found = readCollection(storage, appointmentCollection).items.find(
          (appointment) => appointment.id === id,
        );
        if (!found) throw new RepositoryError('not-found');
        return found;
      }),

    create: (input) =>
      run(() => {
        const appointment = accept(validateAppointment(input));
        const current = readCollection(storage, appointmentCollection);
        const { items } = current;
        if (items.some((existing) => existing.id === appointment.id)) {
          throw new RepositoryError('duplicate-id');
        }
        writeCollection(storage, appointmentCollection, [...items, appointment], current);
        return appointment;
      }),

    update: (input) =>
      run(() => {
        const appointment = accept(validateAppointment(input));
        const current = readCollection(storage, appointmentCollection);
        const { items } = current;
        if (!items.some((existing) => existing.id === appointment.id)) {
          throw new RepositoryError('not-found');
        }
        writeCollection(
          storage,
          appointmentCollection,
          items.map((existing) => (existing.id === appointment.id ? appointment : existing)),
          current,
        );
        return appointment;
      }),

    remove: (id: Id) =>
      run(() => {
        const current = readCollection(storage, appointmentCollection);
        const { items } = current;
        if (!items.some((existing) => existing.id === id)) throw new RepositoryError('not-found');
        writeCollection(
          storage,
          appointmentCollection,
          items.filter((existing) => existing.id !== id),
          current,
        );
      }),
  };
}

function compareStockEvents(a: StockEvent, b: StockEvent): number {
  return compareTimestamps(a.recordedAt, b.recordedAt) || compareText(a.id, b.id);
}

function createStockEventRepository(storage: KeyValueStorage): StockEventRepository {
  return {
    list: () =>
      run(() => readCollection(storage, stockEventCollection).items.sort(compareStockEvents)),

    listForMedication: (medicationId: Id) =>
      run(() =>
        readCollection(storage, stockEventCollection)
          .items.filter((event) => event.medicationId === medicationId)
          .sort(compareStockEvents),
      ),

    append: (input) =>
      run(() => {
        const event = accept(validateStockEvent(input));
        const medications = readCollection(storage, medicationCollection).items;
        if (!medications.some((medication) => medication.id === event.medicationId)) {
          throw new RepositoryError('missing-reference');
        }
        const current = readCollection(storage, stockEventCollection);
        if (current.items.some((existing) => existing.id === event.id)) {
          throw new RepositoryError('duplicate-id');
        }
        // One write to one collection: nothing else has to change together with it.
        writeCollection(storage, stockEventCollection, [...current.items, event], current);
        return event;
      }),

    reverse: (id: Id, reversedAt: Timestamp) =>
      run(() => {
        const current = readCollection(storage, stockEventCollection);
        const found = current.items.find((event) => event.id === id);
        if (!found) throw new RepositoryError('not-found');
        // Already reversed: nothing changes, not even the moment, and storage is not touched.
        if (found.reversedAt !== null) return found;
        const reversed = accept(validateStockEvent({ ...found, reversedAt }));
        writeCollection(
          storage,
          stockEventCollection,
          current.items.map((event) => (event.id === id ? reversed : event)),
          current,
        );
        return reversed;
      }),

    countForMedication: (medicationId: Id) =>
      run(
        () =>
          readCollection(storage, stockEventCollection).items.filter(
            (event) => event.medicationId === medicationId,
          ).length,
      ),
  };
}

/** The repositories, keeping their data in the given storage. */
export function createLocalRepositories(storage: KeyValueStorage): Repositories {
  return {
    medications: createMedicationRepository(storage),
    doseLogs: createDoseLogRepository(storage),
    appointments: createAppointmentRepository(storage),
    stockEvents: createStockEventRepository(storage),
  };
}
